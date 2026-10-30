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
 * 3. the channels of this import are written (playlist merged with guide);
 * 4. the new texts are written, with their keyword-index rows and their
 *    queue rows — before the programmes, whose foreign key points at
 *    them;
 * 5. the programme rows are written in one pass, already filtered by the
 *    retention window;
 * 6. the texts that no programme carries any more are removed.
 *
 * The classification columns of `program_texts` arrive with phase T2; the
 * write of T1 fills their neutral values.
 */

import { type Db, withTransaction } from '../shared/db.ts';
import { normalizeTitle, stemText } from '../shared/text.ts';
import {
  clearVectorQueue,
  dropForeignQueueRows,
  pruneVectorQueue,
  queueMissingVectors,
  queueText,
  reconcileVectorQueue,
} from './queue.ts';
import { buildProgrammeText, type ProgrammeText } from './texts.ts';
import { parseEpgTime } from './epg-time.ts';
import type { EpgProgramme } from './epg.ts';
import type { PlaylistChannel } from './playlist.ts';
import {
  emptyWriteResult,
  type ImportOptions,
  type WriteResult,
} from './import-options.ts';

/**
 * Groups and channel names that mark an adult channel.
 *
 * The sample carries the group "XXX (18+)"; the mark of the provider is
 * the "(18+)" (design §2.2). The channels are stored and marked; the
 * filter is a question of the search, not of the import — the same
 * decision the cinema server took in phase C2.
 */
const ADULT_MARK = /\(18\+\)/i;

/**
 * One channel, ready to be written.
 */
