/**
 * import-options.ts - the types of the import of the cinema catalogue.
 *
 * They are in their own module, so that the preparation of the titles
 * (`prepare.ts`) can use them without a cycle.
 */

import type { WriteResult } from './store.ts';

/**
 * Where the import writes what it has to say.
 *
 * The server has a logger that writes to the log file of the working
 * folder. The scripts write to the console.
 */
export interface ImportLogger {
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  /** Optional: not every caller of the import has a logger with info. */
  info?(message: string, fields?: Record<string, unknown>): void;
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
  /**
   * The phases of the refresh, for the status of the server.
   *
   * The tool that starts the refresh returns at once: the phase is how the
   * model hears how far the background work got.
   */
  onPhase?: (phase: 'downloading' | 'importing') => void;
  /**
   * Import the catalogue even when the download did not change.
   *
   * A refresh that finds the same file does not have to write the
   * catalogue again: the data of the database is already the data of the
   * provider (design: iptv-mcp-servers.md §6.4 step 3).
   */
  force?: boolean;
}

/**
 * The result of an import.
 */
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
  /** True when the download did not change and nothing was written. */
  unchanged: boolean;
  /** The result of the write. */
  write: WriteResult | null;
}
