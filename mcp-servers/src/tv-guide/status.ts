/**
 * status.ts - the state of the TV Guide server.
 *
 * The answer of `get_status` tells the model what the server knows, how
 * fresh it is and what it cannot do yet (design: tv-guide-server.md §7.7).
 *
 * The URLs are masked: they carry the access key of the account, and they
 * never appear in full (design: iptv-mcp-servers.md §5.4).
 */

import { type Db } from '../shared/db.ts';
import { maskUrl } from '../shared/links.ts';
import { formatInTimezone } from '../shared/time.ts';
import type { RefreshProgress } from '../shared/refresh.ts';
import {
  guideCounts,
  guideWindow,
  type GuideCounts,
} from './queries.ts';

/** The keys of the `meta` table that hold the state of the last refresh. */
export const META_KEYS = {
  /** The moment of the last attempt, successful or not. */
  lastRefreshAt: 'last_refresh_at',
  /** Whether the last attempt succeeded. */
  lastRefreshOk: 'last_refresh_ok',
  lastRefreshError: 'last_refresh_error',
  lastRefreshDurationMs: 'last_refresh_duration_ms',
  lastRefreshProgrammes: 'last_refresh_programmes',
  lastRefreshTexts: 'last_refresh_texts',
  lastRefreshUnchanged: 'last_refresh_unchanged',
  /** The programmes that took the default offset in the last import. */
  lastRefreshDefaultOffsets: 'last_refresh_default_offsets',
  /** Where the EPG URL of the last import came from. */
  lastRefreshEpgUrlSource: 'last_refresh_epg_url_source',
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
  status: RefreshStatus;
  /** The moment of the last attempt, with the offset of the zone. */
  at: string | null;
  /** The moment of the last successful import. */
  last_success_at: string | null;
  duration_ms: number;
  /** The programmes of the guide after the import. */
  programmes: number;
  /** The texts of the guide after the import. */
  texts: number;
  /** True when nothing was written because nothing changed. */
  unchanged: boolean;
  /** The programmes that took the default offset. */
  default_offsets: number;
  error: string | null;
}

/** The counts of the answer, without the queue of the vectors. */
export interface StatusCounts {
  channels: number;
  programmes: number;
  texts: number;
  with_stream: number;
  with_archive: number;
}

/** The answer of `get_status`, before the rendering. */
export interface StatusReport {
  settings_path: string;
  epg_url: string;
  live_url: string;
  configured: boolean;
  epg_url_source: 'settings' | 'playlist-header' | 'none';
  counts: StatusCounts;
  window: { from: string | null; to: string | null };
  last_refresh: LastRefresh;
  vectors: {
    done: number;
    pending: number;
    model: string;
    meaning: boolean;
  };
  search_mode: 'words';
  refresh_running: {
    running: boolean;
    phase: string;
    started_at_ms: number | null;
    elapsed_ms: number;
  } | null;
  last_error: string | null;
}

/**
 * The state of the vectors.
 *
 * Phase T3 embeds nothing: the queue is filled by the import and the
 * report says how much is waiting for T4.
 */
function vectorStatus(db: Db, model: string, vectorsDone: number): {
  done: number;
  pending: number;
  model: string;
  meaning: boolean;
} {
  const counts = guideCounts(db, model);
  return {
    done: vectorsDone,
    pending: counts.queue,
    model,
    meaning: false,
  };
}

/**
 * The number of the vectors of the active model, when the vectors file is
 * attached.
 */
export function countVectors(db: Db, model: string): number {
  if (!db.hasVectors) return 0;
  try {
    return (
      db.get<{ found: number }>(
        'SELECT count(*) AS found FROM vec.vectors WHERE model = ?',
        model,
      )?.found ?? 0
    );
  } catch {
    // The table is not there yet: the first import of a fresh server.
    return 0;
  }
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
    last_success_at: formatInTimezone(imported, timezone),
    duration_ms: db.metaNumber(META_KEYS.lastRefreshDurationMs) ?? 0,
    programmes: db.metaNumber(META_KEYS.lastRefreshProgrammes) ?? 0,
    texts: db.metaNumber(META_KEYS.lastRefreshTexts) ?? 0,
    unchanged,
    default_offsets: db.metaNumber(META_KEYS.lastRefreshDefaultOffsets) ?? 0,
    error: db.meta(META_KEYS.lastRefreshError) || null,
  };
}