export interface MergedChannel {
  channelId: string;
  /** EPG display-name, else playlist name. */
  name: string;
  playlistName: string | null;
  groupTitle: string | null;
  streamUrl: string | null;
  archiveDays: number;
  catchupType: string | null;
  logoUrl: string | null;
  isAdult: boolean;
  /**
   * The name, normalised. Phase T2 replaces this placeholder with the
   * family key without the quality and time-shift marks.
   */
  familyKey: string;
}

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

  constructor(db: Db, options: ImportOptions) {
    this.db = db;
    this.options = options;
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
      familyKey: normalizeTitle(existing?.name ?? channel.name),
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
        existing.familyKey = normalizeTitle(name);
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
      familyKey: normalizeTitle(name),
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
      this.result.removedTexts = removeOrphanTexts(this.db);

      this.result.channels = this.countChannels();
      this.result.texts = this.countTexts();

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
   */
  private resolveRows(): void {
    this.keptRows = [];
    this.keptTexts = new Set();

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
    }
  }

  /**
   * Write the channels of the map, with the excluded groups left out.
   */
  private writeChannels(): void {
    const statement = this.db.statement(
      `INSERT INTO channels (
         channel_id, name, playlist_name, group_title, theme, region,
         timeshift_h, quality, family_key, stream_url, archive_days,
         catchup_type, logo_url, is_adult
       ) VALUES (?, ?, ?, ?, NULL, NULL, 0, 1, ?, ?, ?, ?, ?, ?)`,
    );

    for (const channel of this.channels.values()) {
      if (this.isExcluded(channel.groupTitle)) {
        this.result.droppedGroupChannels += 1;
        continue;
      }
      statement.run(
        channel.channelId,
        channel.name,
        channel.playlistName,
        channel.groupTitle,
        channel.familyKey,
        channel.streamUrl,
        channel.archiveDays,
        channel.catchupType,
        channel.logoUrl,
        channel.isAdult ? 1 : 0,
      );
    }
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
   * Write the texts that are new to the guide, with their keyword-index
   * rows and their queue rows.
   *
   * They are written before the programmes: the programmes table carries
   * a foreign key to them, and the foreign key is checked on every
   * insert.
   */
  private writeTexts(): void {
    for (const text of this.texts.values()) {
      // A text that no kept programme carries is not written: it belongs
      // to a programme that was dropped (unknown channel, excluded
      // group), and `removeOrphanTexts` would delete it again.
      if (!this.keptTexts.has(text.hash)) continue;

      const outcome = this.db.run(
        `INSERT INTO program_texts
           (text_hash, title, title_norm, description, kind, kind_source,
            live_mark, year, directors, cast_names, genres, sport, venue, embed_text)
         VALUES (?, ?, ?, ?, 'other', 'none', 0, NULL, NULL, NULL, NULL, NULL, NULL, ?)
         ON CONFLICT(text_hash) DO NOTHING`,
        text.hash,
        text.title,
        text.titleNorm,
        text.description || null,
        text.embedText,
      );

      // A text whose source pair did not change is already in the table,
      // and its index row and its vector stay: only the programmes around
      // it are rebuilt.
      if (outcome.changes === 0) continue;
      this.result.newTexts += 1;

      // The keyword index (design: iptv-mcp-servers.md §6.3): the text is
      // stemmed before it goes into the index, because FTS5 has no
      // Russian stemmer. The people column arrives with phase T2.
      const fts = this.db.run(
        `INSERT INTO program_texts_fts (text_hash, title, people, description)
         VALUES (?, ?, ?, ?)`,
        text.hash,
        stemTitle(text.titleNorm),
        '',
        stemTitle(text.description || ''),
      );
      // A RETURNING rowid on an FTS5 table answers -1; the rowid of the
      // insert comes from lastInsertRowid instead.
      const rowid = Number(fts.lastInsertRowid) || null;

      this.db.run('UPDATE program_texts SET fts_rowid = ? WHERE text_hash = ?', rowid, text.hash);

      queueText(this.db, text.hash, text.embedText, this.options);
      this.result.ftsRows += 1;
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

  private countChannels(): number {
    return this.db.get<{ found: number }>('SELECT count(*) AS found FROM channels')?.found ?? 0;
  }

  private countTexts(): number {
    return this.db.get<{ found: number }>('SELECT count(*) AS found FROM program_texts')?.found ?? 0;
  }
}

/**
 * True when a group or a name marks an adult channel.
 */
export function isAdultChannel(group: string | null, name: string): boolean {
  return ADULT_MARK.test(group ?? '') || ADULT_MARK.test(name);
}

/**
 * The stem of a text for the keyword index.
 */
function stemTitle(text: string): string {
  return stemText(text);
}

/**
 * Remove the texts that no programme carries any more, with their
 * keyword-index rows (the vectors stay in their own file, and the queue
 * rows are pruned by the caller).
 *
 * @returns the number of the texts that were removed.
 */
function removeOrphanTexts(db: Db): number {
  // Both statements are set-based: a guide can leave tens of thousands of
  // orphan texts behind, and one statement per text would keep the
  // transaction open for their sake.
  db.run(
    `DELETE FROM program_texts_fts
      WHERE rowid IN (
        SELECT fts_rowid FROM program_texts
         WHERE text_hash NOT IN (SELECT DISTINCT text_hash FROM programmes)
           AND fts_rowid IS NOT NULL
      )`,
  );
  const outcome = db.run(
    `DELETE FROM program_texts
      WHERE text_hash NOT IN (SELECT DISTINCT text_hash FROM programmes)`,
  );
  return outcome.changes;
}

/**
 * Apply the retention window to the guide that is in the database.
 *
 * A refresh whose downloads did not change writes no new guide, but the
 * window of `pastDays` still moves with the day: the programmes that have
 * fallen out of it are removed here, with the texts that only they
 * carried. Everything runs in one synchronous transaction, like the write
 * of an import.
 *
 * @returns what the retention did, for the outcome of the refresh.
 */
export function applyRetention(db: Db, options: ImportOptions): WriteResult {
  const result = emptyWriteResult();

  withTransaction(db, () => {
    const retentionFloor = options.now - options.pastDays * 86_400;
    result.droppedOld = db.run(
      'DELETE FROM programmes WHERE stop_utc < ?',
      retentionFloor,
    ).changes;
    result.removedTexts = removeOrphanTexts(db);

    result.channels = db.get<{ found: number }>('SELECT count(*) AS found FROM channels')?.found ?? 0;
    result.texts = db.get<{ found: number }>('SELECT count(*) AS found FROM program_texts')?.found ?? 0;

    const window = db.get<{ first: number | null; last: number | null }>(
      'SELECT min(start_utc) AS first, max(start_utc) AS last FROM programmes',
    );
    result.windowStart = window?.first ?? null;
    result.windowEnd = window?.last ?? null;

    if (options.embeddingsEnabled) {
      dropForeignQueueRows(db, options.embeddingModel);
      result.queuePruned += pruneVectorQueue(db);
      queueMissingVectors(db, options);
      reconcileVectorQueue(db, options.embeddingModel);
      result.queueSize =
        db.get<{ found: number }>('SELECT count(*) AS found FROM vector_queue')?.found ?? 0;
    } else {
      result.queuePruned += clearVectorQueue(db);
      result.queueSize = 0;
    }
  });

  return result;
}
