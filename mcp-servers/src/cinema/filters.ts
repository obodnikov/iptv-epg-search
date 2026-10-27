/**
 * filters.ts - the filters of a search, as SQL.
 *
 * The filters are applied first, in SQL, and they produce the candidates
 * (design: iptv-mcp-servers.md §7.1 step 1). The words are matched inside
 * that set.
 *
 * Every filter that names a closed set (a genre, a category) is checked
 * against the values of the catalogue first: an unknown value is an error
 * that lists the valid ones, not a search that finds nothing
 * (design: iptv-mcp-servers.md §8.2).
 */

import { type Db } from '../shared/db.ts';
import { countryCode, normalizeCountryName } from '../shared/countries.ts';

/** The kind of title a search looks for. */
export type TitleType = 'film' | 'series' | 'any';

/** The order the results are in. */
export type SortOrder = 'relevance' | 'rating' | 'year_desc' | 'year_asc' | 'added' | 'title';

/** The filters of a search. */
export interface SearchFilters {
  type: TitleType;
  /** The categories (`group-title`) the titles have to be in. */
  categories: string[];
  /** At least one of these genres. */
  genres: string[];
  /** None of these genres. */
  excludeGenres: string[];
  /** The countries of production: an ISO code or a name in any language. */
  countries: string[];
  yearFrom: number | null;
  yearTo: number | null;
  minRating: number | null;
  /** The length of a film, or the length of an episode of a series. */
  maxMinutes: number | null;
  /** Only the titles that were added in the last N days. */
  addedWithinDays: number | null;
  /** Adult content is left out unless this is true. */
  includeAdult: boolean;
}

/** A filter, as a piece of SQL. */
export interface SqlFilter {
  /** The `WHERE` clauses, joined with `AND`. */
  where: string;
  /** The values of the placeholders, in the order of the clauses. */
  params: unknown[];
}

/** The filters of a search that found nothing. */
export function emptyFilters(): SearchFilters {
  return {
    type: 'any',
    categories: [],
    genres: [],
    excludeGenres: [],
    countries: [],
    yearFrom: null,
    yearTo: null,
    minRating: null,
    maxMinutes: null,
    addedWithinDays: null,
    includeAdult: false,
  };
}

/**
 * The ISO codes of the countries of a search.
 *
 * A country may be given as an ISO code ("FR") or as a name in any
 * language ("Франция", "France"). A name that the table does not know keeps
 * its raw value, so that a title with that name is still found.
 */
export function countryConditions(
  countries: string[],
  aliases: Record<string, string>,
): { codes: string[]; raws: string[] } {
  const codes: string[] = [];
  const raws: string[] = [];

  for (const country of countries) {
    const value = country.trim();
    if (!value) continue;

    if (/^[A-Za-z]{2}$/.test(value)) {
      const code = value.toUpperCase();
      if (!codes.includes(code)) codes.push(code);
      continue;
    }

    const code = countryCode(value, aliases);
    if (code) {
      if (!codes.includes(code)) codes.push(code);
      continue;
    }

    const raw = normalizeCountryName(value);
    if (raw && !raws.includes(raw)) raws.push(raw);
  }

  return { codes, raws };
}

/**
 * Build the `WHERE` clauses of a search.
 *
 * @param filters The filters of the search.
 * @param aliases The extra country names of the settings.
 * @param now The current moment, in epoch seconds.
 */
