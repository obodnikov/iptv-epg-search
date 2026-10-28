/**
 * handlers.ts - what the tools of the cinema server do.
 *
 * Six tools (design: cinema-server.md §6):
 *
 * - `search_titles` — the main search (`handler-search.ts`);
 * - `find_similar_titles` — the titles that are like a given one
 *   (`handler-similar.ts`);
 * - `get_title` — the details and the play links of a film;
 * - `list_episodes` — the episodes of a series;
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

import { maskUrl } from '../shared/links.ts';
import { cursorMismatchMessage, decodeCursor, encodeCursor, errorResult, okResult } from '../shared/tool-kit.ts';
import { firstSeasonOf, getTitleDetails, listEpisodes } from './details.ts';
import { listFacets } from './facets.ts';
import { lastRefresh, statusCounts, vectorStatus } from './status.ts';
import { renderDetails, renderEpisodes, renderFacets } from './render.ts';
import {
  adultRefused,
  catalogueEmpty,
  notConfigured,
  settingsOf,
  type CinemaToolContext,
} from './tool-context.ts';

export { searchTitlesTool } from './handler-search.ts';
export { type CinemaToolContext } from './tool-context.ts';
export { findSimilarTitlesTool } from './handler-similar.ts';

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

  // The URL of the provider comes first: a server without a URL has to
  // name the settings file, not to send the model into a refresh that
  // cannot work (design: cinema-server.md §10, check 10).
  if (!settings.cinemaUrl) return notConfigured(ctx);

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
  const embedding = ctx.worker.status();

  // The vectors that are in the database for the active model.
  const vectors = vectorStatus(ctx.db, settings.embeddings.model, false);

  // The search by meaning is there when the embeddings are on, the client
  // can embed and there is at least one vector in the database. The number
  // of the texts of the last run is not the number: the server may have
  // been started again, and the vectors of the last run are still there.
  const meaningAvailable =
    settings.embeddings.enabled && embedding.available && vectors.done > 0;
  vectors.meaning = meaningAvailable;

  const report = {
    settings_path: ctx.settings.path,
    cinema_url: settings.cinemaUrl ? maskUrl(settings.cinemaUrl) : 'not set',
    configured: settings.cinemaUrl !== '',
    settings_issues: ctx.settings.issues(),
    last_refresh: lastRefresh(ctx.db, settings.timezone),
    counts: statusCounts(ctx.db),
    vectors,
    search_mode: (meaningAvailable ? 'words+meaning' : 'words') as 'words' | 'words+meaning',
    embedding: {
      running: embedding.running,
      phase: embedding.phase,
      done: embedding.done,
      pending: embedding.pending,
      error: embedding.last_error,
      enabled: embedding.enabled,
      available: embedding.available,
      key_present: embedding.key_present,
    },
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
  if (report.embedding.running) {
    lines.push(
      `The embedding run is going on (${report.embedding.phase}, ${report.embedding.done} texts in this run)`,
    );
  } else if (!report.embedding.enabled) {
    lines.push('The embeddings are switched off in the settings.');
  } else if (!report.embedding.key_present) {
    lines.push('The key of the embedding service is not in the environment.');
  } else if (!report.embedding.available) {
    lines.push('The embedding service cannot be used at the moment.');
  }
  if (report.embedding.error) {
    lines.push(`The last embedding run failed: ${report.embedding.error}`);
  }
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