/**
 * Where the EPG URL of the last import came from.
 */
export function epgUrlSourceOf(db: Db): 'settings' | 'playlist-header' | 'none' {
  const source = db.meta(META_KEYS.lastRefreshEpgUrlSource);
  if (source === 'settings' || source === 'playlist-header') return source;
  return 'none';
}

/**
 * The report of `get_status`.
 */
export function statusReport(
  db: Db,
  params: {
    settingsPath: string;
    epgUrl: string;
    liveUrl: string;
    epgUrlSource: 'settings' | 'playlist-header' | 'none';
    timezone: string;
    model: string;
    progress: RefreshProgress;
    lastError: string | null;
  },
): StatusReport {
  const counts = guideCounts(db, params.model);
  const window = guideWindow(db);

  // The queue of the vectors is reported under `vectors`; the counts keep
  // to the fields the output schema names.
  const reportCounts = {
    channels: counts.channels,
    programmes: counts.programmes,
    texts: counts.texts,
    with_stream: counts.with_stream,
    with_archive: counts.with_archive,
  };

  return {
    settings_path: params.settingsPath,
    epg_url: params.epgUrl ? maskUrl(params.epgUrl) : 'not set',
    live_url: params.liveUrl ? maskUrl(params.liveUrl) : 'not set',
    configured: params.epgUrl !== '' || params.liveUrl !== '',
    epg_url_source: params.epgUrlSource,
    counts: reportCounts,
    window: {
      from: window.from === null ? null : formatInTimezone(window.from, params.timezone),
      to: window.to === null ? null : formatInTimezone(window.to, params.timezone),
    },
    last_refresh: lastRefresh(db, params.timezone),
    vectors: vectorStatus(db, params.model, countVectors(db, params.model)),
    search_mode: 'words',
    refresh_running: params.progress.running
      ? {
          running: params.progress.running,
          phase: params.progress.phase,
          started_at_ms: params.progress.startedAt,
          elapsed_ms: params.progress.elapsedMs,
        }
      : null,
    last_error: params.lastError,
  };
}

/**
 * Write the result of a refresh into the `meta` table.
 *
 * Two moments are kept apart: the moment of the **last attempt** and the
 * moment of the **last successful import**. The second one is the age of
 * the data; the first one says when the server last tried.
 */
export function writeRefreshState(
  db: Db,
  state: {
    at: number;
    ok: boolean;
    durationMs: number;
    programmes: number;
    texts: number;
    unchanged: boolean;
    defaultOffsets: number;
    epgUrlSource: 'settings' | 'playlist-header' | 'none';
    error?: string | null;
  },
): void {
  db.setMeta(META_KEYS.lastRefreshAt, String(state.at));
  db.setMeta(META_KEYS.lastRefreshOk, state.ok ? '1' : '0');
  db.setMeta(META_KEYS.lastRefreshDurationMs, String(state.durationMs));
  db.setMeta(META_KEYS.lastRefreshProgrammes, String(state.programmes));
  db.setMeta(META_KEYS.lastRefreshTexts, String(state.texts));
  db.setMeta(META_KEYS.lastRefreshUnchanged, state.ok && state.unchanged ? '1' : '0');
  db.setMeta(META_KEYS.lastRefreshDefaultOffsets, String(state.defaultOffsets));
  db.setMeta(META_KEYS.lastRefreshEpgUrlSource, state.epgUrlSource);
  db.setMeta(META_KEYS.lastRefreshError, state.error ?? '');

  if (state.ok) {
    db.setMeta(META_KEYS.lastImportAt, String(state.at));
  }
}
