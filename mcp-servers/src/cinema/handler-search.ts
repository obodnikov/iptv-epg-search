/**
 * handler-search.ts - the `search_titles` tool.
 *
 * The search mixes the words and the meaning of the query (design:
 * cinema-server.md §6.1). The vector of the query is asked of the service
 * once and kept, so that a repeated search or the next page of a search
 * costs nothing.
 */

import type { CallToolResult } from '@modelcontextprotocol/server';

import {
  cursorMismatchMessage,
  decodeCursor,
  encodeCursor,
  errorResult,
  okResult,
} from '../shared/tool-kit.ts';
import { emptyFilters, type SearchFilters, type SortOrder } from './filters.ts';
import { searchSignature, searchTitles, type MeaningQuery, type SearchRequest } from './search.ts';
import { renderList } from './render.ts';
import {
  MAX_LIMIT,
  catalogueEmpty,
  checkFacetValues,
  cleanValues,
  embedQuery,
  notConfigured,
  settingsOf,
  type CinemaToolContext,
} from './tool-context.ts';

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

  // The model of the vectors is part of the signature: the vectors of two
  // models are never compared.
  const meaningModel = settings.embeddings.model;
  const signature = searchSignature(request, meaningModel);

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

  // The meaning of the query: it is only used when the result is ordered by
  // relevance, and when the service is there.
  let meaning: MeaningQuery | null = null;
  if (sort === 'relevance' && query.length > 0) {
    const vector = await embedQuery(ctx, query, meaningModel);
    if (vector) meaning = { vector, model: meaningModel };
  }

  const outcome = searchTitles(
    ctx.db,
    { ...request, limit, offset },
    {
      aliases: settings.countryAliases,
      snippetChars: settings.search.snippetChars,
      now: Math.floor(Date.now() / 1000),
      timezone: settings.timezone,
      meaning,
      meaningWeight: settings.search.meaningWeight,
    },
  );

  const nextOffset = offset + outcome.items.length;
  const nextCursor =
    nextOffset < outcome.total ? encodeCursor({ offset: nextOffset, signature }) : null;

  const data = {
    total: outcome.total,
    search_mode: outcome.mode,
    items: outcome.items,
    next_cursor: nextCursor,
  };

  return okResult(
    data,
    renderList(outcome.items, outcome.total, outcome.mode, outcome.usedWords),
  );
}
