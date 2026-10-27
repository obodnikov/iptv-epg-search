/**
 * import.ts - the import pipeline of the cinema catalogue.
 *
 * The steps of the design (cinema-server.md §4):
 *
 * 1. download the catalogue to `raw/catalog.m3u`;
 * 2. check it: the text starts with `#EXTM3U` and holds at least one
 *    `#EXTINF`. Otherwise the previous data stays and the error is recorded;
 * 3. parse it with the shared M3U reader;
 * 4. the episode pattern tells the series from the films;
 * 5. the series are consolidated and the quality variants of a film are
 *    merged (catalog.ts);
 * 6. the genres, the countries, the rating, the times, the lengths and the
 *    adult flag are normalised, and the text that is embedded is built;
 * 7. everything is written in one transaction;
 * 8. the texts that have to be embedded are put into the queue.
 *
 * The lock of the working folder is held while the import runs, so that two
 * processes never import at the same time.
 *
 * The tables must be there before the import runs: `applyCinemaSchema` from
 * `schema.ts` creates them, and the server calls it when it starts.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type Db } from '../shared/db.ts';
import { ensureRawDir } from '../shared/args.ts';
import { downloadToFile } from '../shared/download.ts';
import { acquireLock, type LockHandle } from '../shared/lock.ts';
import { countryCode } from '../shared/countries.ts';
import { hasM3uHeader, stripBom } from '../shared/m3u.ts';
import { buildCatalog, type Catalog, type ParsedTitle } from './catalog.ts';
import { buildEmbeddingText } from './embed-text.ts';
import { idSeedFor, lookupKeyFor, textHash } from './keys.ts';
import { parseCinemaCatalog, type CinemaEntry } from './parser.ts';
import {
  computeContentHash,
  writeCatalog,
  type PreparedTitle,
  type WriteResult,
} from './store.ts';

/**
 * Where the import writes what it has to say.
 *
 * The server has a logger that writes to the log file of the working
 * folder. The scripts write to the console.
 */
