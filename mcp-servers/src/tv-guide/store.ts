/**
 * store.ts - the write path of the TV Guide.
 *
 * The guide is parsed into the memory first (the channels, the texts and
 * the programme rows of the import), and written afterwards in **one
 * synchronous transaction** (iptv-mcp-servers.md §6.4). A reader keeps
 * seeing the old guide until the transaction is committed, a guide that
 * fails to parse mid-way never touches the database, and nothing runs on
 * the connection in the middle of the write: the write is synchronous, so
 * the event loop cannot interleave a search into it. The cost is the
 * memory of the programme rows (about 320,000 short tuples); the texts
 * repeat heavily and are held once: the sample carries 321,787 programmes
 * with 102,467 distinct texts (design §2.3, corrected in T1).
 *
 * The write itself:
 *
 * 1. the programmes of the last import are deleted;
 * 2. the channels of the last import are deleted;
 * 3. the channels of this import are written (playlist merged with
 *    guide), with the theme, the region, the quality, the time shift and
 *    the family key;
 * 4. the new texts are written, with their facts, their keyword-index
 *    rows and their queue rows — before the programmes, whose foreign key
 *    points at them;
 * 5. the programme rows are written in one pass, already filtered by the
 *    retention window;
 * 6. the texts that no programme carries any more are removed.
 *
 * The texts that are already in the database are rewritten when the
 * version of their derivation differs from the one of the code, or when
 * the kind of the text changed with the channels around it.
 *
 * The row of a channel is written in `channel-rows.ts`, the row of a text
 * in `text-rows.ts`, and the window of the guide in `retention.ts`.
 */

import { type Db, withTransaction } from '../shared/db.ts';
import {
  clearVectorQueue,
  dropForeignQueueRows,
  pruneVectorQueue,
  queueMissingVectors,
  reconcileVectorQueue,
} from './queue.ts';
import { buildProgrammeText, DERIVED_VERSION, type ProgrammeText } from './texts.ts';
import { familyKey } from './channel-facts.ts';
import {
  GroupFactsCache,
  isAdultChannel,
  writeChannelRows,
  type MergedChannel,
} from './channel-rows.ts';
import { insertTextRow, rewriteTextRow, withChannelKind, type KnownText } from './text-rows.ts';
import { parseEpgTime } from './epg-time.ts';
import type { EpgProgramme } from './epg.ts';
import type { PlaylistChannel } from './playlist.ts';
import type { Theme } from './groups.ts';
import {
  emptyWriteResult,
  type ImportOptions,
  type WriteResult,
} from './import-options.ts';

export { isAdultChannel, type MergedChannel } from './channel-rows.ts';
export { applyRetention, removeOrphanTexts } from './retention.ts';

/**
 * One programme row, ready for the insert.
 */
export interface ProgrammeRow {
  channelId: string;
  startUtc: number;
  stopUtc: number;
  startRaw: string;
  stopRaw: string;
  textHash: string;
}

/**
 * The writer of one guide.
 *
 * `addPlaylistChannel`, `addEpgChannel` and `addProgramme` only fill the
 * memory. `write` runs inside a synchronous transaction (see
 * `importGuideCore` in `import.ts`) and writes everything at once.
 */
export class GuideWriter {
  private readonly db: Db;
  private readonly options: ImportOptions;
  readonly result: WriteResult = emptyWriteResult();

  private readonly channels = new Map<string, MergedChannel>();
  private readonly texts = new Map<string, ProgrammeText>();
  private readonly rows: ProgrammeRow[] = [];
  /** The rows that passed the channel checks, filled at the write. */
  private keptRows: ProgrammeRow[] = [];
  /** The hashes of the texts that the kept rows carry. */
  private keptTexts = new Set<string>();
  /** The themes of the channels that carry a text. */
  private readonly textThemes = new Map<string, Set<Theme>>();
  /** What the groups of the channels say. */
  private readonly groups: GroupFactsCache;

  constructor(db: Db, options: ImportOptions) {
    this.db = db;
    this.options = options;
    this.groups = new GroupFactsCache(options);
  }

  /**
   * Add a channel of the playlist.
   *
   * The playlist is read first, so its channels are in the map before the
   * guide adds its own.
   */
  addPlaylistChannel(channel: PlaylistChannel, headerCatchupType: string): void {
    const existing = this.channels.get(channel.tvgId);

    this.channels.set(channel.tvgId, {
      channelId: channel.tvgId,
      name: existing?.name ?? channel.name,
      playlistName: channel.name,
      groupTitle: channel.group || null,
      streamUrl: channel.streamUrl || null,
      archiveDays: channel.tvgRec,
      catchupType: channel.catchupType || headerCatchupType || null,
      logoUrl: channel.logo || existing?.logoUrl || null,
      isAdult: isAdultChannel(channel.group, channel.name),
      familyKey: familyKey(existing?.name ?? channel.name),
    });
  }

