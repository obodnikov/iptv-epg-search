/**
 * facets.ts - the values a search may be filtered by.
 *
 * The model never guesses a spelling: it asks for the facets first
 * (design: iptv-mcp-servers.md §8.2). The counts are of the titles that
 * are in the catalogue now.
 *
 * The adult content is left out unless the setting allows it: the adult
 * categories and their titles are not in the answer.
 */

import { type Db } from '../shared/db.ts';
import { countryName } from '../shared/countries.ts';
import { formatInTimezone } from '../shared/time.ts';

/** A value of a closed set with the number of titles that have it. */
export interface FacetValue {
  name: string;
  count: number;
}

/** A country with the number of titles that were made there. */
export interface CountryFacet {
  /** The ISO 3166-1 alpha-2 code, or null when the name is not known. */
  code: string | null;
  /** The name of the country in English, or the raw value of the provider. */
  name: string;
  count: number;
}

/** The totals of the catalogue. */
export interface FacetTotals {
  titles: number;
  films: number;
  series: number;
}

/** The answer of `list_facets`. */
export interface Facets {
  totals: FacetTotals;
  categories: FacetValue[];
  genres: FacetValue[];
  countries: CountryFacet[];
  year_from: number | null;
  year_to: number | null;
  rating_from: number | null;
  rating_to: number | null;
  /** The newest day a title was added. */
  newest_added: string | null;
  /** The number of the titles the provider tagged "Новинки". */
  new_tag_count: number;
}

/**
 * The facets of the catalogue.
 */
export function listFacets(db: Db, includeAdult: boolean, timezone: string): Facets {
  const adultClause = includeAdult ? '' : 'AND is_adult = 0';

  const totals = db.get<{ titles: number; films: number; series: number }>(
    `SELECT count(*) AS titles,
            sum(CASE WHEN type = 'film' THEN 1 ELSE 0 END) AS films,
            sum(CASE WHEN type = 'series' THEN 1 ELSE 0 END) AS series
       FROM titles
      WHERE removed_at IS NULL ${adultClause}`,
  );

  const categories = db.all<{ name: string; count: number }>(
    `SELECT category AS name, count(*) AS count
       FROM titles
      WHERE removed_at IS NULL AND category IS NOT NULL AND category != '' ${adultClause}
      GROUP BY category
      ORDER BY count DESC, category`,
  );

  const genres = db.all<{ name: string; count: number }>(
    `SELECT g.genre AS name, count(*) AS count
       FROM title_genres g
       JOIN titles t ON t.title_id = g.title_id
      WHERE t.removed_at IS NULL ${includeAdult ? '' : 'AND t.is_adult = 0'}
      GROUP BY g.genre
      ORDER BY count DESC, g.genre`,
  );

  // The countries are counted per name of the provider. A title that was
  // made in two countries is in both of them.
  const countryRows = db.all<{ code: string | null; raw: string; count: number }>(
    `SELECT c.code AS code, c.raw AS raw, count(*) AS count
       FROM title_countries c
       JOIN titles t ON t.title_id = c.title_id
      WHERE t.removed_at IS NULL ${includeAdult ? '' : 'AND t.is_adult = 0'}
      GROUP BY c.code, c.raw
      ORDER BY count DESC, c.raw`,
  );

  const countries: CountryFacet[] = [];
  const seen = new Set<string>();
  for (const row of countryRows) {
    const key = `${row.code ?? ''}|${row.raw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    countries.push({
      code: row.code,
      name: row.code ? countryName(row.code) : row.raw,
      count: row.count,
    });
  }

  const years = db.get<{ min_year: number | null; max_year: number | null }>(
    `SELECT min(year) AS min_year, max(year) AS max_year
       FROM titles
      WHERE removed_at IS NULL AND year IS NOT NULL ${adultClause}`,
  );

  const ratings = db.get<{ min_rating: number | null; max_rating: number | null }>(
    `SELECT min(rating) AS min_rating, max(rating) AS max_rating
       FROM titles
      WHERE removed_at IS NULL AND rating IS NOT NULL ${adultClause}`,
  );

  const newest = db.get<{ added_at: number | null }>(
    `SELECT max(added_at) AS added_at
       FROM titles
      WHERE removed_at IS NULL AND added_at IS NOT NULL ${adultClause}`,
  );

  const newTag = db.get<{ found: number }>(
    `SELECT count(*) AS found
       FROM titles
      WHERE removed_at IS NULL AND is_new_tag = 1 ${adultClause}`,
  );

  return {
    totals: {
      titles: totals?.titles ?? 0,
      films: totals?.films ?? 0,
      series: totals?.series ?? 0,
    },
    categories,
    genres,
    countries,
    year_from: years?.min_year ?? null,
    year_to: years?.max_year ?? null,
    rating_from: ratings?.min_rating ?? null,
    rating_to: ratings?.max_rating ?? null,
    newest_added: formatInTimezone(newest?.added_at ?? null, timezone),
    new_tag_count: newTag?.found ?? 0,
  };
}