export interface ImportLogger {
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface ImportOptions {
  /** The URL of the catalogue. An empty URL means "not configured". */
  cinemaUrl: string;
  /** The categories that are not loaded at all. */
  excludeCategories: string[];
  /** Extra country names to ISO codes. */
  countryAliases: Record<string, string>;
  /** Keep `first_seen_at` and `removed_at`. */
  trackChanges: boolean;
  /** The model the vectors are made for. */
  embeddingModel: string;
  /** Texts shorter than this are only searched by words. */
  minTextChars: number;
  /** The moment of the import, in epoch seconds. */
  now: number;
  /**
   * The working folder.
   *
   * When it is known, the import takes the lock of the folder, so that two
   * processes never write the catalogue at the same time.
   */
  dataDir?: string;
  /** Where the import writes the collisions and the errors. */
  log?: ImportLogger;
}

export interface ImportOutcome {
  ok: boolean;
  /** The reason the import failed, when it did. */
  error?: string;
  /** The whole import, in milliseconds. */
  durationMs: number;
  /** True when the file was downloaded first. */
  downloaded: boolean;
  /** The `#EXTINF` blocks that were read. */
  entries: number;
  /** The entries whose stream line was not an http/https URL. */
  rejected: number;
  /** The `#EXTINF` blocks without a stream line. */
  incomplete: number;
  /** The titles that were written. */
  titles: number;
  /** The result of the write. */
  write: WriteResult | null;
}

/**
 * Check the text of a catalogue.
 *
 * @returns the reason the file is not a catalogue, or null when it is one.
 */
export function validateCatalogText(text: string): string | null {
  if (!hasM3uHeader(text)) {
    return 'the file does not start with #EXTM3U';
  }
  if (!stripBom(text).includes('#EXTINF')) {
    return 'the file holds no #EXTINF entry';
  }
  return null;
}

/**
 * Parse the text of a catalogue and group it into titles.
 */
export function parseCatalogText(
  text: string,
  options: ImportOptions,
): { catalog: Catalog; entries: number; rejected: number; incomplete: number } {
  const parsed = parseCinemaCatalog(text);
  const entries = filterExcludedCategories(parsed.entries, options.excludeCategories);
  const catalog = buildCatalog(entries);
  return {
    catalog,
    entries: parsed.entries.length + parsed.rejected,
    rejected: parsed.rejected,
    incomplete: parsed.incomplete,
  };
}

/**
 * Drop the entries of the categories that are not loaded at all.
 */
export function filterExcludedCategories(
  entries: CinemaEntry[],
  excluded: string[],
): CinemaEntry[] {
  if (excluded.length === 0) return entries;
  const names = new Set(excluded.map((name) => name.trim()).filter((name) => name.length > 0));
  if (names.size === 0) return entries;
  return entries.filter((entry) => !names.has(entry.category));
}

/**
 * Turn the titles of the catalogue into the rows that are written.
 */
export function prepareTitles(catalog: Catalog, options: ImportOptions): PreparedTitle[] {
  return catalog.titles.map((title) => prepareTitle(title, options));
}

/**
 * Turn one title of the catalogue into the rows that are written.
 */
export function prepareTitle(title: ParsedTitle, options: ImportOptions): PreparedTitle {
  const countries = title.countries.map((raw) => ({
    raw,
    code: countryCode(raw, options.countryAliases),
  }));

  const embedText = buildEmbeddingText({
    type: title.type,
    title: title.title,
    year: title.year,
    genres: title.genres,
    countries: title.countries,
    director: title.director,
    description: title.description,
  });

  const prepared: PreparedTitle = {
    type: title.type,
    title: title.title,
    titleNorm: title.titleNorm,
    year: title.year,
    rating: title.rating,
    category: title.category,
    director: title.director,
    description: title.description,
    posterUrl: title.posterUrl,
    durationMin: title.durationMin,
    addedAt: title.addedAt,
    addedRaw: title.addedRaw,
    isAdult: title.isAdult,
    isNewTag: title.isNewTag,
    genres: title.genres,
    countries,
    seasonCount: title.type === 'series' ? title.seasonCount : null,
    episodeCount: title.type === 'series' ? title.episodeCount : null,
    variants: title.variants
      .filter((variant) => variant.streamUrl !== null)
      .map((variant) => ({
        quality: variant.quality,
        streamUrl: variant.streamUrl ?? '',
        durationMin: variant.durationMin,
        category: variant.category,
      })),
    episodes: title.episodes
      .filter((episode) => episode.streamUrl !== null)
      .map((episode) => ({
        season: episode.season,
        episode: episode.episode,
        name: episode.name,
        streamUrl: episode.streamUrl ?? '',
        durationMin: episode.durationMin,
      })),
    lookupKey: lookupKeyFor(title.type, title.titleNorm, title.year),
    seed: idSeedFor(title.type, title.titleNorm, title.year),
    embedText,
    textHash: textHash(embedText),
    contentHash: '',
  };

  prepared.contentHash = computeContentHash(prepared);
  return prepared;
}

/**
 * The import that did not work.
 *
 * Every failure of the whole path comes through here: the answer of the
 * import is always an `ImportOutcome`, never an exception.
 */
function failure(
  error: string,
  options: ImportOptions,
  started: number,
  downloaded = false,
  counts: { entries?: number; rejected?: number; incomplete?: number } = {},
): ImportOutcome {
  options.log?.error(error);
  return {
    ok: false,
    error,
    durationMs: Date.now() - started,
    downloaded,
    entries: counts.entries ?? 0,
    rejected: counts.rejected ?? 0,
    incomplete: counts.incomplete ?? 0,
    titles: 0,
    write: null,
  };
}

/**
 * The import of a text, without the lock of the working folder.
 */
function importText(db: Db, text: string, options: ImportOptions): ImportOutcome {
  const started = Date.now();

  const problem = validateCatalogText(text);
  if (problem) {
    return failure(`the catalogue was refused: ${problem}`, options, started);
  }

  const parsed = parseCatalogText(text, options);
  if (parsed.catalog.titles.length === 0) {
    // An empty catalogue would empty the database. The last good copy stays.
    return failure('the catalogue holds no title', options, started);
  }

  const prepared = prepareTitles(parsed.catalog, options);

  let write: WriteResult;
  try {
    write = writeCatalog(db, prepared, options);
  } catch (error) {
    // The write failed: the transaction was thrown back and the old
    // catalogue is still there. The error is recorded, not thrown, so that
    // the caller has one way to hear about a failure.
    const message = error instanceof Error ? error.message : String(error);
    options.log?.error('the catalogue could not be written', { error: message });
    return failure(
      `the catalogue could not be written: ${message}`,
      options,
      started,
      false,
      {
        entries: parsed.entries,
        rejected: parsed.rejected,
        incomplete: parsed.incomplete,
      },
    );
  }

  // A collision changes the id of a title that was in the database before.
  // It has to be written down.
  for (const collision of write.collisions) {
    options.log?.warn('two titles wanted the same id', {
      base_id: collision.baseId,
      existing: collision.existingLookupKey,
      existing_title_id: collision.existingTitleId,
      incoming: collision.incomingLookupKey,
      incoming_title_id: collision.incomingTitleId,
    });
  }

  return {
    ok: true,
    durationMs: Date.now() - started,
    downloaded: false,
    entries: parsed.entries,
    rejected: parsed.rejected,
    incomplete: parsed.incomplete,
    titles: prepared.length,
    write,
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
 *
 * @returns the lock, or the reason it could not be taken. Without a working
 * folder there is no lock: the caller writes to a database that is not
 * shared.
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
 * Run something under the lock of the working folder.
 */
function withImportLock<T>(options: ImportOptions, fn: () => T): T | ImportError {
  const taken = takeImportLock(options.dataDir);
  if (taken.error !== null) return new ImportError(taken.error);

  try {
    return fn();
  } finally {
    taken.lock?.release();
  }
}

/**
 * Run something under the lock of the working folder, and wait for it.
 *
 * The lock is held until the promise is settled.
 */
async function withImportLockAsync<T>(
  dataDir: string | undefined,
  fn: () => Promise<T>,
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
 * Import a catalogue from a text.
 *
 * The lock of the working folder is taken when the options know it, so that
 * two processes never write the catalogue at the same time.
 */
export function importCatalogText(
  db: Db,
  text: string,
  options: ImportOptions,
): ImportOutcome {
  const started = Date.now();
  const outcome = withImportLock(options, () => importText(db, text, options));
  if (isImportError(outcome)) {
    return failure(outcome.error, options, started);
  }
  return outcome;
}

/**
 * Import a catalogue from a file.
 */
export function importCatalogFile(
  db: Db,
  path: string,
  options: ImportOptions,
): ImportOutcome {
  const started = Date.now();

  const outcome = withImportLock(options, () => {
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch (error) {
      return failure(
        `the catalogue could not be read: ${
          error instanceof Error ? error.message : String(error)
        }`,
        options,
        started,
      );
    }

    return importText(db, text, options);
  });

  if (isImportError(outcome)) {
    return failure(outcome.error, options, started);
  }
  return { ...outcome, durationMs: Date.now() - started };
}

/**
 * Download the catalogue and import it.
 *
 * The lock of the working folder is taken for the whole run. When another
 * process holds it, nothing is downloaded and the caller is told.
 */
export async function refreshCatalog(
  db: Db,
  dataDir: string,
  options: ImportOptions,
): Promise<ImportOutcome> {
  const started = Date.now();

  if (!options.cinemaUrl) {
    return failure('the cinema URL is not set', options, started);
  }

  // The lock of the working folder is held for the whole run: the download
  // and the import.
  const outcome = await withImportLockAsync(dataDir, async () => {
    const rawPath = join(dataDir, 'raw', 'catalog.m3u');

    // The folder of the download is part of the working folder: it is
    // created here, so that the caller does not have to know about it.
    try {
      ensureRawDir(dataDir);
    } catch (error) {
      return failure(
        `the folder of the download could not be created: ${
          error instanceof Error ? error.message : String(error)
        }`,
        options,
        started,
      );
    }

    let download;
    try {
      download = await downloadToFile({
        url: options.cinemaUrl,
        destPath: rawPath,
        validate: (head) => validateCatalogText(head),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return failure(
        `the catalogue could not be downloaded: ${message}`,
        options,
        started,
      );
    }

    if (!download.ok) {
      return failure(
        download.error ?? 'the catalogue could not be downloaded',
        options,
        started,
      );
    }

    // The lock of the working folder is already held: the import itself
    // must not take it a second time.
    let text: string;
    try {
      text = readFileSync(rawPath, 'utf8');
    } catch (error) {
      return failure(
        `the catalogue could not be read: ${
          error instanceof Error ? error.message : String(error)
        }`,
        options,
        started,
        true,
      );
    }

    const imported = importText(db, text, options);
    return { ...imported, downloaded: true, durationMs: Date.now() - started };
  });

  if (isImportError(outcome)) {
    return failure(outcome.error, options, started);
  }
  return outcome;
}
