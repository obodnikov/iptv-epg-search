/**
 * schemas.ts - the contract of the tools of the cinema server.
 *
 * The schemas are the shapes the tools promise: the parameters they take
 * and the answer they give (design: iptv-mcp-servers.md §8.2, §8.3).
 *
 * The parameters are simple on purpose: a string, a number, a boolean, a
 * list of strings or one of a fixed set of strings. Pilot serves several
 * model providers, and the simple ones work with all of them.
 */

import { z } from 'zod';

/** The kinds of title a search may ask for. */
export const titleTypeSchema = z.enum(['film', 'series', 'any']);

/** The orders a search may ask for. */
export const sortSchema = z.enum([
  'relevance',
  'rating',
  'year_desc',
  'year_asc',
  'added',
  'title',
]);

/** The parameters of `search_titles`. */
export const searchTitlesInput = z.object({
  query: z
    .string()
    .optional()
    .describe(
      'A description of what to look for, in any language: "quiet French drama about a family". Matched against the title, the director and the description of the titles.',
    ),
  keywords: z
    .array(z.string())
    .optional()
    .describe(
      'Exact words that have to count as matches: a title, a director, a place. Example: ["Кали", "Julien Seri"].',
    ),
  type: titleTypeSchema
    .optional()
    .describe('"film", "series" or "any". Default: any.'),
  categories: z
    .array(z.string())
    .optional()
    .describe(
      'The categories of the catalogue, as list_facets gives them. Example: ["Зарубежные фильмы"].',
    ),
  genres: z
    .array(z.string())
    .optional()
    .describe(
      'At least one of these genres has to match. The values of list_facets, with the spelling of the provider: ["Драма"].',
    ),
  exclude_genres: z
    .array(z.string())
    .optional()
    .describe('None of these genres may match. Example: ["Эротика (18+)"].'),
  countries: z
    .array(z.string())
    .optional()
    .describe(
      'The country the film was made in: an ISO code or a name in any language. Example: ["FR"], ["France"], ["Франция"].',
    ),
  year_from: z
    .number()
    .int()
    .min(1888)
    .max(2100)
    .optional()
    .describe('The earliest year, inclusive.'),
  year_to: z
    .number()
    .int()
    .min(1888)
    .max(2100)
    .optional()
    .describe('The latest year, inclusive.'),
  min_rating: z
    .number()
    .min(0)
    .max(10)
    .optional()
    .describe('The lowest provider rating, 0 to 10. The rating is the score of the provider.'),
  person: z
    .string()
    .optional()
    .describe('A director. Also matched in the description of the titles.'),
  max_minutes: z
    .number()
    .int()
    .min(1)
    .max(1440)
    .optional()
    .describe('The length of a film, or the length of an episode of a series, in minutes.'),
  added_within_days: z
    .number()
    .int()
    .min(1)
    .max(3650)
    .optional()
    .describe('Only the titles the provider added in the last N days.'),
  sort: sortSchema
    .optional()
    .describe(
      '"relevance" (the default when there are words), "rating", "year_desc", "year_asc", "added" (the newest first, the default without words) or "title".',
    ),
  limit: z.number().int().min(1).max(50).optional().describe('How many titles to return. Default: 20.'),
  cursor: z
    .string()
    .optional()
    .describe('The next_cursor of the previous call, to read the next page.'),
});

/** One title of a list. */
export const listItemSchema = z.object({
  title_id: z.string(),
  type: z.enum(['film', 'series']),
  title: z.string(),
  year: z.number().nullable(),
  rating: z.number().nullable(),
  genres: z.array(z.string()),
  countries: z.array(z.string()),
  category: z.string().nullable(),
  director: z.string().nullable(),
  seasons: z.number().nullable(),
  episodes: z.number().nullable(),
  duration_min: z.number().nullable(),
  added: z.string().nullable(),
  snippet: z.string(),
  score: z.number(),
});

/** The answer of `search_titles`. */
export const searchTitlesOutput = z.object({
  total: z.number(),
  search_mode: z.enum(['words', 'words+meaning']),
  items: z.array(listItemSchema),
  next_cursor: z.string().nullable(),
});

/** The parameters of `get_title`. */
export const getTitleInput = z.object({
  title_id: z
    .string()
    .describe('The id of a title, as the list of search_titles gives it.'),
});

