/**
 * similar.ts - the titles that are like a given one.
 *
 * The tool `find_similar_titles` (design: cinema-server.md §6.4) answers
 * "something like X". There are two ways to ask:
 *
 * - with the id of a title of the catalogue: its own vector is the query;
 * - with a description of a film that is not in the catalogue: the
 *   description is embedded and its vector is the query.
 *
 * The nearest titles are the ones with the smallest distance. The title the
 * search started from is never in the answer.
 *
 * Without vectors there is nothing to compare: the search falls back to the
 * titles that share the genres of the source, ordered by the rating, and it
 * says so (`search_mode: "words"`).
 */

import { type Db } from '../shared/db.ts';
import { toBlob, vectorsTableExists } from '../shared/vectors.ts';
import { buildFilter, type SearchFilters } from './filters.ts';
import { buildItems, fetchTitleRows, type ListItem } from './items.ts';
import { type SearchMode } from './search-types.ts';

/** A request of similar titles. */
export interface SimilarRequest {
  /** The title the search starts from; null for a description. */
  titleId: string | null;
  /** The vector of the query, or null when there is none. */
  vector: Float32Array | null;
  /** The model the vector was made for. */
  model: string;
  filters: SearchFilters;
  limit: number;
  offset: number;
}

/** The settings a similar search needs. */
export interface SimilarOptions {
  /** The extra country names of the settings. */
  aliases: Record<string, string>;
  /** The length of the excerpt of the description. */
  snippetChars: number;
  /** The current moment, in epoch seconds. */
  now: number;
  /** The zone the times are shown in; 'auto' is the zone of the machine. */
  timezone: string;
}

/** The result of a similar search. */
export interface SimilarOutcome {
  /** How many titles match. */
  total: number;
  /** The page of titles. */
  items: ListItem[];
  /** How the result was found. */
  mode: SearchMode;
  /** The title the search started from. */
  source: string | null;
}

/** The row of a title in the database. */
interface TitleRow {
  title_id: string;
  type: string;
  title: string;
  year: number | null;
  rating: number | null;
  category: string | null;
  director: string | null;
  description: string | null;
  duration_min: number | null;
  added_at: number | null;
  season_count: number | null;
  episode_count: number | null;
  score: number | null;
}

/**
 * The titles that are like the one that was given.
 *
 * @param request The title or the description the search starts from.
 */
export function findSimilarTitles(
  db: Db,
  request: SimilarRequest,
  options: SimilarOptions,
): SimilarOutcome {
  const filter = buildFilter(request.filters, options.aliases, options.now);
  const source = request.titleId;

  const hasVectors =
    request.vector !== null && db.hasVectors && vectorsTableExists(db);

  if (hasVectors) {
    return similarByVector(db, request, options, filter, source);
  }

  if (source === null) {
    // A description without a vector has nothing to fall back on: the
    // caller answers with an error.
    return { total: 0, items: [], mode: 'words', source: null };
  }

  return similarByGenres(db, request, options, filter, source);
}

/**
 * The titles that are nearest to the vector of the query.
 */
function similarByVector(
  db: Db,
  request: SimilarRequest,
  options: SimilarOptions,
  filter: { where: string; params: unknown[] },
  source: string | null,
): SimilarOutcome {
  const vector = request.vector as Float32Array;
  const exclude = source ?? '';

  const total =
    db.get<{ found: number }>(
      `SELECT count(*) AS found
         FROM titles t
         JOIN vec.vectors v ON v.text_hash = t.text_hash AND v.model = ?
        WHERE ${filter.where} AND t.title_id != ?`,
      request.model,
      ...filter.params,
      exclude,
    )?.found ?? 0;

  if (total === 0) {
    return { total: 0, items: [], mode: 'words+meaning', source };
  }

  const rows = db.all<{ title_id: string; distance: number }>(
    `SELECT t.title_id AS title_id, vec_distance_cosine(v.embedding, ?) AS distance
       FROM titles t
       JOIN vec.vectors v ON v.text_hash = t.text_hash AND v.model = ?
      WHERE ${filter.where} AND t.title_id != ?
      ORDER BY distance ASC, t.title_id ASC
      LIMIT ? OFFSET ?`,
    toBlob(vector),
    request.model,
    ...filter.params,
    exclude,
    request.limit,
    request.offset,
  );

  const titleRows = fetchTitleRows(
    db,
    rows.map((row) => row.title_id),
  );
  const distanceById = new Map(rows.map((row) => [row.title_id, row.distance]));

  const items = buildItems(db, titleRows, options, (row) => {
    const distance = distanceById.get(row.title_id) ?? 1;
    // The distance is smaller when the match is better: it is turned
    // around, so that a bigger score is a better match.
    return Math.round((1 - distance) * 1e6) / 1e6;
  });

  return { total, items, mode: 'words+meaning', source };
}

/**
 * The titles that share the genres of the source, ordered by the rating.
 *
 * This is the fallback for the case that there are no vectors: the search
 * by meaning is not possible, and the titles of the same genres and the
 * same country are the best that the words can offer.
 */
function similarByGenres(
  db: Db,
  request: SimilarRequest,
  options: SimilarOptions,
  filter: { where: string; params: unknown[] },
  source: string,
): SimilarOutcome {
  const sharesGenre = `EXISTS (SELECT 1 FROM title_genres g
                                JOIN title_genres s ON s.genre = g.genre
                               WHERE g.title_id = t.title_id AND s.title_id = ?)`;

  const total =
    db.get<{ found: number }>(
      `SELECT count(*) AS found
         FROM titles t
        WHERE ${filter.where} AND t.title_id != ? AND ${sharesGenre}`,
      ...filter.params,
      source,
      source,
    )?.found ?? 0;

  if (total === 0) {
    return { total: 0, items: [], mode: 'words', source };
  }

  const rows = db.all<{ title_id: string; rating: number | null }>(
    `SELECT t.title_id AS title_id, t.rating AS rating
       FROM titles t
      WHERE ${filter.where} AND t.title_id != ? AND ${sharesGenre}
      ORDER BY t.rating IS NULL ASC, t.rating DESC, t.title_id ASC
      LIMIT ? OFFSET ?`,
    ...filter.params,
    source,
    source,
    request.limit,
    request.offset,
  );

  const titleRows = fetchTitleRows(
    db,
    rows.map((row) => row.title_id),
  );
  const ratingById = new Map(rows.map((row) => [row.title_id, row.rating]));

  const items = buildItems(db, titleRows, options, (row) =>
    Math.round((ratingById.get(row.title_id) ?? 0) * 1e6) / 1e6,
  );

  return { total, items, mode: 'words', source };
}
