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
 *
 * This module is the door of the pipeline: it takes the lock, and it
 * answers with an `ImportOutcome`. The parse and the write are in
 * `import-core.ts`, the downloads in `refresh-pipeline.ts`.
 */

import { readFileSync } from 'node:fs';

import { type Db } from '../shared/db.ts';
import { ImportThrow, isImportError, isImportThrow, withImportLock } from './lock.ts';

import { parsePlaylist, validatePlaylistText, type ParsedPlaylist } from './playlist.ts';
import { asMessage, failure, importCore } from './import-core.ts';
import type { ImportOptions, ImportOutcome } from './import-options.ts';

export type {
  ImportLogger,
  ImportOptions,
  ImportOutcome,
  EpgUrlSource,
  WriteResult,
  WriteOptions,
} from './import-options.ts';
export { emptyWriteResult } from './import-options.ts';
export { importSettingsSignature, refreshTvGuide } from './refresh-pipeline.ts';
export type { EpgInput } from './import-core.ts';

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