/** The answer of `get_title`. */
export const getTitleOutput = z.object({
  title_id: z.string(),
  type: z.enum(['film', 'series']),
  title: z.string(),
  year: z.number().nullable(),
  rating: z.number().nullable(),
  category: z.string().nullable(),
  director: z.string().nullable(),
  description: z.string().nullable(),
  poster_url: z.string().nullable(),
  duration_min: z.number().nullable(),
  added: z.string().nullable(),
  added_raw: z.string().nullable(),
  is_adult: z.boolean(),
  is_new_tag: z.boolean(),
  genres: z.array(z.string()),
  countries: z.array(z.object({ raw: z.string(), code: z.string().nullable() })),
  season_count: z.number().nullable(),
  episode_count: z.number().nullable(),
  first_seen: z.string().nullable(),
  last_seen: z.string().nullable(),
  removed: z.boolean(),
  removed_at: z.string().nullable(),
  variants: z.array(
    z.object({
      quality: z.string(),
      duration_min: z.number().nullable(),
      play_url: z.string(),
    }),
  ),
  seasons: z.array(z.object({ season: z.number(), episodes: z.number() })),
  dropped_links: z.number(),
});

/** The parameters of `list_episodes`. */
export const listEpisodesInput = z.object({
  title_id: z.string().describe('The id of a series, as the list of search_titles gives it.'),
  season: z.number().int().optional().describe('The season. Default: the first one.'),
  limit: z.number().int().min(1).max(200).optional().describe('How many episodes to return. Default: 50.'),
  cursor: z
    .string()
    .optional()
    .describe('The next_cursor of the previous call, to read the next page.'),
});

/** The answer of `list_episodes`. */
export const listEpisodesOutput = z.object({
  season: z.number(),
  total: z.number(),
  items: z.array(
    z.object({
      season: z.number(),
      episode: z.number(),
      name: z.string().nullable(),
      duration_min: z.number().nullable(),
      play_url: z.string(),
    }),
  ),
  next_cursor: z.string().nullable(),
  /** The links that were dropped because they were not http(s). */
  dropped_links: z.number(),
});

/** The parameters of `list_facets`. */
export const listFacetsInput = z.object({});

/** The answer of `list_facets`. */
export const listFacetsOutput = z.object({
  totals: z.object({
    titles: z.number(),
    films: z.number(),
    series: z.number(),
  }),
  categories: z.array(z.object({ name: z.string(), count: z.number() })),
  genres: z.array(z.object({ name: z.string(), count: z.number() })),
  countries: z.array(
    z.object({ code: z.string().nullable(), name: z.string(), count: z.number() }),
  ),
  year_from: z.number().nullable(),
  year_to: z.number().nullable(),
  rating_from: z.number().nullable(),
  rating_to: z.number().nullable(),
  newest_added: z.string().nullable(),
  new_tag_count: z.number(),
});

/** The parameters of `get_status`. */
export const getStatusInput = z.object({});

/** The answer of `get_status`. */
export const getStatusOutput = z.object({
  settings_path: z.string(),
  cinema_url: z.string(),
  configured: z.boolean(),
  /** The problems of the settings file, as sentences. */
  settings_issues: z.array(z.string()),
  last_refresh: z.object({
    status: z.enum(['never', 'ok', 'unchanged', 'failed']),
    at: z.string().nullable(),
    ok: z.boolean(),
    last_success_at: z.string().nullable(),
    duration_ms: z.number(),
    entries: z.number(),
    rejected: z.number(),
    incomplete: z.number(),
    titles: z.number(),
    unchanged: z.boolean(),
    error: z.string().nullable(),
  }),
  counts: z.object({
    titles: z.number(),
    films: z.number(),
    series: z.number(),
    removed: z.number(),
    episodes: z.number(),
    variants: z.number(),
  }),
  vectors: z.object({
    done: z.number(),
    pending: z.number(),
    model: z.string(),
    meaning: z.boolean(),
  }),
  search_mode: z.enum(['words', 'words+meaning']),
  refresh_running: z
    .object({
      running: z.boolean(),
      phase: z.string(),
      /** The moment the refresh started, in epoch milliseconds. */
      started_at_ms: z.number().nullable(),
      /** How long the refresh has been running, in milliseconds. */
      elapsed_ms: z.number(),
    })
    .nullable(),
  last_error: z.string().nullable(),
});

/** The parameters of `refresh_catalog`. */
export const refreshCatalogInput = z.object({
  force: z
    .boolean()
    .optional()
    .describe('Import the catalogue even when the file of the provider did not change. Default: false.'),
});

/** The answer of `refresh_catalog`. */
export const refreshCatalogOutput = z.object({
  status: z.enum(['started', 'already_running', 'not_configured']),
  settings_path: z.string(),
  message: z.string(),
});
