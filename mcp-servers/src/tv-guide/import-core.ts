/**
 * import-core.ts - the parse of a guide and its write.
 *
 * The core of every import: a parsed playlist and one EPG source, written
 * in one synchronous transaction.
 *
 * The EPG is parsed into the memory of the writer first and written
 * afterwards in one synchronous transaction: the write is never held open
 * across an await, so nothing in the process can run on the connection in
 * the middle of it.
 */

import { type Db } from '../shared/db.ts';

import { openEpgTextStream, streamEpg, parseEpgText } from './epg.ts';
import { catchupTypeFromHeader, type ParsedPlaylist } from './playlist.ts';
import { GuideWriter } from './store.ts';
import type {
  EpgUrlSource,
  ImportOptions,
  ImportOutcome,
} from './import-options.ts';

/** The source of the programmes of an import. */
export type EpgInput =
  | { kind: 'path'; path: string }
  | { kind: 'text'; text: string }
  | null;

/**
 * The import that did not work.
 *
 * Every failure of the whole path comes through here: the answer of the
 * import is always an `ImportOutcome`, never an exception.
 */
export function failure(
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
 * The message of an error.
 */
export function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
export async function importCore(
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

