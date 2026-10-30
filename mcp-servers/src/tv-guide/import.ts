/**
 * import.ts - the import pipeline of the TV Guide.
 *
 * The steps of the design (tv-guide-server.md §5):
 *
 * 1. the playlist (when `liveUrl` is set): download, check `#EXTM3U`,
 *    read the header attributes and the channels;
 * 2. the EPG URL: the setting `epgUrl`; if it is empty, the first
 *    http/https value of `url-tvg` / `x-tvg-url` in the playlist header;
 *    neither → the import fails with a message that names the settings
 *    file;
 * 3. the EPG stream: download, detect gzip by the first two bytes,
 *    decompress, feed the streaming parser;
 * 4. the times come from the raw strings with their offsets; a time
 *    without an offset takes `epgDefaultOffset` and is counted;
 * 5. the texts are hashed; a new hash gets its row, its keyword-index row
 *    and its queue row, once;
 * 6. the programmes of the excluded groups are dropped;
 * 7. the retention window drops the programmes that ended too long ago;
 * 8. everything is written in one transaction; the queue is reconciled
 *    with the vectors.
 *
 * The lock of the working folder is held while the import runs, so that
 * two processes never import at the same time. A refresh that downloads
 * the same files as the last one writes nothing: the data of the database
 * is already the data of the provider (iptv-mcp-servers.md §6.4 step 3).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type Db } from '../shared/db.ts';
import { ensureRawDir } from '../shared/args.ts';
import { downloadToFile, readRawMeta, writeRawMeta, type RawMeta } from '../shared/download.ts';
import { sha256 } from '../shared/hash.ts';
import { acquireLock, type LockHandle } from '../shared/lock.ts';

import { openEpgTextStream, streamEpg, parseEpgText, validateEpgHead } from './epg.ts';
import {
  catchupTypeFromHeader,
  epgUrlsFromHeader,
  parseM3uHeader,
  parsePlaylist,
  validatePlaylistText,
  type ParsedPlaylist,
} from './playlist.ts';
import { GuideWriter, applyRetention } from './store.ts';
import {
  emptyWriteResult,
  type EpgUrlSource,
  type ImportOptions,
  type ImportOutcome,
} from './import-options.ts';

/** The source of the programmes of an import. */
export type EpgInput =
  | { kind: 'path'; path: string }
  | { kind: 'text'; text: string }
  | null;

export type {
  ImportLogger,
  ImportOptions,
  ImportOutcome,
  EpgUrlSource,
  WriteResult,
  WriteOptions,
} from './import-options.ts';
export { emptyWriteResult } from './import-options.ts';

/**
 * The signature of the settings that change what is imported.
 *
 * A download that did not change has to be imported again when one of
 * them changed: the database would otherwise hold something else than the
 * provider would send.
 */
export function importSettingsSignature(options: {
  epgUrl: string;
  liveUrl: string;
  excludeGroups: string[];
  epgDefaultOffset: string;
  pastDays: number;
  embeddingModel: string;
  minTextChars: number;
  embeddingsEnabled: boolean;
}): string {
  return sha256(
    JSON.stringify({
      epgUrl: options.epgUrl,
      liveUrl: options.liveUrl,
      excludeGroups: options.excludeGroups
        .map((name) => name.trim())
        .filter((name) => name.length > 0)
        .sort(),
      epgDefaultOffset: options.epgDefaultOffset,
      pastDays: options.pastDays,
      embeddingModel: options.embeddingModel,
      minTextChars: options.minTextChars,
      embeddingsEnabled: options.embeddingsEnabled,
    }),
  );
}

/**
 * The import that did not work.
 *
 * Every failure of the whole path comes through here: the answer of the
 * import is always an `ImportOutcome`, never an exception.
 */