  /**
   * Add a channel of the guide.
   *
   * The display-name of the guide is the name of the channel; the name of
   * the playlist is only the fallback. The channels of the guide that are
   * not in the playlist have no stream: `has_live` is false for them.
   */
  addEpgChannel(id: string, name: string, icon: string): void {
    const existing = this.channels.get(id);
    if (existing) {
      // The display-name of the guide is the name of the channel; the
      // name of the playlist stays as `playlist_name` (design §4.1).
      if (name) {
        existing.name = name;
        existing.familyKey = familyKey(name);
      }
      // The logo of the playlist wins; the icon of the guide is the
      // fallback.
      if (icon && !existing.logoUrl) existing.logoUrl = icon;
      return;
    }

    this.channels.set(id, {
      channelId: id,
      name: name || id,
      playlistName: null,
      groupTitle: null,
      streamUrl: null,
      archiveDays: 0,
      catchupType: null,
      logoUrl: icon || null,
      isAdult: isAdultChannel('', name),
      familyKey: familyKey(name || id),
    });
  }

  /**
   * Convert one programme of the guide and remember its row.
   *
   * Nothing is written here: the whole guide is read before the write
   * starts, so that the write transaction stays synchronous.
   */
  addProgramme(programme: EpgProgramme): void {
    const start = parseEpgTime(programme.startRaw, this.options.epgDefaultOffset);
    const stop = parseEpgTime(programme.stopRaw, this.options.epgDefaultOffset);
    if (start === null || stop === null) {
      this.result.badTimes += 1;
      return;
    }
    if (start.usedDefault || stop.usedDefault) this.result.defaultOffsetTimes += 1;
    if (stop.epoch <= start.epoch) {
      this.result.badTimes += 1;
      return;
    }

    // Retention: ended programmes leave the window of `pastDays`
    // (design §5 step 7). Programmes that have not ended yet stay.
    const retentionFloor = this.options.now - this.options.pastDays * 86_400;
    if (stop.epoch < retentionFloor) {
      this.result.droppedOld += 1;
      return;
    }

    const text = buildProgrammeText(programme.title, programme.description);
    if (!this.texts.has(text.hash)) this.texts.set(text.hash, text);

    // The channel checks (known? group excluded?) happen at the write,
    // not here: a generator may list its programmes before its channels,
    // and the whole guide is in the memory by the time the write starts.
    this.rows.push({
      channelId: programme.channel,
      startUtc: start.epoch,
      stopUtc: stop.epoch,
      startRaw: programme.startRaw.trim(),
      stopRaw: programme.stopRaw.trim(),
      textHash: text.hash,
    });
  }

  /**
   * Write everything the import gathered, in one synchronous transaction.
   *
   * @returns everything the import has to say about the write. The caller
   *   reads it after the transaction has committed.
   */
  write(): WriteResult {
    withTransaction(this.db, () => {
      // The guide is rebuilt from the files of this import.
      this.db.run('DELETE FROM programmes');
      this.db.run('DELETE FROM channels');

      this.resolveRows();
      this.writeChannels();
      this.writeTexts();
      this.writeProgrammes();
      this.result.removedTexts = this.removeOrphanTexts();

      this.result.channels = this.countChannels();
      this.result.texts = this.countTexts();
      this.result.liveProgrammes = this.countProgrammes();

      const window = this.db.get<{ first: number | null; last: number | null }>(
        'SELECT min(start_utc) AS first, max(start_utc) AS last FROM programmes',
      );
      this.result.windowStart = window?.first ?? null;
      this.result.windowEnd = window?.last ?? null;

      this.maintainQueue();
    });

    return this.result;
  }

  /**
   * Split the programme rows into the ones that are written and the ones
   * that are dropped, now that every channel of the guide is known.
   *
   * The themes of the channels that carry a text are collected here: the
   * kind of a text may come from the theme of its channels (design §4.3
   * source 3).
   */
  private resolveRows(): void {
    this.keptRows = [];
    this.keptTexts = new Set();
    this.textThemes.clear();

    for (const row of this.rows) {
      const channel = this.channels.get(row.channelId);
      if (!channel) {
        this.result.unknownChannel += 1;
        continue;
      }

      // The programmes of the groups that are not loaded at all are
      // dropped with their channels (design §5 step 6).
      if (this.isExcluded(channel.groupTitle)) {
        this.result.droppedGroupProgrammes += 1;
        continue;
      }

      this.keptRows.push(row);
      this.keptTexts.add(row.textHash);

      const theme = this.groups.themeOf(channel.groupTitle);
      if (theme !== null) {
        const themes = this.textThemes.get(row.textHash) ?? new Set<Theme>();
        themes.add(theme);
        this.textThemes.set(row.textHash, themes);
      }
    }
  }

  /**
   * Write the channels of the map, with the excluded groups left out.
   */
  private writeChannels(): void {
    this.result.droppedGroupChannels = writeChannelRows(
      this.db,
      this.channels.values(),
      this.groups,
      (group) => this.isExcluded(group),
    );
  }

  /**
   * Is a group one of the groups that are not loaded at all?
   */
  private isExcluded(group: string | null): boolean {
    if (group === null) return false;
    return (this.excludeGroupSet ??= new Set(
      this.options.excludeGroups.map((name) => name.trim()).filter((name) => name.length > 0),
    )).has(group);
  }

