/**
 * status.ts - the state of the cinema server.
 *
 * The answer of `get_status` tells the model what the server knows, how
 * fresh it is and what it cannot do yet (design: cinema-server.md §6.6).
 *
 * The URL of the provider is masked: it carries the access key of the
 * account, and it never appears in full (design: iptv-mcp-servers.md §5.4).
 */

import { type Db } from '../shared/db.ts';
import { maskUrl } from '../shared/links.ts';
import { formatInTimezone } from '../shared/time.ts';
import { type RefreshProgress } from '../shared/refresh.ts';

/** The keys of the `meta` table that hold the state of the last refresh. */
export const META_KEYS = {
  /** The moment of the last attempt, successful or not. */
  lastRefreshAt: 'last_refresh_at',
  /** Whether the last attempt succeeded. */
  lastRefreshOk: 'last_refresh_ok',
  lastRefreshError: 'last_refresh_error',
  lastRefreshDurationMs: 'last_refresh_duration_ms',
  lastRefreshEntries: 'last_refresh_entries',
  lastRefreshRejected: 'last_refresh_rejected',
  lastRefreshIncomplete: 'last_refresh_incomplete',
  lastRefreshTitles: 'last_refresh_titles',
  lastRefreshUnchanged: 'last_refresh_unchanged',
  /** The moment of the last successful import: the age of the data. */
  lastImportAt: 'last_import_at',
  /** The signature of the settings that change what is imported. */
  importSettingsHash: 'import_settings_hash',
  sourceUrlHash: 'source_url_hash',
} as const;

/** What the last refresh did. */
export type RefreshStatus = 'never' | 'ok' | 'unchanged' | 'failed';

/** The last refresh, as it was written down. */
export interface LastRefresh {
  /** What the last refresh did. */
  status: RefreshStatus;
  /** The moment of the last attempt, with the offset of the zone. */
  at: string | null;
  /** Whether the last attempt succeeded. */
  ok: boolean;
  /** The moment of the last successful import: the age of the data. */
  last_success_at: string | null;
  duration_ms: number;
  /** The `#EXTINF` blocks that were read. */
  entries: number;
  /** The entries whose stream line was not an http(s) URL. */
  rejected: number;
  /** The `#EXTINF` blocks without a stream line. */
  incomplete: number;
  /** The titles that were written. */
  titles: number;
  /** True when the download did not change and nothing was written. */
  unchanged: boolean;
  error: string | null;
}

/** The numbers of the catalogue. */
export interface StatusCounts {
  titles: number;
  films: number;
  series: number;
  removed: number;
  episodes: number;
  variants: number;
}

/** The state of the vectors. */
export interface VectorStatus {
  /** The vectors that are there for the active model. */
  done: number;
  /** The texts that still have to be embedded. */
  pending: number;
  /** The model the vectors are made for. */
  model: string;
  /** True when the search by meaning is available. */
  meaning: boolean;
}

/** The answer of `get_status`. */
export interface StatusReport {
  /** The path of the settings file. */
  settings_path: string;
  /** The URL of the provider, masked. */
  cinema_url: string;
  /** True when the URL is set. */
  configured: boolean;
  last_refresh: LastRefresh;
  counts: StatusCounts;
  vectors: VectorStatus;
  /** The mode the search runs in. */
  search_mode: 'words' | 'words+meaning';
  /** The refresh that runs right now, or null. */
  refresh_running: RefreshProgress | null;
  /** The last error of the server. */
  last_error: string | null;
}

/**
 * The numbers of the catalogue.
 */
export function statusCounts(db: Db): StatusCounts {
  const row = db.get<{
    titles: number;
    films: number;
    series: number;
    removed: number;
  }>(
    `SELECT count(*) AS titles,
            sum(CASE WHEN type = 'film' THEN 1 ELSE 0 END) AS films,
            sum(CASE WHEN type = 'series' THEN 1 ELSE 0 END) AS series,
            sum(CASE WHEN removed_at IS NOT NULL THEN 1 ELSE 0 END) AS removed
       FROM titles`,
  );

  const episodes = db.get<{ found: number }>('SELECT count(*) AS found FROM episodes');
  const variants = db.get<{ found: number }>('SELECT count(*) AS found FROM variants');

  return {
    titles: row?.titles ?? 0,
    films: row?.films ?? 0,
    series: row?.series ?? 0,
    removed: row?.removed ?? 0,
    episodes: episodes?.found ?? 0,
    variants: variants?.found ?? 0,
  };
}