function failure(
  error: string,
  started: number,
  downloaded = false,
  playlist: ImportOutcome['playlist'] = null,
  epgUrlSource: EpgUrlSource = null,
): ImportOutcome {
  return {
    ok: false,
    error,
    durationMs: Date.now() - started,
    downloaded,
    unchanged: false,
    epgUrlSource,
    playlist,
    write: null,
  };
}

/**
 * The result of an operation that could not take the lock.
 */
class ImportError {
  readonly error: string;

  constructor(error: string) {
    this.error = error;
  }
}

function isImportError(value: unknown): value is ImportError {
  return value instanceof ImportError;
}

/**
 * Take the lock of the working folder.
 */
function takeImportLock(dataDir: string | undefined): {
  lock: LockHandle | null;
  error: string | null;
} {
  if (!dataDir) return { lock: null, error: null };

  try {
    const lock = acquireLock(join(dataDir, 'refresh.lock'));
    if (!lock) return { lock: null, error: 'a refresh is already running' };
    return { lock, error: null };
  } catch (error) {
    return {
      lock: null,
      error: `the refresh lock could not be taken: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/**
 * The answer of an operation that threw.
 *
 * The import always answers with an `ImportOutcome`: a throw of the
 * download, the parser or the database wrapper is turned into a failure
 * here, and the lock is still released by the caller.
 */
class ImportThrow {
  readonly error: unknown;

  constructor(error: unknown) {
    this.error = error;
  }
}

function isImportThrow(value: unknown): value is ImportThrow {
  return value instanceof ImportThrow;
}

/**
 * Run something under the lock of the working folder, and wait for it.
 */
async function withImportLock<T>(
  dataDir: string | undefined,
  fn: () => Promise<T> | T,
): Promise<T | ImportError> {
  const taken = takeImportLock(dataDir);
  if (taken.error !== null) return new ImportError(taken.error);

  try {
    return await fn();
  } finally {
    taken.lock?.release();
  }
}

/**
 * The summary of a playlist text, for the outcome.
 */
function playlistSummaryOf(text: string | null): ImportOutcome['playlist'] {
  if (text === null) return null;
  const playlist = parsePlaylist(text);
  return {
    channels: playlist.channels.length,
    skippedNoTvgId: playlist.skippedNoTvgId,
    duplicates: playlist.duplicates,
    incomplete: playlist.incomplete,
    bareHeader: Object.keys(playlist.header).length === 0,
  };
}

/**
 * The core of every import: a parsed playlist and one EPG source, written
 * in one synchronous transaction.
 *
 * The caller has already taken the lock of the working folder when there
 * is one. A guide without a playlist is imported as it is; a playlist
 * without a guide writes its channels (with their streams and their
 * archive depths) and no programmes.
 *
 * The EPG is parsed into the memory of the writer first and written
 * afterwards in one synchronous transaction: the write is never held open
 * across an await, so nothing in the process can run on the connection in
 * the middle of it.
 */
async function importCore(
  db: Db,
  playlist: ParsedPlaylist | null,
  epg: EpgInput,
  options: ImportOptions,
  started: number,
  downloaded = false,
  epgUrlSource: EpgUrlSource = null,
): Promise<ImportOutcome> {
  const summary: ImportOutcome['playlist'] = playlist
    ? {
        channels: playlist.channels.length,
        skippedNoTvgId: playlist.skippedNoTvgId,
        duplicates: playlist.duplicates,
        incomplete: playlist.incomplete,
        bareHeader: Object.keys(playlist.header).length === 0,
      }
    : null;

  const writer = new GuideWriter(db, options);

  try {
    if (playlist) {
      const headerCatchup = catchupTypeFromHeader(playlist.header);
      for (const channel of playlist.channels) {
        writer.addPlaylistChannel(channel, headerCatchup);
      }
    }

    if (epg !== null && epg.kind === 'text') {
      parseEpgText(epg.text, {
        onChannel: (channel) => writer.addEpgChannel(channel.id, channel.name, channel.icon),
        onProgramme: (programme) => writer.addProgramme(programme),
      });
    } else if (epg !== null && epg.kind === 'path') {
      const textStream = await openEpgTextStream(epg.path);
      try {
        await streamEpg(textStream, {
          onChannel: (channel) => writer.addEpgChannel(channel.id, channel.name, channel.icon),
          onProgramme: (programme) => writer.addProgramme(programme),
        });
      } finally {
        // No file handle is left behind, also when the parse failed.
        textStream.destroy();
      }
    }
  } catch (error) {
    // The guide could not be read: the database was not touched yet, the
    // old guide is still there.
    const message = error instanceof Error ? error.message : String(error);
    options.log?.error('the guide could not be read', { error: message });
    return failure(
      `the guide could not be read: ${message}`,
      started,
      downloaded,
      summary,
      epgUrlSource,
    );
  }

  try {
    writer.write();
  } catch (error) {
    // The transaction was thrown back: the old guide is still there.
    const message = error instanceof Error ? error.message : String(error);
    options.log?.error('the guide could not be written', { error: message });
    return failure(
      `the guide could not be written: ${message}`,
      started,
      downloaded,
      summary,
      epgUrlSource,
    );
  }

  return {
    ok: true,
    durationMs: Date.now() - started,
    downloaded,
    unchanged: false,
    epgUrlSource,
    playlist: summary,
    write: writer.result,
  };
}

/**
 * Import a guide from local files: the playlist and the EPG, both
 * optional except that at least one has to be there.
 *
 * The tests and the real-data script use it. The lock of the working
 * folder is taken when the options know one.
 */
export async function importTvGuideFiles(
  db: Db,
  files: { playlistPath?: string; epgPath?: string },
  options: ImportOptions,
): Promise<ImportOutcome> {
  const started = Date.now();

  if (!files.playlistPath && !files.epgPath) {
    return failure('neither a playlist nor a guide was given', started);
  }

  const outcome = await withImportLock(options.dataDir, async () => {
    try {
      let playlist: ParsedPlaylist | null = null;
      if (files.playlistPath) {
        let text: string;
        try {
          text = readFileSync(files.playlistPath, 'utf8');
        } catch (error) {
          return failure(
            `the playlist could not be read: ${
              error instanceof Error ? error.message : String(error)
            }`,
            started,
          );
        }
        const problem = validatePlaylistText(text);
        if (problem) return failure(`the playlist was refused: ${problem}`, started);
        playlist = parsePlaylist(text);
      }

      if (files.epgPath) {
        return await importCore(db, playlist, { kind: 'path', path: files.epgPath }, options, started);
      }
      // A playlist without a guide: the channels are still written, with
      // their streams and their archive depths.
      return await importCore(db, playlist, null, options, started);
    } catch (error) {
      return new ImportThrow(error);
    }
  });

  if (isImportError(outcome)) {
    return failure(outcome.error, started);
  }
  if (isImportThrow(outcome)) {
    return failure(asMessage(outcome.error), started);
  }
  return { ...outcome, durationMs: Date.now() - started };
}

/**
 * Import a guide from texts. The tests use it.
 */
export async function importTvGuideTexts(
  db: Db,
  texts: { playlistText?: string; epgText: string },
  options: ImportOptions,
): Promise<ImportOutcome> {
  const started = Date.now();

  const outcome = await withImportLock(options.dataDir, async () => {
    try {
      let playlist: ParsedPlaylist | null = null;
      if (texts.playlistText !== undefined) {
        const problem = validatePlaylistText(texts.playlistText);
        if (problem) return failure(`the playlist was refused: ${problem}`, started);
        playlist = parsePlaylist(texts.playlistText);
      }
      return await importCore(db, playlist, { kind: 'text', text: texts.epgText }, options, started);
    } catch (error) {
      return new ImportThrow(error);
    }
  });

  if (isImportError(outcome)) {
    return failure(outcome.error, started);
  }
  if (isImportThrow(outcome)) {
    return failure(asMessage(outcome.error), started);
  }
  return { ...outcome, durationMs: Date.now() - started };
}

/**
 * The state of one downloaded source.
 */
interface SourceState {
  metaPath: string;
  previous: RawMeta | null;
  /** True when the download replaced the previous copy. */
  changed: boolean;
  download: { sha256: string; bytes: number; fetchedAt: number } | null;
}

/**
 * Write the metadata of a download, without ever failing the import for
 * it.
 */
async function touchMeta(
  metaPath: string,
  download: { sha256: string; bytes: number; fetchedAt: number } | null,
  url: string,
  settingsHash: string,
  options: ImportOptions,
): Promise<void> {
  if (!download) return;
  try {
    await writeRawMeta(metaPath, {
      fetched_at: download.fetchedAt,
      sha256: download.sha256,
      bytes: download.bytes,
      url_hash: sha256(url),
      settings_hash: settingsHash,
    });
  } catch (error) {
    options.log?.warn('the metadata of the download could not be written', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Download the playlist and the guide, and import them.
 *
 * The lock of the working folder is held for the whole run. When another
 * process holds it, nothing is downloaded and the caller is told.
 */
export async function refreshTvGuide(
  db: Db,
  dataDir: string,
  options: ImportOptions,
): Promise<ImportOutcome> {
  const started = Date.now();

  if (!options.epgUrl && !options.liveUrl) {
    return failure('not configured: set epgUrl (or liveUrl) in the settings file', started);
  }

  const outcome = await withImportLock(dataDir, async () => {
    try {
      return await refreshCore(db, dataDir, options, started);
    } catch (error) {
      // The import never throws: an unexpected error of the download, the
      // parser or the database wrapper is a failed refresh.
      options.log?.error('the refresh failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return failure(asMessage(error), started, true);
    }
  });

  if (isImportError(outcome)) {
    return failure(outcome.error, started);
  }
  return outcome;
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function refreshCore(
  db: Db,
  dataDir: string,
  options: ImportOptions,
  started: number,
): Promise<ImportOutcome> {
  {
    try {
      ensureRawDir(dataDir);
    } catch (error) {
      return failure(
        `the folder of the download could not be created: ${
          error instanceof Error ? error.message : String(error)
        }`,
        started,
      );
    }

    const settingsHash = importSettingsSignature(options);

    // --- the playlist ----------------------------------------------
    let playlistState: SourceState | null = null;
    let playlistText: string | null = null;
    let playlistHeader: Record<string, string> = {};

    if (options.liveUrl) {
      options.onPhase?.('downloading');

      const rawPath = join(dataDir, 'raw', 'playlist.m3u');
      const metaPath = join(dataDir, 'raw', 'meta-playlist.json');
      const previous = await readRawMeta(metaPath);

      const download = await downloadToFile({
        url: options.liveUrl,
        destPath: rawPath,
        validate: (head) => validatePlaylistText(head),
      });
      if (!download.ok) {
        return failure(
          download.error ?? 'the playlist could not be downloaded',
          started,
          true,
        );
      }

      playlistState = {
        metaPath,
        previous,
        changed:
          options.force === true ||
          !previous ||
          previous.sha256 !== download.sha256 ||
          previous.settings_hash !== settingsHash,
        download: { sha256: download.sha256, bytes: download.bytes, fetchedAt: download.fetchedAt },
      };

      try {
        playlistText = readFileSync(rawPath, 'utf8');
      } catch (error) {
        return failure(
          `the playlist could not be read: ${
            error instanceof Error ? error.message : String(error)
          }`,
          started,
          true,
        );
      }
      const problem = validatePlaylistText(playlistText);
      if (problem) {
        return failure(`the playlist was refused: ${problem}`, started, true);
      }
      playlistHeader = parseM3uHeader(playlistText);
    }

    // --- the EPG URL (design §5 step 2) -----------------------------
    let epgUrl = options.epgUrl;
    let epgUrlSource: EpgUrlSource = options.epgUrl ? 'settings' : null;

    if (!epgUrl) {
      const candidate = epgUrlsFromHeader(playlistHeader)[0];
      if (candidate) {
        epgUrl = candidate;
        epgUrlSource = 'playlist-header';
      }
    }

    if (!epgUrl) {
      return failure(
        'the EPG URL is not set: set epgUrl in the settings file, or url-tvg in the playlist',
        started,
        true,
        playlistSummaryOf(playlistText),
      );
    }

    // --- the guide --------------------------------------------------
    options.onPhase?.('downloading');

    const epgRawPath = join(dataDir, 'raw', 'epg.xmltv');
    const epgMetaPath = join(dataDir, 'raw', 'meta-epg.json');
    const epgPrevious = await readRawMeta(epgMetaPath);

    const epgDownload = await downloadToFile({
      url: epgUrl,
      destPath: epgRawPath,
      validate: (head, headBytes) => validateEpgHead(head, headBytes),
    });
    if (!epgDownload.ok) {
      return failure(
        epgDownload.error ?? 'the guide could not be downloaded',
        started,
        true,
        playlistSummaryOf(playlistText),
        epgUrlSource,
      );
    }

    const epgState: SourceState = {
      metaPath: epgMetaPath,
      previous: epgPrevious,
      changed:
        options.force === true ||
        !epgPrevious ||
        epgPrevious.sha256 !== epgDownload.sha256 ||
        epgPrevious.settings_hash !== settingsHash,
      download: {
        sha256: epgDownload.sha256,
        bytes: epgDownload.bytes,
        fetchedAt: epgDownload.fetchedAt,
      },
    };

    // --- nothing changed? -------------------------------------------
    // The database has to hold the guide as well: a database that was
    // wiped, or one that never got the guide, is imported even when the
    // files of the provider did not change.
    const liveProgrammes =
      db.get<{ found: number }>('SELECT count(*) AS found FROM programmes')?.found ?? 0;

    const playlistUnchanged = playlistState === null || !playlistState.changed;

    if (!epgState.changed && playlistUnchanged && liveProgrammes > 0) {
      // Only the moments of the downloads change: the hashes stay the
      // hashes of the files that are in the database. But the retention
      // window moves with the day, so the programmes that have fallen out
      // of it are removed even on this path (the import of the guide is
      // skipped, not the database work).
      const retention = applyRetention(db, options);
      options.log?.info?.('the guide did not change; the retention window was applied', {
        programmes: retention.droppedOld,
        texts: retention.removedTexts,
      });

      await touchMeta(epgState.metaPath, epgState.download, epgUrl, settingsHash, options);
      if (playlistState) {
        await touchMeta(
          playlistState.metaPath,
          playlistState.download,
          options.liveUrl,
          settingsHash,
          options,
        );
      }
      return {
        ok: true,
        durationMs: Date.now() - started,
        downloaded: true,
        unchanged: true,
        epgUrlSource,
        playlist: playlistSummaryOf(playlistText),
        write: retention,
      };
    }

    // --- the write --------------------------------------------------
    options.onPhase?.('importing');

    const imported = await importCore(
      db,
      playlistText === null ? null : parsePlaylist(playlistText),
      { kind: 'path', path: epgRawPath },
      options,
      started,
      true,
      epgUrlSource,
    );

    // The metadata is written down only when the guide was really
    // written: the hash of the file, the number of bytes, the hash of the
    // URL. The URL itself is never written down.
    if (imported.ok) {
      await touchMeta(epgState.metaPath, epgState.download, epgUrl, settingsHash, options);
      if (playlistState) {
        await touchMeta(
          playlistState.metaPath,
          playlistState.download,
          options.liveUrl,
          settingsHash,
          options,
        );
      }
    }

    return imported;
  }
}
