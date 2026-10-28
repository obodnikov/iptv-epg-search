/**
 * handler-similar.ts - the `find_similar_titles` tool.
 *
 * The titles that are like a given one (design: cinema-server.md §6.4): the
 * nearest by the vector of the query, and the fallback to the titles of the
 * same genres when there are no vectors.
 */

import type { CallToolResult } from '@modelcontextprotocol/server';

import { getVector } from '../shared/vectors.ts';
import {
  cursorMismatchMessage,
  decodeCursor,
  encodeCursor,
  errorResult,
  okResult,
  signatureOf,
} from '../shared/tool-kit.ts';
import { emptyFilters, type SearchFilters } from './filters.ts';
import { findSimilarTitles } from './similar.ts';
import { renderList } from './render.ts';
import {
  MAX_LIMIT,
  adultRefused,
  catalogueEmpty,
  checkFacetValues,
  embedQuery,
  cleanValues,
  notConfigured,
  settingsOf,
  type CinemaToolContext,
} from './tool-context.ts';

/**
 * `find_similar_titles` — the titles that are like a given one.
 */
export async function findSimilarTitlesTool(
  ctx: CinemaToolContext,
  args: {
    title_id?: string;
    description?: string;
    type?: 'film' | 'series' | 'any';
    genres?: string[];
    exclude_genres?: string[];
    countries?: string[];
    year_from?: number;
    year_to?: number;
    min_rating?: number;
    limit?: number;
    cursor?: string;
  },
): Promise<CallToolResult> {
  const settings = settingsOf(ctx);
  if (!settings.cinemaUrl) return notConfigured(ctx);

  const empty = catalogueEmpty(ctx);
  if (empty) return empty;

  const titleId = args.title_id?.trim() || null;
  const description = args.description?.trim() ?? '';

  if (!titleId && !description) {
    return errorResult(
      'Give a title_id of the catalogue, or a description of the film you are looking for.',
    );
  }

  const genres = cleanValues(args.genres);
  const excludeGenres = cleanValues(args.exclude_genres);
  const facetProblem = checkFacetValues(ctx, settings, genres, [], excludeGenres);
  if (facetProblem) return facetProblem;

  const filters: SearchFilters = {
    ...emptyFilters(),
    type: args.type ?? 'any',
    genres,
    excludeGenres,
    countries: cleanValues(args.countries),
    yearFrom: args.year_from ?? null,
    yearTo: args.year_to ?? null,
    minRating: args.min_rating ?? null,
    includeAdult: settings.includeAdult,
  };

  // The vector of the query: the one of the title of the catalogue, or the
  // one of the description that was embedded.
  let vector: Float32Array | null = null;
  let source: string | null = null;

  if (titleId) {
    const title = ctx.db.get<{
      type: string;
      title: string;
      is_adult: number;
      text_hash: string | null;
    }>(
      'SELECT type, title, is_adult, text_hash FROM titles WHERE title_id = ?',
      titleId,
    );
    if (!title) {
      return errorResult(
        `No title with the id '${titleId}'. Use search_titles to find one.`,
      );
    }

    const refused = adultRefused(settings, title.is_adult === 1);
    if (refused) return refused;

    source = titleId;
    if (title.text_hash) {
      vector = getVector(ctx.db, title.text_hash, settings.embeddings.model);
    }
  } else {
    vector = await embedQuery(ctx, description, settings.embeddings.model);
    if (!vector) {
      return errorResult(
        'The description could not be embedded, so there is nothing to compare it with. Check the key of the embedding service, or give a title_id of the catalogue.',
      );
    }
  }

  const limit = Math.min(
    args.limit ?? settings.search.defaultLimit,
    settings.search.maxLimit,
    MAX_LIMIT,
  );

  const signature = signatureOf([
    'similar',
    titleId ?? '',
    description,
    filters.type,
    [...filters.genres].sort(),
    [...filters.excludeGenres].sort(),
    [...filters.countries].map((country) => country.trim().toLowerCase()).sort(),
    filters.yearFrom,
    filters.yearTo,
    filters.minRating,
    settings.embeddings.model,
  ]);

  let offset = 0;
  if (args.cursor) {
    const cursor = decodeCursor(args.cursor);
    if (!cursor) {
      return errorResult(
        'This cursor is not readable. Run the call again without a cursor.',
      );
    }
    if (cursor.signature !== signature) {
      return errorResult(cursorMismatchMessage());
    }
    offset = cursor.offset;
  }

  const outcome = findSimilarTitles(
    ctx.db,
    {
      titleId: source,
      vector,
      model: settings.embeddings.model,
      filters,
      limit,
      offset,
    },
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
    search_mode: outcome.mode,
    source: outcome.source,
    items: outcome.items,
    next_cursor: nextCursor,
  };

  return okResult(
    data,
    renderList(outcome.items, outcome.total, outcome.mode, outcome.mode === 'words'),
  );
}
