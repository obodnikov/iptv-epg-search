/**
 * search.ts - the words-only search of the cinema catalogue.
 *
 * The pipeline of the design (iptv-mcp-servers.md §7.1):
 *
 * 1. the filters are applied in SQL and produce the candidates;
 * 2. the words are matched in the keyword index, which holds the stemmed
 *    text (FTS5 has no Russian stemmer);
 * 3. the result is sorted and cut to the limit.
 *
 * The meaning of the query comes with the embeddings (phase C4). Until
 * then the search runs on words only and says so: `search_mode` is
 * "words".
 *
 * The index of the design uses the weights `bm25(titles_fts, 0, 3.0, 1.5,
 * 1.0)`: the title weighs most, then the people, then the description. The
 * value of `bm25()` is negative and the smaller it is, the better the
 * match.
 */

import { type Db, withSnapshot } from '../shared/db.ts';
import { snippet, stemText } from '../shared/text.ts';
import { formatInTimezone } from '../shared/time.ts';
import { buildFilter, type SearchFilters, type SortOrder } from './filters.ts';

/** One title of a list. */
export interface ListItem {
  title_id: string;
  type: 'film' | 'series';
  title: string;
  year: number | null;
  rating: number | null;
  genres: string[];
  countries: string[];
  category: string | null;
  director: string | null;
  seasons: number | null;
  episodes: number | null;
  duration_min: number | null;
  added: string | null;
  snippet: string;
  score: number;
}

/** A search of the catalogue. */
export interface SearchRequest {
  /** A natural description, in any language. */
  query: string;
  /** Exact words: names of titles, people and places. */
  keywords: string[];
  /** A director. Also matched in the description. */
  person: string;
  filters: SearchFilters;
  sort: SortOrder;
  limit: number;
  offset: number;
}

/** The settings a search needs. */
export interface SearchOptions {
  /** The extra country names of the settings. */
  aliases: Record<string, string>;
  /** The length of the excerpt of the description. */
  snippetChars: number;
  /** The current moment, in epoch seconds. */
  now: number;
  /** The zone the times are shown in; 'auto' is the zone of the machine. */
  timezone: string;
}

