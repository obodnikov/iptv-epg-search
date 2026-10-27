/**
 * handlers.ts - what the tools of the cinema server do.
 *
 * Six tools (design: cinema-server.md §6):
 *
 * - `search_titles` — the main search;
 * - `get_title` — the details and the play links of a film;
 * - `list_episodes` — the episodes of a season of a series;
 * - `list_facets` — the values a search may be filtered by;
 * - `get_status` — the state of the server;
 * - `refresh_catalog` — the background refresh of the catalogue.
 *
 * The descriptions of the tools are in `descriptions.ts`, and the
 * registration is in `tools.ts`.
 *
 * A list never carries a play link: only the two detail tools do
 * (design: iptv-mcp-servers.md §5.4).
 */

import type { CallToolResult } from '@modelcontextprotocol/server';

import { type Db } from '../shared/db.ts';
import { type Logger } from '../shared/log.ts';
import { type SettingsStore } from '../shared/settings.ts';
import { type RefreshRunner } from '../shared/refresh.ts';
import { maskUrl } from '../shared/links.ts';
import {
  cursorMismatchMessage,
  decodeCursor,
  encodeCursor,
  errorResult,
  okResult,
} from '../shared/tool-kit.ts';
import { readCinemaSettings, type CinemaSettings } from './config.ts';
import {
  categoryValues,
  emptyFilters,
  genreValues,
  unknownValues,
  valueNames,
  type SearchFilters,
  type SortOrder,
} from './filters.ts';
import { searchSignature, searchTitles, type SearchRequest } from './search.ts';
import { firstSeasonOf, getTitleDetails, listEpisodes } from './details.ts';
import { listFacets } from './facets.ts';
import { lastRefresh, statusCounts, vectorStatus } from './status.ts';
import { renderDetails, renderEpisodes, renderFacets, renderList } from './render.ts';
import type { RefreshStart } from './refresh.ts';


/**
 * The most titles a list may hold.
 *
 * The design says 50 (cinema-server.md §6.1); the schema of the tools
 * says the same, and the setting `search.maxLimit` may not promise more.
 */
const MAX_LIMIT = 50;

/** Everything the tools of the cinema server need. */
export interface CinemaToolContext {
  db: Db;
  /** The working folder of the server. */
  dataDir: string;
  settings: SettingsStore;
  logger: Logger;
  runner: RefreshRunner;
  /** Starts a refresh in the background. */
  refresh: (force: boolean) => RefreshStart;
}

/**
 * The settings of the server, as they are now.
 */
function settingsOf(ctx: CinemaToolContext): CinemaSettings {
  return readCinemaSettings(ctx.settings.settings());
}

/**
 * The number of the titles that are in the catalogue right now.
 */
function liveTitleCount(db: Db): number {
  return (
    db.get<{ found: number }>(
      'SELECT count(*) AS found FROM titles WHERE removed_at IS NULL',
    )?.found ?? 0
  );
}

/**
 * The answer when the URL of the provider is not set.
 *
 * The message names the file the owner has to fill in.
 */
function notConfigured(ctx: CinemaToolContext): CallToolResult {
  return errorResult(`Cinema URL is not set: edit ${ctx.settings.path}`);
}

/**
 * The answer when the catalogue is empty.
 *
 * @returns the answer, or null when the catalogue holds something.
 */
function catalogueEmpty(ctx: CinemaToolContext): CallToolResult | null {
  if (liveTitleCount(ctx.db) > 0) return null;

  const progress = ctx.runner.progress();
  if (progress.running) {
    return errorResult(
      `The catalogue is empty: a refresh is running (${progress.phase}). Try again in about a minute.`,
    );
  }
  return errorResult(
    'The catalogue is empty. Run refresh_catalog to import it, then try again.',
  );
}

/**
 * How many valid values an error message names.
 *
 * The catalogue of a provider holds dozens of genres and countries: the
 * whole list in every error would fill the context of the model. The rest
 * is in `list_facets`.
 */
const MAX_LISTED_VALUES = 20;

/**
 * The names of the valid values, shortened when there are many.
 */
