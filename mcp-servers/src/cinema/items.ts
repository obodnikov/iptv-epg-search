/**
 * items.ts - the rows of a title and the items of a list.
 *
 * Both the search and the similar search build their answers out of the
 * same parts: the rows of the titles, the genres and the countries that
 * belong to them, and the excerpt of the description.
 *
 * The list item is the compact record of the design (cinema-server.md §6):
 * `title_id, type, title, year, rating, genres[], countries[], category,
 * director, seasons, episodes, duration_min, added, snippet, score`.
 */

import { type Db } from '../shared/db.ts';
import { snippet } from '../shared/text.ts';
import { formatInTimezone } from '../shared/time.ts';

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

/** The row of a title in the database. */
export interface TitleRow {
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
 * The genres and the countries of a page of titles.
 */
export function fetchRelations(
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
 * The rows of a page of titles.
 *
 * The rows come back in the order of the ids: the page of the search was
 * sorted by the score, and the list has to keep that order.
 */
export function fetchTitleRows(db: Db, ids: string[]): TitleRow[] {
  if (ids.length === 0) return [];
  const marks = ids.map(() => '?').join(', ');
  const rows = db.all<TitleRow>(
    `SELECT t.title_id, t.type, t.title, t.year, t.rating, t.category,
            t.director, t.description, t.duration_min, t.added_at,
            t.season_count, t.episode_count, NULL AS score
       FROM titles t
      WHERE t.title_id IN (${marks})`,
    ...ids,
  );

  const order = new Map(ids.map((id, index) => [id, index]));
  return rows.sort((left, right) => {
    const a = order.get(left.title_id) ?? 0;
    const b = order.get(right.title_id) ?? 0;
    return a - b;
  });
}

/**
 * Build the items of a page of titles.
 *
 * @param scoreOf The score of a row: the blend of the search, the distance
 *   of the similar search, or the bm25 of the words.
 */
export function buildItems(
  db: Db,
  rows: TitleRow[],
  options: { snippetChars: number; timezone: string },
  scoreOf: (row: TitleRow) => number,
): ListItem[] {
  const ids = rows.map((row) => row.title_id);
  const relations = fetchRelations(db, ids);

  return rows.map((row) => ({
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
    score: scoreOf(row),
  }));
}

/**
 * The day a title was added, as `YYYY-MM-DD` in the configured zone.
 *
 * The list item carries the date, not the moment: the full time is in the
 * details of the title.
 */
export function formatAdded(epochSeconds: number, timezone: string): string {
  const formatted = formatInTimezone(epochSeconds, timezone);
  if (!formatted) return '';
  return formatted.slice(0, 10);
}