/** The result of a search. */
export interface SearchOutcome {
  /** How many titles match. */
  total: number;
  /** The page of titles. */
  items: ListItem[];
  /** The order the results really are in. */
  sort: SortOrder;
  /** True when the words of the query were used. */
  usedWords: boolean;
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
 * Quote a term for the FTS5 query language.
 */
function quoteTerm(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

/**
 * The stemmed words of a text.
 *
 * The index holds stemmed text, and the query is stemmed the same way
 * (design: iptv-mcp-servers.md §6.3).
 */
export function stemmedTerms(text: string): string[] {
  if (!text || !text.trim()) return [];
  return stemText(text).split(/\s+/).filter((term) => term.length > 0);
}

/**
 * Build the FTS5 expression of a search.
 *
 * The words of the query and the words of the keywords are alternatives:
 * a title that matches more of them ranks higher (bm25 counts every match).
 * The words of one keyword belong together, and the person is looked for in
 * the people and in the description of the title.
 *
 * @returns the expression, or null when there is nothing to look for.
 */
export function buildMatchExpression(
  query: string,
  keywords: string[],
  person: string,
): string | null {
  const parts: string[] = [];

  const queryTerms = stemmedTerms(query);
  if (queryTerms.length > 0) {
    parts.push(`(${queryTerms.map(quoteTerm).join(' OR ')})`);
  }

  for (const keyword of keywords) {
    const terms = stemmedTerms(keyword);
    if (terms.length === 0) continue;
    parts.push(`(${terms.map(quoteTerm).join(' AND ')})`);
  }

  const personTerms = stemmedTerms(person);
  if (personTerms.length > 0) {
    parts.push(`{people description} : (${personTerms.map(quoteTerm).join(' AND ')})`);
  }

  if (parts.length === 0) return null;
  return parts.join(' AND ');
}

/**
 * The order of the results, as SQL.
 *
 * Every order ends with the id of the title, so that the order is total and
 * a page does not miss a title.
 */
function orderClause(sort: SortOrder, usedWords: boolean): string {
  switch (sort) {
    case 'relevance':
      // bm25() is negative and the smaller the value, the better the match.
      return usedWords ? 'score ASC, t.title_id ASC' : 't.added_at IS NULL ASC, t.added_at DESC, t.title_id ASC';
    case 'rating':
      return 't.rating IS NULL ASC, t.rating DESC, t.title_id ASC';
    case 'year_desc':
      return 't.year IS NULL ASC, t.year DESC, t.title_id ASC';
    case 'year_asc':
      return 't.year IS NULL ASC, t.year ASC, t.title_id ASC';
    case 'added':
      return 't.added_at IS NULL ASC, t.added_at DESC, t.title_id ASC';
    case 'title':
      return 't.title COLLATE NOCASE ASC, t.title_id ASC';
  }
}

/**
 * The genres and the countries of a page of titles.
 */
function fetchRelations(
  db: Db,
  ids: string[],
): { genres: Map<string, string[]>; countries: Map<string, string[]> } {
  const genres = new Map<string, string[]>();
  const countries = new Map<string, string[]>();
  if (ids.length === 0) return { genres, countries };

  const marks = ids.map(() => '?').join(', ');

  for (const row of db.all<{ title_id: string; genre: string }>(
    `SELECT title_id, genre FROM title_genres WHERE title_id IN (${marks}) ORDER BY genre`,
    ...ids,
  )) {
    const list = genres.get(row.title_id) ?? [];
    list.push(row.genre);
    genres.set(row.title_id, list);
  }

  for (const row of db.all<{ title_id: string; code: string | null; raw: string }>(
    `SELECT title_id, code, raw FROM title_countries WHERE title_id IN (${marks}) ORDER BY raw`,
    ...ids,
  )) {
    const list = countries.get(row.title_id) ?? [];
    // The code when the country is known, the raw value otherwise.
    const value = row.code ?? row.raw;
    if (!list.includes(value)) list.push(value);
    countries.set(row.title_id, list);
  }

  return { genres, countries };
}

/**
 * Search the catalogue.
 *
 * The words are matched in the keyword index; the filters are applied in
 * SQL. The result is the page of titles and the number of titles that
 * match.
 */
export function searchTitles(
  db: Db,
  request: SearchRequest,
  options: SearchOptions,
): SearchOutcome {
  const expression = buildMatchExpression(request.query, request.keywords, request.person);
  const usedWords = expression !== null;

  const filter = buildFilter(request.filters, options.aliases, options.now);

  const sort =
    request.sort === 'relevance' && !usedWords ? 'added' : request.sort;
  const order = orderClause(sort, usedWords);

  // The number of titles and the page of the titles belong to the same
  // snapshot: a refresh that commits in the middle of the search must not
  // make the two disagree.
  return withSnapshot(db, () => {
    // The number of titles that match.
    let total: number;
    if (usedWords) {
      const row = db.get<{ found: number }>(
        `SELECT count(*) AS found
           FROM titles t
           JOIN titles_fts f ON f.rowid = t.rowid
          WHERE titles_fts MATCH ? AND ${filter.where}`,
        expression,
        ...filter.params,
      );
      total = row?.found ?? 0;
    } else {
      const row = db.get<{ found: number }>(
        `SELECT count(*) AS found FROM titles t WHERE ${filter.where}`,
        ...filter.params,
      );
      total = row?.found ?? 0;
    }

    if (total === 0) {
      return { total: 0, items: [], sort, usedWords };
    }

    const select = `SELECT t.title_id, t.type, t.title, t.year, t.rating, t.category,
                             t.director, t.description, t.duration_min, t.added_at,
                             t.season_count, t.episode_count,
                             ${usedWords ? 'bm25(titles_fts, 0, 3.0, 1.5, 1.0)' : 'NULL'} AS score
                        FROM titles t`;

    const rows = usedWords
      ? db.all<TitleRow>(
          `${select}
             JOIN titles_fts f ON f.rowid = t.rowid
            WHERE titles_fts MATCH ? AND ${filter.where}
            ORDER BY ${order}
            LIMIT ? OFFSET ?`,
          expression,
          ...filter.params,
          request.limit,
          request.offset,
        )
      : db.all<TitleRow>(
          `${select}
            WHERE ${filter.where}
            ORDER BY ${order}
            LIMIT ? OFFSET ?`,
          ...filter.params,
          request.limit,
          request.offset,
        );

    const ids = rows.map((row) => row.title_id);
    const relations = fetchRelations(db, ids);

    const items: ListItem[] = rows.map((row) => ({
      title_id: row.title_id,
      type: row.type === 'series' ? 'series' : 'film',
      title: row.title,
      year: row.year,
      rating: row.rating,
      genres: relations.genres.get(row.title_id) ?? [],
      countries: relations.countries.get(row.title_id) ?? [],
      category: row.category,
      director: row.director,
      seasons: row.type === 'series' ? row.season_count : null,
      episodes: row.type === 'series' ? row.episode_count : null,
      duration_min: row.duration_min,
      added: row.added_at === null ? null : formatAdded(row.added_at, options.timezone),
      snippet: snippet(row.description ?? '', options.snippetChars),
      // The bm25 value is negative and the smaller it is, the better the
      // match: the score is turned around, so that a bigger score is a
      // better match.
      score: row.score === null ? 0 : Math.round(-row.score * 1e6) / 1e6,
    }));

    return { total, items, sort, usedWords };
  });
}

/**
 * The day a title was added, as `YYYY-MM-DD` in the configured zone.
 *
 * The list item carries the date, not the moment: the full time is in the
 * details of the title.
 */
function formatAdded(epochSeconds: number, timezone: string): string {
  const formatted = formatInTimezone(epochSeconds, timezone);
  if (!formatted) return '';
  return formatted.slice(0, 10);
}

/**
 * The signature of a search.
 *
 * Two searches with the same signature have the same result, so the cursor
 * of one of them fits the other.
 */
export function searchSignature(request: SearchRequest): string {
  const filters = request.filters;
  return JSON.stringify([
    request.query.trim(),
    [...request.keywords].map((keyword) => keyword.trim()).sort(),
    request.person.trim(),
    filters.type,
    [...filters.categories].sort(),
    [...filters.genres].sort(),
    [...filters.excludeGenres].sort(),
    [...filters.countries].map((country) => country.trim().toLowerCase()).sort(),
    filters.yearFrom,
    filters.yearTo,
    filters.minRating,
    filters.maxMinutes,
    filters.addedWithinDays,
    filters.includeAdult,
    request.sort,
  ]);
}