  private excludeGroupSet: Set<string> | null = null;

  /**
   * Write the texts that are new to the guide, and rewrite the texts
   * whose derivation or whose kind changed.
   *
   * They are written before the programmes: the programmes table carries
   * a foreign key to them, and the foreign key is checked on every
   * insert.
   */
  private writeTexts(): void {
    // The texts that are already in the database are read once: the
    // guide holds a hundred thousand texts, and one query per text would
    // keep the transaction open for their sake.
    const known = new Map<string, KnownText>();
    for (const row of this.db.all<KnownText & { text_hash: string }>(
      'SELECT text_hash, derived_version, embed_hash, fts_rowid, kind, kind_source FROM program_texts',
    )) {
      known.set(row.text_hash, {
        derived_version: row.derived_version,
        embed_hash: row.embed_hash,
        fts_rowid: row.fts_rowid,
        kind: row.kind,
        kind_source: row.kind_source,
      });
    }

    for (const text of this.texts.values()) {
      // A text that no kept programme carries is not written: it belongs
      // to a programme that was dropped (unknown channel, excluded
      // group), and `removeOrphanTexts` would delete it again.
      if (!this.keptTexts.has(text.hash)) continue;

      const existing = known.get(text.hash);
      const final = withChannelKind(text, this.textThemes.get(text.hash));

      if (existing === undefined) {
        const outcome = insertTextRow(this.db, final, this.options);
        this.result.newTexts += 1;
        this.result.ftsRows += outcome.ftsRows;
        this.result.unknownCountries += outcome.unknownCountries;
        continue;
      }

      if (existing.derived_version !== DERIVED_VERSION) {
        const outcome = rewriteTextRow(this.db, final, existing, this.options);
        this.result.derivedTexts += 1;
        this.result.ftsRows += outcome.ftsRows;
        this.result.unknownCountries += outcome.unknownCountries;
        continue;
      }

      // The kind of a text may come from the theme of its channels, and
      // the channels of a text change: the guide moves, the channels are
      // replaced. The text is written again when its kind changed.
      if (final.kind !== existing.kind || final.kindSource !== existing.kind_source) {
        const outcome = rewriteTextRow(this.db, final, existing, this.options);
        this.result.derivedTexts += 1;
        this.result.ftsRows += outcome.ftsRows;
        continue;
      }

      // A text whose source pair did not change, whose derivation is the
      // same and whose kind is the same: its facts, its index row and its
      // vector stay.
    }
  }

  /**
   * Write the programme rows, in batches of 5,000 (design §5 step 3).
   */
  private writeProgrammes(): void {
    const statement = this.db.statement(
      `INSERT OR IGNORE INTO programmes
         (channel_id, start_utc, stop_utc, start_raw, stop_raw, text_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    for (const row of this.keptRows) {
      const outcome = statement.run(
        row.channelId,
        row.startUtc,
        row.stopUtc,
        row.startRaw,
        row.stopRaw,
        row.textHash,
      );
      if (outcome.changes === 0) this.result.duplicates += 1;
      else this.result.programmes += 1;
    }
  }

  /**
   * The queue holds the work of the active model only: the rows of
   * another model are dropped (uncounted — the model change is a question
   * of the settings, not of the guide), the rows of texts that left are
   * pruned, the missing vectors are queued, and the rows with vectors are
   * reconciled away.
   */
  private maintainQueue(): void {
    // With the embeddings off there is no worker to take the rows: the
    // queue is emptied, so that it does not promise work that never runs.
    if (!this.options.embeddingsEnabled) {
      this.result.queuePruned += clearVectorQueue(this.db);
      this.result.queueSize = 0;
      return;
    }

    dropForeignQueueRows(this.db, this.options.embeddingModel);
    this.result.queuePruned += pruneVectorQueue(this.db);
    queueMissingVectors(this.db, this.options);
    reconcileVectorQueue(this.db, this.options.embeddingModel);
    this.result.queueSize =
      this.db.get<{ found: number }>('SELECT count(*) AS found FROM vector_queue')?.found ?? 0;
  }

  /**
   * Remove the texts that no programme carries any more.
   */
  private removeOrphanTexts(): number {
    this.db.run(
      `DELETE FROM program_texts_fts
        WHERE rowid IN (
          SELECT fts_rowid FROM program_texts
           WHERE text_hash NOT IN (SELECT DISTINCT text_hash FROM programmes)
             AND fts_rowid IS NOT NULL
        )`,
    );
    return this.db.run(
      'DELETE FROM program_texts WHERE text_hash NOT IN (SELECT DISTINCT text_hash FROM programmes)',
    ).changes;
  }

  private countChannels(): number {
    return this.db.get<{ found: number }>('SELECT count(*) AS found FROM channels')?.found ?? 0;
  }

  private countTexts(): number {
    return this.db.get<{ found: number }>('SELECT count(*) AS found FROM program_texts')?.found ?? 0;
  }

  private countProgrammes(): number {
    return this.db.get<{ found: number }>('SELECT count(*) AS found FROM programmes')?.found ?? 0;
  }
}