function listedValues(values: string[]): string {
  if (values.length <= MAX_LISTED_VALUES) return values.join(', ');
  return `${values.slice(0, MAX_LISTED_VALUES).join(', ')}, … (call list_facets for all of them)`;
}

/**
 * Check that the genres and the categories of a search are values of the
 * catalogue.
 *
 * An unknown value is an error that lists the valid ones: the model must
 * not guess a spelling (design: iptv-mcp-servers.md §8.2).
 */
function checkFacetValues(
  ctx: CinemaToolContext,
  settings: CinemaSettings,
  genres: string[],
  categories: string[],
  excludeGenres: string[],
): CallToolResult | null {
  const problems: string[] = [];

  const knownGenres = genreValues(ctx.db, settings.includeAdult);
  for (const wanted of [genres, excludeGenres]) {
    if (wanted.length === 0) continue;
    const missing = unknownValues(wanted, knownGenres);
    if (missing.length > 0) {
      problems.push(
        `Genre '${missing.join("', '")}' not found. Valid: ${listedValues(valueNames(knownGenres))}`,
      );
    }
  }

  if (categories.length > 0) {
    const known = categoryValues(ctx.db, settings.includeAdult);
    const missing = unknownValues(categories, known);
    if (missing.length > 0) {
      problems.push(
        `Category '${missing.join("', '")}' not found. Valid: ${listedValues(valueNames(known))}`,
      );
    }
  }

  if (problems.length === 0) return null;
  return errorResult(problems.join(' '));
}

/**
 * The answer when a title is adult content and the setting does not allow
 * it.
 *
 * The rule of the design is that adult content is absent unless
 * `includeAdult` is true (design: iptv-mcp-servers.md §11) — in the lists
 * and in the details as well.
 */
function adultRefused(
  settings: CinemaSettings,
  isAdult: boolean,
): CallToolResult | null {
  if (!isAdult || settings.includeAdult) return null;
  return errorResult(
    'This title is adult content. The setting "includeAdult" is off, so its details and its links are not given.',
  );
}

/**
 * The values of a closed set: trimmed and without the empty ones.
 *
 * The values are cleaned once, so that the check and the SQL use the same
 * spelling.
 */
