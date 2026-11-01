/**
 * schemas.ts - the contract of the tools of the TV Guide server.
 *
 * The schemas are the shapes the tools promise: the parameters they take
 * and the answer they give (design: iptv-mcp-servers.md §8.2, §8.3).
 *
 * The parameters are simple on purpose: a string, a number, a boolean, a
 * list of strings or one of a fixed set of strings. Pilot serves several
 * model providers, and the simple ones work with all of them.
 */

import { z } from 'zod';

import { KINDS } from './kind.ts';
import { THEMES } from './groups.ts';
import { PERIODS } from './periods.ts';

/** The kinds of programme, as the import derives them. */
export const kindSchema = z.enum(KINDS as unknown as [string, ...string[]]);

/** The themes of a channel, as the group map derives them. */
export const themeSchema = z.enum(THEMES as unknown as [string, ...string[]]);

/** The periods of the tools. */
export const periodSchema = z.enum(PERIODS as unknown as [string, ...string[]]);

/** The orders a search may ask for. */
export const sortSchema = z.enum(['relevance', 'time', 'channel']);

/** The parameters of `search_programs`. */
export const searchProgramsInput = z.object({
  query: z
    .string()
    .optional()
    .describe(
      'A description of what to look for, in any language: "биатлон в Швеции", "a film about loneliness in space". Matched against the title, the people and the description of the programmes.',
    ),
  keywords: z
    .array(z.string())
    .optional()
    .describe(
      'Exact words that have to count as matches: teams, places, venues, people. Example: ["Эстерсунд", "Швеция"] for a biathlon stage in Östersund.',
    ),
  kinds: z
    .array(kindSchema)
    .optional()
    .describe(
      'What the programme is: "film", "series", "animation", "animated_series", "documentary", "docuseries", "sport", "news", "kids", "music", "show" or "other". Example: ["film"].',
    ),
  period: periodSchema
    .optional()
    .describe(
      '"now" (on air), "tonight" (from 18:00, in the user zone), "today", "tomorrow", "next_24h", "next_7d", "past_24h", "past_7d". Ignored when from/to are given. Default: upcoming, from now to the end of the data.',
    ),
  from: z
    .string()
    .optional()
    .describe(
      'The start of an exact window, ISO date-time; without an offset it is read in the user zone. Example: "2026-06-15T20:00:00".',
    ),
  to: z
    .string()
    .optional()
    .describe('The end of an exact window, ISO date-time. The start of a programme has to lie before it.'),
  channel_themes: z
    .array(themeSchema)
    .optional()
    .describe(
      'The theme of the channel: "film", "sport", "news", "kids", "documentary", "music" or "general". "на киноканалах" is channel_themes=["film"].',
    ),
  channel_regions: z
    .array(z.string())
    .optional()
    .describe(
      'The country of the channel: an ISO code or a name in any language, or a group code such as "BALTIC". "на немецких каналах" is channel_regions=["DE"].',
    ),
  channels: z
    .array(z.string())
    .optional()
    .describe(
      'Channel ids or names, as list_channels gives them. Example: ["Матч ТВ HD"].',
    ),
  production_countries: z
    .array(z.string())
    .optional()
    .describe(
      'Where a film or series was made: an ISO code or a name in any language. "французские фильмы" is production_countries=["FR"].',
    ),
  year_from: z
    .number()
    .int()
    .min(1888)
    .max(2100)
    .optional()
    .describe('The earliest year of production, inclusive.'),
  year_to: z
    .number()
    .int()
    .min(1888)
    .max(2100)
    .optional()
    .describe('The latest year of production, inclusive.'),
  person: z
    .string()
    .optional()
    .describe('A director or an actor. Example: "Депардьё".'),
  only_catchup: z
    .boolean()
    .optional()
    .describe(
      'Only the ended programmes that have a catch-up link. Default: false.',
    ),
  hide_repeats: z
    .boolean()
    .optional()
    .describe(
      'One airing per title and channel family: the time-shifted copies disappear. Default: true.',
    ),
  prefer_hd: z
    .boolean()
    .optional()
    .describe(
      'The same programme at the same moment on several qualities: keep the best. Default: true.',
    ),
  sort: sortSchema
    .optional()
    .describe(
      '"relevance" (the default with query or keywords), "time" (the soonest first; a window in the past shows the newest first) or "channel".',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe('How many programmes to return. Default: 20.'),
  cursor: z
    .string()
    .optional()
    .describe('The next_cursor of the previous call, to read the next page.'),
});

/** One programme of a list. */
export const listItemSchema = z.object({
  program_id: z.string(),
  title: z.string(),
  kind: z.string(),
  channel: z.object({
    id: z.string(),
    name: z.string(),
    theme: z.string().nullable(),
    region: z.string().nullable(),
  }),
  start: z.string(),
  end: z.string(),
  status: z.enum(['past', 'live', 'upcoming']),
  year: z.number().nullable(),
  countries: z.array(z.string()),
  snippet: z.string(),
  has_live: z.boolean(),
  has_catchup: z.boolean(),
  score: z.number(),
});

/** The answer of `search_programs`. */
export const searchProgramsOutput = z.object({
  total: z.number(),
  search_mode: z.enum(['words', 'filters', 'words+meaning']),
  window: z.object({
    from: z.string().nullable(),
    to: z.string().nullable(),
  }),
  items: z.array(listItemSchema),
  next_cursor: z.string().nullable(),
});

/** The parameters of `get_program`. */
export const getProgramInput = z.object({
  program_id: z
    .string()
    .describe(
      'The id of a programme, as a list gives it. Example: "lnt@1781500000".',
    ),
});

/** The answer of `get_program`. */
export const getProgramOutput = z.object({
  program_id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  kind: z.string(),
  live_mark: z.boolean(),
  channel: z.object({
    id: z.string(),
    name: z.string(),
    theme: z.string().nullable(),
    region: z.string().nullable(),
    quality: z.string(),
    has_stream: z.boolean(),
    archive_days: z.number(),
  }),
  start: z.string(),
  end: z.string(),
  status: z.enum(['past', 'live', 'upcoming']),
  facts: z.object({
    year: z.number().nullable(),
    directors: z.array(z.string()),
    cast: z.array(z.string()),
    genres: z.array(z.string()),
    countries: z.array(z.object({ raw: z.string(), code: z.string().nullable() })),
    sport: z.string().nullable(),
    venue: z.string().nullable(),
  }),
  watch_live_url: z.string().nullable(),
  catchup_url: z.string().nullable(),
  catchup_refusal: z.string().nullable(),
  link_built_at: z.string(),
  other_airings: z.object({
    upcoming: z.array(
      z.object({
        program_id: z.string(),
        channel: z.string(),
        start: z.string(),
      }),
    ),
    archived: z.array(
      z.object({
        program_id: z.string(),
        channel: z.string(),
        start: z.string(),
        has_catchup: z.boolean(),
      }),
    ),
  }),
});

/** The parameters of `get_now_and_next`. */
export const getNowAndNextInput = z.object({
  channel_themes: z
    .array(themeSchema)
    .optional()
    .describe('Only the channels of these themes. Example: ["sport"].'),
  channel_regions: z
    .array(z.string())
    .optional()
    .describe('Only the channels of these countries: ISO codes or names. Example: ["DE"].'),
  channels: z
    .array(z.string())
    .optional()
    .describe('Only these channels, by id or name. Example: ["Матч ТВ HD"].'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe('How many channels to show. Default: 20.'),
});

/** The answer of `get_now_and_next`. */
export const nowAndNextItemSchema = z.object({
  channel: z.object({
    id: z.string(),
    name: z.string(),
    theme: z.string().nullable(),
    region: z.string().nullable(),
  }),
  current: z
    .object({
      program_id: z.string(),
      title: z.string(),
      kind: z.string(),
      start: z.string(),
      end: z.string(),
      percent_elapsed: z.number(),
    })
    .nullable(),
  next: z
    .object({
      program_id: z.string(),
      title: z.string(),
      kind: z.string(),
      start: z.string(),
    })
    .nullable(),
});

export const getNowAndNextOutput = z.object({
  moment: z.string(),
  total: z.number(),
  items: z.array(nowAndNextItemSchema),
});

/** The parameters of `get_channel_schedule`. */
export const getChannelScheduleInput = z.object({
  channel: z
    .string()
    .describe('A channel id or name, as list_channels gives it. Example: "Матч ТВ HD".'),
  date: z
    .string()
    .optional()
    .describe(
      'The day of the schedule, "YYYY-MM-DD", in the user zone. Example: "2026-06-15". Give a date or from/to.',
    ),
  from: z
    .string()
    .optional()
    .describe(
      'The start of the window, ISO date-time; without an offset it is read in the user zone. Give `from` and `to` together, or use `date`.',
    ),
  to: z
    .string()
    .optional()
    .describe('The end of the window, ISO date-time. Give `from` and `to` together, or use `date`.'),
  limit: z.number().int().min(1).max(200).optional().describe('How many programmes to return. Default: 100.'),
  cursor: z
    .string()
    .optional()
    .describe('The next_cursor of the previous call, to read the next page.'),
});

/** The answer of `get_channel_schedule`. */
export const getChannelScheduleOutput = z.object({
  channel: z.object({
    id: z.string(),
    name: z.string(),
    theme: z.string().nullable(),
    region: z.string().nullable(),
  }),
  window: z.object({
    from: z.string(),
    to: z.string(),
  }),
  total: z.number(),
  items: z.array(listItemSchema),
  next_cursor: z.string().nullable(),
});

/** The parameters of `find_airings`. */
export const findAiringsInput = z.object({
  title: z
    .string()
    .describe('The title to look for. Example: "Бык".'),
  year: z
    .number()
    .int()
    .min(1888)
    .max(2100)
    .optional()
    .describe('The year of production, when the title alone is not exact.'),
  include_past: z
    .boolean()
    .optional()
    .describe('Whether the airings that have ended are listed. Default: true.'),
});

/** The answer of `find_airings`. */
export const findAiringsOutput = z.object({
  title: z.string(),
  total: z.number(),
  upcoming: z.array(
    z.object({
      program_id: z.string(),
      channel: z.string(),
      start: z.string(),
    }),
  ),
  archived: z.array(
    z.object({
      program_id: z.string(),
      channel: z.string(),
      start: z.string(),
      has_catchup: z.boolean(),
    }),
  ),
});

/** The parameters of `list_channels`. */
export const listChannelsInput = z.object({
  theme: themeSchema
    .optional()
    .describe('Only the channels of this theme. Example: "film".'),
  region: z
    .string()
    .optional()
    .describe('Only the channels of this country or group: "DE", "Франция", "BALTIC".'),
  query: z
    .string()
    .optional()
    .describe('A part of a channel name. Example: "Матч".'),
  include_timeshift: z
    .boolean()
    .optional()
    .describe('Whether the time-shifted copies ("+2ч") are listed. Default: false.'),
  only_with_stream: z
    .boolean()
    .optional()
    .describe('Whether only the channels with a stream are listed. Default: true.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe('How many channels to return when filters are given. Default: 100.'),
});

/** The answer of `list_channels`. */
export const listChannelsOutput = z.object({
  mode: z.enum(['groups', 'channels']),
  total: z.number(),
  groups: z
    .array(
      z.object({
        group: z.string().nullable(),
        channels: z.number(),
        theme: z.string().nullable(),
        region: z.string().nullable(),
        with_archive: z.number(),
        archive_days: z.number(),
      }),
    )
    .optional(),
  channels: z
    .array(
      z.object({
        channel_id: z.string(),
        name: z.string(),
        theme: z.string().nullable(),
        region: z.string().nullable(),
        quality: z.string(),
        has_stream: z.boolean(),
        archive_days: z.number(),
      }),
    )
    .optional(),
});

/** The parameters of `get_status`. */
export const getStatusInput = z.object({});

/** The answer of `get_status`. */
export const getStatusOutput = z.object({
  settings_path: z.string(),
  epg_url: z.string(),
  live_url: z.string(),
  configured: z.boolean(),
  /** Where the EPG URL of the last import came from. */
  epg_url_source: z.enum(['settings', 'playlist-header', 'none']),
  settings_issues: z.array(z.string()),
  counts: z.object({
    channels: z.number(),
    programmes: z.number(),
    texts: z.number(),
    with_stream: z.number(),
    with_archive: z.number(),
  }),
  window: z.object({
    from: z.string().nullable(),
    to: z.string().nullable(),
  }),
  last_refresh: z.object({
    status: z.enum(['never', 'ok', 'unchanged', 'failed']),
    at: z.string().nullable(),
    last_success_at: z.string().nullable(),
    duration_ms: z.number(),
    programmes: z.number(),
    texts: z.number(),
    unchanged: z.boolean(),
    /** The programmes that took the default offset. */
    default_offsets: z.number(),
    error: z.string().nullable(),
  }),
  vectors: z.object({
    done: z.number(),
    pending: z.number(),
    model: z.string(),
    /** True when the search by meaning is available right now. */
    meaning: z.boolean(),
  }),
  search_mode: z.enum(['words', 'words+meaning']),
  embedding: z.object({
    running: z.boolean(),
    phase: z.string(),
    done: z.number(),
    pending: z.number(),
    error: z.string().nullable(),
    enabled: z.boolean(),
    available: z.boolean(),
    key_present: z.boolean(),
  }),
  refresh_running: z
    .object({
      running: z.boolean(),
      phase: z.string(),
      started_at_ms: z.number().nullable(),
      elapsed_ms: z.number(),
    })
    .nullable(),
  last_error: z.string().nullable(),
});

/** The parameters of `refresh_guide`. */
export const refreshGuideInput = z.object({
  force: z
    .boolean()
    .optional()
    .describe('Import the guide even when nothing changed at the provider. Default: false.'),
});

/** The answer of `refresh_guide`. */
export const refreshGuideOutput = z.object({
  status: z.enum(['started', 'already_running', 'not_configured']),
  settings_path: z.string(),
  message: z.string(),
});
