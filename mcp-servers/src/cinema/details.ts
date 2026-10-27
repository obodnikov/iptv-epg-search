/**
 * details.ts - the details of a title and the episodes of a series.
 *
 * These are the two tools that carry play links (design:
 * iptv-mcp-servers.md §5.4): a list never holds a link, so that fewer keys
 * of the provider reach the history of the chat.
 *
 * Every link that leaves the server goes through `sanitizeUrl`. A link that
 * fails the check is dropped and counted: the check is never relaxed to
 * make data pass.
 */

import { type Db } from '../shared/db.ts';
import { sanitizeUrl } from '../shared/links.ts';
import { formatInTimezone } from '../shared/time.ts';

/** A play link of a film. */
export interface Variant {
  quality: string;
  duration_min: number | null;
  play_url: string;
}

/** A season of a series. */
export interface Season {
  season: number;
  /** The number of episodes of the season. */
  episodes: number;
}

/** The country of a title. */
export interface TitleCountry {
  raw: string;
  code: string | null;
}

/** Everything the server knows about a title. */
export interface TitleDetails {
  title_id: string;
  type: 'film' | 'series';
  title: string;
  year: number | null;
  rating: number | null;
  category: string | null;
  director: string | null;
  description: string | null;
  poster_url: string | null;
  duration_min: number | null;
  /** The moment the title was added, with the offset of the zone. */
  added: string | null;
  /** The moment the title was added, as the provider wrote it. */
  added_raw: string | null;
  is_adult: boolean;
  is_new_tag: boolean;
  genres: string[];
  countries: TitleCountry[];
  season_count: number | null;
  episode_count: number | null;
  /** The moment the title was seen the first time. */
  first_seen: string | null;
  last_seen: string | null;
  /** True when the title is not in the catalogue any more. */
  removed: boolean;
  removed_at: string | null;
  /** The play links of a film. */
  variants: Variant[];
  /** The seasons of a series. */
  seasons: Season[];
  /** The links that were dropped because they were not http(s). */
  dropped_links: number;
}

/** One episode of a series. */
export interface EpisodeItem {
  season: number;
  episode: number;
  name: string | null;
  duration_min: number | null;
  play_url: string;
}

/** The episodes of a season. */
export interface EpisodePage {
  season: number;
  /** The number of the episodes of the season, as they are in the database. */
  total: number;
  items: EpisodeItem[];
  /**
   * The number of the rows the database gave for this page.
   *
   * The page advances by this number and not by the number of the items:
   * a row whose link was dropped still took its place in the order.
   */
  examined: number;
  /** The links that were dropped because they were not http(s). */
  dropped_links: number;
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
  poster_url: string | null;
  duration_min: number | null;
  added_at: number | null;
  added_raw: string | null;
  is_adult: number;
  is_new_tag: number;
  season_count: number | null;
  episode_count: number | null;
  first_seen_at: number;
  last_seen_at: number;
  removed_at: number | null;
}

/**
 * The first season of a series.
 *
 * The season is resolved before the cursor is signed: a call without a
 * season and a call with the season of the answer have to be the same
 * search.
 */
export function firstSeasonOf(db: Db, titleId: string): number {
  return (
    db.get<{ season: number | null }>(
      'SELECT min(season) AS season FROM episodes WHERE title_id = ?',
      titleId,
    )?.season ?? 1
  );
}

/**
 * The details of a title.
 *
 * @returns the details, or null when there is no title with that id.
 */
export function getTitleDetails(
  db: Db,
  titleId: string,
  timezone: string,
): TitleDetails | null {
  const row = db.get<TitleRow>('SELECT * FROM titles WHERE title_id = ?', titleId);
  if (!row) return null;

  const genres = db
    .all<{ genre: string }>(
      'SELECT genre FROM title_genres WHERE title_id = ? ORDER BY genre',
      titleId,
    )
    .map((entry) => entry.genre);

  const countries = db.all<{ raw: string; code: string | null }>(
    'SELECT raw, code FROM title_countries WHERE title_id = ? ORDER BY raw',
    titleId,
  );

  let droppedLinks = 0;

  // The poster is a link of the provider as well: it goes through the same
  // check as the play links.
  const posterUrl = row.poster_url ? sanitizeUrl(row.poster_url) : null;
  if (row.poster_url && !posterUrl) droppedLinks += 1;

  const variants: Variant[] = [];
  for (const variant of db.all<{
    quality: string;
    duration_min: number | null;
    stream_url: string;
  }>(
    'SELECT quality, duration_min, stream_url FROM variants WHERE title_id = ? ORDER BY quality',
    titleId,
  )) {
    const url = sanitizeUrl(variant.stream_url);
    if (!url) {
      droppedLinks += 1;
      continue;
    }
    variants.push({
      quality: variant.quality,
      duration_min: variant.duration_min,
      play_url: url,
    });
  }

  const seasons = db
    .all<{ season: number; episodes: number }>(
      'SELECT season, count(*) AS episodes FROM episodes WHERE title_id = ? GROUP BY season ORDER BY season',
      titleId,
    )
    .map((entry) => ({ season: entry.season, episodes: entry.episodes }));

  return {
    title_id: row.title_id,
    type: row.type === 'series' ? 'series' : 'film',
    title: row.title,
    year: row.year,
    rating: row.rating,
    category: row.category,
    director: row.director,
    description: row.description,
    poster_url: posterUrl,
    duration_min: row.duration_min,
    added: formatInTimezone(row.added_at, timezone),
    added_raw: row.added_raw,
    is_adult: row.is_adult === 1,
    is_new_tag: row.is_new_tag === 1,
    genres,
    countries,
    season_count: row.season_count,
    episode_count: row.episode_count,
    first_seen: formatInTimezone(row.first_seen_at, timezone),
    last_seen: formatInTimezone(row.last_seen_at, timezone),
    removed: row.removed_at !== null,
    removed_at: formatInTimezone(row.removed_at, timezone),
    variants,
    seasons,
    dropped_links: droppedLinks,
  };
}

/**
 * The episodes of one season of a series.
 *
 * @param season The season, or null for the first one.
 */
export function listEpisodes(
  db: Db,
  titleId: string,
  season: number | null,
  limit: number,
  offset: number,
): EpisodePage | null {
  const title = db.get<{ type: string; title: string }>(
    'SELECT type, title FROM titles WHERE title_id = ?',
    titleId,
  );
  if (!title) return null;

  const chosen = season ?? firstSeasonOf(db, titleId);

  const total =
    db.get<{ found: number }>(
      'SELECT count(*) AS found FROM episodes WHERE title_id = ? AND season = ?',
      titleId,
      chosen,
    )?.found ?? 0;

  const rows = db.all<{
    season: number;
    episode: number;
    name: string | null;
    duration_min: number | null;
    stream_url: string;
  }>(
    `SELECT season, episode, name, duration_min, stream_url
       FROM episodes
      WHERE title_id = ? AND season = ?
      ORDER BY episode
      LIMIT ? OFFSET ?`,
    titleId,
    chosen,
    limit,
    offset,
  );

  const items: EpisodeItem[] = [];
  let droppedLinks = 0;

  for (const row of rows) {
    const url = sanitizeUrl(row.stream_url);
    if (!url) {
      droppedLinks += 1;
      continue;
    }
    items.push({
      season: row.season,
      episode: row.episode,
      name: row.name,
      duration_min: row.duration_min,
      play_url: url,
    });
  }

  return {
    season: chosen,
    total,
    items,
    examined: rows.length,
    dropped_links: droppedLinks,
  };
}
