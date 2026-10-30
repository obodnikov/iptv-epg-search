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
 * refresh-pipeline.ts - the downloads of a refresh and their import.
 *
 * The refresh downloads the playlist and the guide, checks whether they
 * changed, and hands them to the import. The lock of the working folder
 * is held by the caller (see `import.ts`).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type Db } from '../shared/db.ts';
import { ensureRawDir } from '../shared/args.ts';
import { downloadToFile, readRawMeta, writeRawMeta, type RawMeta } from '../shared/download.ts';
import { sha256 } from '../shared/hash.ts';

import { validateEpgHead } from './epg.ts';
import {
  epgUrlsFromHeader,
  parseM3uHeader,
  parsePlaylist,
  validatePlaylistText,
  type ParsedPlaylist,
} from './playlist.ts';
import { applyRetention } from './retention.ts';
import { isImportError, withImportLock } from './lock.ts';
import { asMessage, failure, importCore } from './import-core.ts';
import type {
  EpgUrlSource,
  ImportOptions,
  ImportOutcome,
} from './import-options.ts';

/**
 * The summary of a playlist, for the outcome.
 *
 * The playlist is parsed once per refresh: the summary and the import
 * read the same object.
 */
export function playlistSummaryOf(playlist: ParsedPlaylist | null): ImportOutcome['playlist'] {
  if (playlist === null) return null;
  return {
    channels: playlist.channels.length,
    skippedNoTvgId: playlist.skippedNoTvgId,
    duplicates: playlist.duplicates,
    incomplete: playlist.incomplete,
    bareHeader: Object.keys(playlist.header).length === 0,
  };
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


export async function refreshCore(
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
    let playlist: ParsedPlaylist | null = null;
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
        const playlistText = readFileSync(rawPath, 'utf8');
        const problem = validatePlaylistText(playlistText);
        if (problem) {
          return failure(`the playlist was refused: ${problem}`, started, true);
        }
        playlistHeader = parseM3uHeader(playlistText);
        // The playlist is parsed once: the summary and the import read
        // this object.
        playlist = parsePlaylist(playlistText);
      } catch (error) {
        return failure(
          `the playlist could not be read: ${
            error instanceof Error ? error.message : String(error)
          }`,
          started,
          true,
        );
      }
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
        playlistSummaryOf(playlist),
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
        playlistSummaryOf(playlist),
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
        playlist: playlistSummaryOf(playlist),
        write: retention,
      };
    }

    // --- the write --------------------------------------------------
    options.onPhase?.('importing');

    const imported = await importCore(
      db,
      playlist,
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