export function buildFilter(
  filters: SearchFilters,
  aliases: Record<string, string>,
  now: number,
): SqlFilter {
  const where: string[] = ['t.removed_at IS NULL'];
  const params: unknown[] = [];

  if (!filters.includeAdult) {
    where.push('t.is_adult = 0');
  }

  if (filters.type !== 'any') {
    where.push('t.type = ?');
    params.push(filters.type);
  }

  if (filters.categories.length > 0) {
    const marks = filters.categories.map(() => '?').join(', ');
    where.push(`t.category IN (${marks})`);
    params.push(...filters.categories);
  }

  if (filters.genres.length > 0) {
    const marks = filters.genres.map(() => '?').join(', ');
    where.push(
      `EXISTS (SELECT 1 FROM title_genres g
                WHERE g.title_id = t.title_id AND g.genre IN (${marks}))`,
    );
    params.push(...filters.genres);
  }

  if (filters.excludeGenres.length > 0) {
    const marks = filters.excludeGenres.map(() => '?').join(', ');
    where.push(
      `NOT EXISTS (SELECT 1 FROM title_genres g
                    WHERE g.title_id = t.title_id AND g.genre IN (${marks}))`,
    );
    params.push(...filters.excludeGenres);
  }

  const countries = countryConditions(filters.countries, aliases);
  if (countries.codes.length > 0 || countries.raws.length > 0) {
    const parts: string[] = [];
    if (countries.codes.length > 0) {
      const marks = countries.codes.map(() => '?').join(', ');
      parts.push(`c.code IN (${marks})`);
      params.push(...countries.codes);
    }
    if (countries.raws.length > 0) {
      const marks = countries.raws.map(() => '?').join(', ');
      parts.push(`lower(c.raw) IN (${marks})`);
      params.push(...countries.raws);
    }
    where.push(
      `EXISTS (SELECT 1 FROM title_countries c
                WHERE c.title_id = t.title_id AND (${parts.join(' OR ')}))`,
    );
  }

  if (filters.yearFrom !== null) {
    where.push('t.year >= ?');
    params.push(filters.yearFrom);
  }

  if (filters.yearTo !== null) {
    where.push('t.year <= ?');
    params.push(filters.yearTo);
  }

  if (filters.minRating !== null) {
    where.push('t.rating >= ?');
    params.push(filters.minRating);
  }

  if (filters.maxMinutes !== null) {
    where.push('t.duration_min IS NOT NULL AND t.duration_min <= ?');
    params.push(filters.maxMinutes);
  }

  if (filters.addedWithinDays !== null) {
    where.push('t.added_at IS NOT NULL AND t.added_at >= ?');
    params.push(now - Math.floor(filters.addedWithinDays * 24 * 60 * 60));
  }

  return { where: where.join(' AND '), params };
}

/** The genres the catalogue holds, with the number of titles of each. */
export function genreValues(db: Db, includeAdult: boolean): Map<string, number> {
  const rows = db.all<{ genre: string; count: number }>(
    `SELECT g.genre AS genre, count(*) AS count
       FROM title_genres g
       JOIN titles t ON t.title_id = g.title_id
      WHERE t.removed_at IS NULL ${includeAdult ? '' : 'AND t.is_adult = 0'}
      GROUP BY g.genre
      ORDER BY count DESC, g.genre`,
  );
  return new Map(rows.map((row) => [row.genre, row.count]));
}

/** The categories the catalogue holds, with the number of titles of each. */
export function categoryValues(db: Db, includeAdult: boolean): Map<string, number> {
  const rows = db.all<{ category: string; count: number }>(
    `SELECT category AS category, count(*) AS count
       FROM titles
      WHERE removed_at IS NULL AND category IS NOT NULL AND category != ''
        ${includeAdult ? '' : 'AND is_adult = 0'}
      GROUP BY category
      ORDER BY count DESC, category`,
  );
  return new Map(rows.map((row) => [row.category, row.count]));
}

/**
 * Find the values of a closed set that the catalogue does not hold.
 *
 * The comparison is exact: the model gets the list of the valid values from
 * `list_facets` and uses them as they are.
 */
export function unknownValues(
  wanted: string[],
  known: Map<string, number>,
): string[] {
  const missing: string[] = [];
  for (const value of wanted) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (!known.has(trimmed) && !missing.includes(trimmed)) missing.push(trimmed);
  }
  return missing;
}

/**
 * The names of the values of a closed set, most common first.
 */
export function valueNames(values: Map<string, number>): string[] {
  return [...values.keys()];
}