function cleanValues(values: string[] | undefined): string[] {
  return (values ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

/**
 * `search_titles` — the main search.
 */
export async function searchTitlesTool(
  ctx: CinemaToolContext,
  args: {
    query?: string;
    keywords?: string[];
    type?: 'film' | 'series' | 'any';
    categories?: string[];
    genres?: string[];
    exclude_genres?: string[];
    countries?: string[];
    year_from?: number;
    year_to?: number;
    min_rating?: number;
    person?: string;
    max_minutes?: number;
    added_within_days?: number;
    sort?: SortOrder;
    limit?: number;
    cursor?: string;
  },
): Promise<CallToolResult> {
  const settings = settingsOf(ctx);
  if (!settings.cinemaUrl) return notConfigured(ctx);

  const empty = catalogueEmpty(ctx);
  if (empty) return empty;

  const genres = cleanValues(args.genres);
  const categories = cleanValues(args.categories);
  const excludeGenres = cleanValues(args.exclude_genres);
  const facetProblem = checkFacetValues(ctx, settings, genres, categories, excludeGenres);
  if (facetProblem) return facetProblem;

  const filters: SearchFilters = {
    ...emptyFilters(),
    type: args.type ?? 'any',
    categories,
    genres,
    excludeGenres,
    countries: cleanValues(args.countries),
    yearFrom: args.year_from ?? null,
    yearTo: args.year_to ?? null,
    minRating: args.min_rating ?? null,
    maxMinutes: args.max_minutes ?? null,
    addedWithinDays: args.added_within_days ?? null,
    includeAdult: settings.includeAdult,
  };

  const query = args.query?.trim() ?? '';
  const keywords = (args.keywords ?? []).map((keyword) => keyword.trim()).filter(Boolean);
  const person = args.person?.trim() ?? '';
  const sort: SortOrder = args.sort ?? 'relevance';

  const request: SearchRequest = {
    query,
    keywords,
    person,
    filters,
    sort,
    limit: 0,
    offset: 0,
  };

  const signature = searchSignature(request);

  // The cursor belongs to one search: it may not be used for another one.
  let offset = 0;
  if (args.cursor) {
    const cursor = decodeCursor(args.cursor);
    if (!cursor) {
      return errorResult(
        'This cursor is not readable. Run the search again without a cursor.',
      );
    }
    if (cursor.signature !== signature) {
      return errorResult(cursorMismatchMessage());
    }
    offset = cursor.offset;
  }

  const limit = Math.min(
    args.limit ?? settings.search.defaultLimit,
    settings.search.maxLimit,
    MAX_LIMIT,
  );

  const outcome = searchTitles(
    ctx.db,
    { ...request, limit, offset },
    {
      aliases: settings.countryAliases,
      snippetChars: settings.search.snippetChars,
      now: Math.floor(Date.now() / 1000),
      timezone: settings.timezone,
    },
  );

  const nextOffset = offset + outcome.items.length;
  const nextCursor =
    nextOffset < outcome.total ? encodeCursor({ offset: nextOffset, signature }) : null;

  const data = {
    total: outcome.total,
    search_mode: 'words' as const,
    items: outcome.items,
    next_cursor: nextCursor,
  };

  return okResult(data, renderList(outcome.items, outcome.total, outcome.usedWords));
}

/**
 * `get_title` — the details of one title.
 */
export async function getTitleTool(
  ctx: CinemaToolContext,
  args: { title_id: string },
): Promise<CallToolResult> {
  const settings = settingsOf(ctx);
  if (!settings.cinemaUrl) return notConfigured(ctx);

  const details = getTitleDetails(ctx.db, args.title_id, settings.timezone);
  if (!details) {
    return errorResult(
      `No title with the id '${args.title_id}'. Use search_titles to find one.`,
    );
  }

  const refused = adultRefused(settings, details.is_adult);
  if (refused) return refused;

  return okResult(details, renderDetails(details));
}

/**
 * `list_episodes` — the episodes of a season of a series.
 */
export async function listEpisodesTool(
  ctx: CinemaToolContext,
  args: { title_id: string; season?: number; limit?: number; cursor?: string },
): Promise<CallToolResult> {
  const settings = settingsOf(ctx);
  if (!settings.cinemaUrl) return notConfigured(ctx);

  const title = ctx.db.get<{ type: string; title: string; is_adult: number }>(
    'SELECT type, title, is_adult FROM titles WHERE title_id = ?',
    args.title_id,
  );
  if (!title) {
    return errorResult(
      `No title with the id '${args.title_id}'. Use search_titles to find one.`,
    );
  }

  const refused = adultRefused(settings, title.is_adult === 1);
  if (refused) return refused;

  if (title.type !== 'series') {
    return errorResult(
      `'${title.title}' is a film, not a series. Use get_title for its play link.`,
    );
  }

  const limit = Math.min(args.limit ?? 50, 200);

  // The season is resolved before the cursor is signed: a call without a
  // season and a call with the season of the answer are the same search.
  const season = args.season ?? firstSeasonOf(ctx.db, args.title_id);
  const episodeSignature = `${args.title_id}|${season}`;

  let offset = 0;
  if (args.cursor) {
    const cursor = decodeCursor(args.cursor);
    if (!cursor) {
      return errorResult(
        'This cursor is not readable. Run the call again without a cursor.',
      );
    }
    if (cursor.signature !== episodeSignature) {
      return errorResult(cursorMismatchMessage());
    }
    offset = cursor.offset;
  }

  const page = listEpisodes(ctx.db, args.title_id, season, limit, offset);
  if (!page) {
    return errorResult(
      `No title with the id '${args.title_id}'. Use search_titles to find one.`,
    );
  }

  const nextOffset = offset + page.examined;
  const nextCursor =
    nextOffset < page.total
      ? encodeCursor({ offset: nextOffset, signature: episodeSignature })
      : null;

  const data = {
    season: page.season,
    total: page.total,
    items: page.items,
    next_cursor: nextCursor,
    dropped_links: page.dropped_links,
  };

  return okResult(data, renderEpisodes(page.season, page.total, page.items, page.dropped_links));
}

/**
 * `list_facets` — the values a search may be filtered by.
 */
export async function listFacetsTool(ctx: CinemaToolContext): Promise<CallToolResult> {
  const settings = settingsOf(ctx);

  // The facets of an empty catalogue would tell the model that the
  // provider has no genres at all.
  const empty = catalogueEmpty(ctx);
  if (empty) return empty;

  const facets = listFacets(ctx.db, settings.includeAdult, settings.timezone);

  return okResult(facets, renderFacets(facets));
}

/**
 * `get_status` — the state of the server.
 */
export async function getStatusTool(ctx: CinemaToolContext): Promise<CallToolResult> {
  const settings = settingsOf(ctx);
  const progress = ctx.runner.progress();
  const failure = ctx.runner.lastFailure();

  const report = {
    settings_path: ctx.settings.path,
    cinema_url: settings.cinemaUrl ? maskUrl(settings.cinemaUrl) : 'not set',
    configured: settings.cinemaUrl !== '',
    settings_issues: ctx.settings.issues(),
    last_refresh: lastRefresh(ctx.db, settings.timezone),
    counts: statusCounts(ctx.db),
    vectors: vectorStatus(ctx.db, settings.embeddings.model, false),
    search_mode: 'words' as const,
    refresh_running: progress.running
      ? {
          running: progress.running,
          phase: progress.phase,
          started_at_ms: progress.startedAt,
          elapsed_ms: progress.elapsedMs,
        }
      : null,
    last_error: failure?.error ?? null,
  };

  const lines: string[] = [];
  lines.push(`Settings: ${report.settings_path}`);
  lines.push(`Cinema URL: ${report.cinema_url}`);
  for (const issue of report.settings_issues) {
    lines.push(`Problem of the settings file: ${issue}`);
  }
  lines.push(
    `Titles: ${report.counts.titles} (${report.counts.films} films, ${report.counts.series} series, ${report.counts.removed} gone)`,
  );
  lines.push(`Episodes: ${report.counts.episodes}; variants: ${report.counts.variants}`);
  if (report.last_refresh.status === 'never') {
    lines.push('Last refresh: never');
  } else {
    const what = report.last_refresh.unchanged
      ? 'the file of the provider did not change, nothing was written'
      : `${report.last_refresh.entries} entries read, ${report.last_refresh.rejected} rejected, ${report.last_refresh.titles} titles written`;
    lines.push(
      `Last refresh: ${report.last_refresh.at} (${report.last_refresh.status}, ${what})`,
    );
    if (report.last_refresh.last_success_at) {
      lines.push(`Last successful import: ${report.last_refresh.last_success_at}`);
    }
    if (report.last_refresh.error) {
      lines.push(`The last refresh failed: ${report.last_refresh.error}`);
    }
  }
  lines.push(`Search mode: ${report.search_mode}`);
  lines.push(
    `Vectors: ${report.vectors.done} done, ${report.vectors.pending} pending (model ${report.vectors.model})`,
  );
  if (report.refresh_running) {
    lines.push(
      `A refresh is running (${report.refresh_running.phase}, ${report.refresh_running.elapsed_ms} ms)`,
    );
  }
  if (report.last_error) lines.push(`Last error: ${report.last_error}`);

  return okResult(report, lines.join('\n'));
}

/**
 * `refresh_catalog` — the background refresh of the catalogue.
 */
export async function refreshCatalogTool(
  ctx: CinemaToolContext,
  args: { force?: boolean },
): Promise<CallToolResult> {
  const status = ctx.refresh(args.force ?? false);

  let message: string;
  if (status === 'not_configured') {
    message = `Cinema URL is not set: edit ${ctx.settings.path}`;
  } else if (status === 'already_running') {
    message = 'A refresh is already running. Ask get_status for its progress.';
  } else {
    message = 'The refresh started. It runs in the background; ask get_status for its progress.';
  }

  const data = {
    status,
    settings_path: ctx.settings.path,
    message,
  };

  return okResult(data, message);
}