/**
 * The state of the vectors.
 *
 * The vectors of a model that is not the active one are never counted: the
 * search compares the vectors of one model only
 * (design: iptv-mcp-servers.md §6.2).
 */
export function vectorStatus(db: Db, model: string, meaningAvailable: boolean): VectorStatus {
  let done = 0;

  if (db.hasVectors) {
    const table = db.get<{ found: number }>(
      "SELECT count(*) AS found FROM vec.sqlite_master WHERE type = 'table' AND name = 'vectors'",
    );
    if ((table?.found ?? 0) > 0) {
      done =
        db.get<{ found: number }>(
          'SELECT count(*) AS found FROM vec.vectors WHERE model = ?',
          model,
        )?.found ?? 0;
    }
  }

  const pending =
    db.get<{ found: number }>(
      'SELECT count(*) AS found FROM vector_queue WHERE model = ?',
      model,
    )?.found ?? 0;

  return { done, pending, model, meaning: meaningAvailable };
}

/**
 * The last refresh, as it was written down in the `meta` table.
 */
export function lastRefresh(db: Db, timezone: string): LastRefresh {
  const at = db.metaNumber(META_KEYS.lastRefreshAt);
  const imported = db.metaNumber(META_KEYS.lastImportAt);
  const ok = db.meta(META_KEYS.lastRefreshOk) === '1';
  const unchanged = db.meta(META_KEYS.lastRefreshUnchanged) === '1';

  let status: RefreshStatus;
  if (at === null) status = 'never';
  else if (!ok) status = 'failed';
  else if (unchanged) status = 'unchanged';
  else status = 'ok';

  return {
    status,
    at: formatInTimezone(at, timezone),
    ok,
    last_success_at: formatInTimezone(imported, timezone),
    duration_ms: db.metaNumber(META_KEYS.lastRefreshDurationMs) ?? 0,
    entries: db.metaNumber(META_KEYS.lastRefreshEntries) ?? 0,
    rejected: db.metaNumber(META_KEYS.lastRefreshRejected) ?? 0,
    incomplete: db.metaNumber(META_KEYS.lastRefreshIncomplete) ?? 0,
    titles: db.metaNumber(META_KEYS.lastRefreshTitles) ?? 0,
    unchanged,
    error: db.meta(META_KEYS.lastRefreshError) || null,
  };
}

/**
 * Write the result of a refresh into the `meta` table.
 *
 * Two moments are kept apart: the moment of the **last attempt** and the
 * moment of the **last successful import**. The second one is the age of
 * the data; the first one says when the server last tried.
 *
 * The moment of the successful import is only moved forward when the
 * import worked: a failed refresh must not make the data look fresh.
 */
export function writeRefreshState(
  db: Db,
  state: {
    at: number;
    ok: boolean;
    durationMs: number;
    entries: number;
    rejected: number;
    incomplete: number;
    titles: number;
    unchanged?: boolean;
    error?: string | null;
  },
): void {
  db.setMeta(META_KEYS.lastRefreshAt, String(state.at));
  db.setMeta(META_KEYS.lastRefreshOk, state.ok ? '1' : '0');
  db.setMeta(META_KEYS.lastRefreshDurationMs, String(state.durationMs));
  db.setMeta(META_KEYS.lastRefreshEntries, String(state.entries));
  db.setMeta(META_KEYS.lastRefreshRejected, String(state.rejected));
  db.setMeta(META_KEYS.lastRefreshIncomplete, String(state.incomplete));
  db.setMeta(META_KEYS.lastRefreshTitles, String(state.titles));
  db.setMeta(META_KEYS.lastRefreshUnchanged, state.ok && state.unchanged ? '1' : '0');
  db.setMeta(META_KEYS.lastRefreshError, state.error ?? '');

  if (state.ok) {
    db.setMeta(META_KEYS.lastImportAt, String(state.at));
  }
}
