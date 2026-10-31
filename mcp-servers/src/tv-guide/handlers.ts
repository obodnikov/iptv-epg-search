/**
 * handlers.ts - what the tools of the TV Guide server do.
 *
 * Eight tools (design: tv-guide-server.md §7):
 *
 * - `search_programs` — the main search (`handler-search.ts`);
 * - `get_program` — the details and the Watch Live / Catch-up links;
 * - `get_now_and_next` — what every channel is showing now and next;
 * - `get_channel_schedule` — the programmes of one channel;
 * - `find_airings` — every airing of one title;
 * - `list_channels` — the groups, or the channels of a filter.
 *
 * The status and the refresh are in `handler-status.ts`.
 *
 * The descriptions of the tools are in `descriptions.ts`, and the
 * registration is in `tools.ts`.
 *
 * A list never carries a link: only `get_program` builds them, at call
 * time (design: tv-guide-server.md §6).
 */

import type { CallToolResult } from '@modelcontextprotocol/server';

import {
  decodeCursor,
  encodeCursor,
  errorResult,
  okResult,
} from '../shared/tool-kit.ts';
import { formatInTimezone } from '../shared/time.ts';
import { airingsOfTitle, channelSchedule, countriesOfTexts, nowAndNext, programRow, resolveTitleNorm, type ProgramRow } from './queries.ts';
import {
  channelById,
  channelList,
  groupSummaries,
  regionValues,
  resolveChannels,
  type ChannelRow,
} from './channels-read.ts';
import { buildItem, genresOf, parseProgramId, type ItemOptions, type ListItem } from './items.ts';
import {
  buildCatchupUrl,
  buildWatchLiveUrl,
  CATCHUP_REASONS,
  catchupPossible,
} from './guide-links.ts';
import { statusOf, localMidnight, isoToEpoch, wallClockToEpoch, localParts, localDateToEpoch } from './periods.ts';
import {
  qualityLabel,
  renderAirings,
  renderChannels,
  renderGroupSummary,
  renderNowAndNext,
  renderProgramDetails,
  renderSchedule,
  type ProgramDetails,
} from './render.ts';
import {
  adultRefused,
  checkThemes,
  cleanValues,
  guideEmptyResult,
  notConfigured,
  settingsOf,
  type GuideToolContext,
} from './tool-context.ts';

export { searchProgramsTool } from './handler-search.ts';
export { type GuideToolContext } from './tool-context.ts';

/**
 * The time of a schema field, as the zone of the user shows it.
 *
 * `formatInTimezone` answers null for a moment it cannot read; the output
 * schemas declare strings, so the fallback is the epoch itself.
 */
function timeText(epoch: number, timezone: string): string {
  return formatInTimezone(epoch, timezone) ?? String(epoch);
}

/**
 * A comma list out of a credit column.
 */
function splitList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/\s*,\s*/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * `get_program` — the details of one airing.
 */
export async function getProgramTool(
  ctx: GuideToolContext,
  args: { program_id: string },
): Promise<CallToolResult> {
  const settings = settingsOf(ctx);
  if (!settings.epgUrl && !settings.liveUrl) return notConfigured(ctx);

  const parsed = parseProgramId(args.program_id);
  if (!parsed) {
    return errorResult(
      `'${args.program_id}' is not a program id. The ids look like "channel-id@1781500000"; take one from search_programs or find_airings.`,
    );
  }

  const row = programRow(ctx.db, parsed.channelId, parsed.startUtc);
  if (!row) {
    return errorResult(
      `No programme with the id '${args.program_id}'. It may have left the guide; run the search again.`,
    );
  }

  const refused = adultRefused(settings, row.is_adult === 1);
  if (refused) return refused;

  const now = ctx.now();
  const timezone = settings.timezone;

  const countries = countriesOfTexts(ctx.db, [row.text_hash]).get(row.text_hash) ?? [];
  const live = buildWatchLiveUrl(row.stream_url);
  const catchup = buildCatchupUrl(
    {
      stream_url: row.stream_url,
      archive_days: row.archive_days,
      catchup_type: row.catchup_type,
    },
    row.start_utc,
    row.stop_utc,
    now,
  );

  // The next three upcoming and the latest three archived airings of the
  // same title; the programme itself is not its own other airing.
  const airings = airingsOfTitle(ctx.db, row.title_norm, {
    upcoming: 4,
    archived: 4,
    now,
    includeAdult: settings.includeAdult,
  });
  const selfId = args.program_id;
  const others = (rows: ProgramRow[]) =>
    rows
      .filter((entry) => `${entry.channel_id}@${entry.start_utc}` !== selfId)
      .slice(0, 3);

  const data = {
    program_id: selfId,
    title: row.title,
    description: row.description,
    kind: row.kind,
    live_mark: row.live_mark === 1,
    channel: {
      id: row.channel_id,
      name: row.name,
      theme: row.theme,
      region: row.region,
      quality: qualityLabel(row.quality),
      has_stream: row.stream_url !== null,
      archive_days: row.archive_days,
    },
    start: timeText(row.start_utc, timezone),
    end: timeText(row.stop_utc, timezone),
    status: statusOf(row.start_utc, row.stop_utc, now),
    facts: {
      year: row.year,
      directors: splitList(row.directors),
      cast: splitList(row.cast_names),
      genres: genresOf(row.genres),
      countries,
      sport: row.sport,
      venue: row.venue,
    },
    watch_live_url: live,
    catchup_url: catchup.ok ? catchup.url : null,
    catchup_refusal: catchup.ok ? null : CATCHUP_REASONS[catchup.reason],
    link_built_at: timeText(now, timezone),
    other_airings: {
      upcoming: others(airings.upcoming).map((entry) => ({
        program_id: `${entry.channel_id}@${entry.start_utc}`,
        channel: entry.name,
        start: timeText(entry.start_utc, timezone),
      })),
      archived: others(airings.archived).map((entry) => ({
        program_id: `${entry.channel_id}@${entry.start_utc}`,
        channel: entry.name,
        start: timeText(entry.start_utc, timezone),
        has_catchup: catchupPossible(
          {
            stream_url: entry.stream_url,
            archive_days: entry.archive_days,
            catchup_type: entry.catchup_type,
          },
          entry.start_utc,
          entry.stop_utc,
          now,
        ),
      })),
    },
  };

  const details: ProgramDetails = {
    program_id: data.program_id,
    title: data.title,
    description: data.description,
    kind: data.kind,
    live_mark: data.live_mark,
    channel: data.channel,
    start: data.start ?? String(row.start_utc),
    end: data.end ?? String(row.stop_utc),
    status: data.status,
    facts: data.facts,
    watch_live_url: data.watch_live_url,
    catchup_url: data.catchup_url,
    catchup_refusal: data.catchup_refusal,
    link_built_at: data.link_built_at ?? '',
  };

  return okResult(data, renderProgramDetails(details));
}

/**
 * `get_now_and_next` — what every channel is showing now and next.
 */
export async function getNowAndNextTool(
  ctx: GuideToolContext,
  args: {
    channel_themes?: string[];
    channel_regions?: string[];
    channels?: string[];
    limit?: number;
  },
): Promise<CallToolResult> {
  const settings = settingsOf(ctx);
  if (!settings.epgUrl && !settings.liveUrl) return notConfigured(ctx);

  const empty = guideEmptyResult(ctx);
  if (empty) return empty;

  const themes = cleanValues(args.channel_themes);
  const themeProblem = checkThemes(themes);
  if (themeProblem) return themeProblem;

  const channelsRaw = cleanValues(args.channels);
  const channels = resolveChannels(ctx.db, channelsRaw);
  if (channels.unknown.length > 0) {
    return errorResult(
      `Channel '${channels.unknown.join("', '")}' not found. Take the names from list_channels.`,
    );
  }

  const now = ctx.now();
  const regions = regionValues(cleanValues(args.channel_regions));

  // The time-shifted copies are left out unless they are named.
  const rows = nowAndNext(ctx.db, {
    themes,
    regions: [...regions.codes, ...regions.raws],
    channelIds: channels.ids,
    includeTimeshift: channelsRaw.length > 0,
    includeAdult: settings.includeAdult,
    now,
  });

  const total = rows.length;
  const limit = Math.min(args.limit ?? 20, 50);
  const shown = rows.slice(0, limit);

  const items = shown.map((row) => ({
    channel: {
      id: row.channel.channel_id,
      name: row.channel.name,
      theme: row.channel.theme,
      region: row.channel.region,
    },
    current:
      row.current === null
        ? null
        : (() => {
            const duration = Math.max(row.current.stop_utc - row.current.start_utc, 1);
            return {
              program_id: `${row.current.channel_id}@${row.current.start_utc}`,
              title: row.current.title,
              kind: row.current.kind,
              start: timeText(row.current.start_utc, settings.timezone),
              end: timeText(row.current.stop_utc, settings.timezone),
              percent_elapsed: Math.min(
                100,
                Math.max(0, Math.round(((now - row.current.start_utc) / duration) * 100)),
              ),
            };
          })(),
    next:
      row.next === null
        ? null
        : {
            program_id: `${row.next.channel_id}@${row.next.start_utc}`,
            title: row.next.title,
            kind: row.next.kind,
            start: timeText(row.next.start_utc, settings.timezone),
          },
  }));

  const data = {
    moment: timeText(now, settings.timezone),
    total,
    items,
  };

  return okResult(data, renderNowAndNext(shown, total, settings.timezone, now));
}

/**
 * The window of a schedule: a local day, or an exact pair.
 */
function scheduleWindow(
  args: { date?: string; from?: string; to?: string },
  timezone: string,
  now: number,
): { from: number; to: number } | { error: string } {
  if (args.date) {
    const day = localDateToEpoch(args.date, timezone);
    if (day === null) {
      return { error: `'${args.date}' is not a date the server can read. Use "YYYY-MM-DD".` };
    }
    const parts = localParts(day, timezone);
    return { from: day, to: wallClockToEpoch({ ...parts, day: parts.day + 1 }, timezone) };
  }

  if (args.from || args.to) {
    if (!args.from || !args.to) {
      return { error: 'Give a `date`, or both `from` and `to`.' };
    }
    const from = isoToEpoch(args.from, timezone);
    if (from === null) {
      return { error: `'${args.from}' is not a date-time the server can read. Use ISO.` };
    }
    const to = isoToEpoch(args.to, timezone);
    if (to === null) {
      return { error: `'${args.to}' is not a date-time the server can read. Use ISO.` };
    }
    if (from > to) {
      return { error: '`from` lies after `to`.' };
    }
    return { from, to };
  }

  // No window: the local day of now.
  const from = localMidnight(now, timezone);
  const parts = localParts(now, timezone);
  return { from, to: wallClockToEpoch({ ...parts, day: parts.day + 1 }, timezone) };
}

/**
 * `get_channel_schedule` — the programmes of one channel.
 */
export async function getChannelScheduleTool(
  ctx: GuideToolContext,
  args: {
    channel: string;
    date?: string;
    from?: string;
    to?: string;
    limit?: number;
    cursor?: string;
  },
): Promise<CallToolResult> {
  const settings = settingsOf(ctx);
  if (!settings.epgUrl && !settings.liveUrl) return notConfigured(ctx);

  const empty = guideEmptyResult(ctx);
  if (empty) return empty;

  const channels = resolveChannels(ctx.db, [args.channel]);
  if (channels.ids.length === 0) {
    return errorResult(
      `Channel '${args.channel}' not found. Take the names from list_channels.`,
    );
  }
  const channel: ChannelRow | null = channelById(ctx.db, channels.ids[0] as string);
  if (!channel) {
    return errorResult(`Channel '${args.channel}' not found.`);
  }

  // The schedule names programmes and times: an adult channel stays
  // closed unless the setting lets it in.
  const refused = adultRefused(settings, channel.is_adult === 1);
  if (refused) return refused;

  const now = ctx.now();
  const window = scheduleWindow(args, settings.timezone, now);
  if ('error' in window) return errorResult(window.error);

  const signature = `${channel.channel_id}|${window.from}|${window.to}`;

  let offset = 0;
  if (args.cursor) {
    const cursor = decodeCursor(args.cursor);
    if (!cursor) {
      return errorResult(
        'This cursor is not readable. Run the call again without a cursor.',
      );
    }
    if (cursor.signature !== signature) {
      return errorResult(
        'This cursor belongs to another schedule. Ask for the schedule again.',
      );
    }
    offset = cursor.offset;
  }

  const limit = Math.min(args.limit ?? 100, 200);
  const rows = channelSchedule(ctx.db, channel.channel_id, window.from, window.to);
  const total = rows.length;
  const page = rows.slice(offset, offset + limit);

  const itemOptions: ItemOptions = {
    now,
    timezone: settings.timezone,
    snippetChars: settings.search.snippetChars,
  };
  const hashes = [...new Set(page.map((row) => row.text_hash))];
  const countries = countriesOfTexts(ctx.db, hashes);

  const items: ListItem[] = page.map((row) =>
    buildItem(row, itemOptions, countries.get(row.text_hash)),
  );

  const nextOffset = offset + items.length;
  const nextCursor =
    nextOffset < total ? encodeCursor({ offset: nextOffset, signature }) : null;

  const data = {
    channel: {
      id: channel.channel_id,
      name: channel.name,
      theme: channel.theme,
      region: channel.region,
    },
    window: {
      from: timeText(window.from, settings.timezone),
      to: timeText(window.to, settings.timezone),
    },
    total,
    items,
    next_cursor: nextCursor,
  };

  return okResult(data, renderSchedule(channel, items, total));
}

/**
 * `find_airings` — every airing of one title.
 */
export async function findAiringsTool(
  ctx: GuideToolContext,
  args: { title: string; year?: number; include_past?: boolean },
): Promise<CallToolResult> {
  const settings = settingsOf(ctx);
  if (!settings.epgUrl && !settings.liveUrl) return notConfigured(ctx);

  const empty = guideEmptyResult(ctx);
  if (empty) return empty;

  const title = args.title.trim();
  if (!title) {
    return errorResult('Give a title to look for.');
  }

  const now = ctx.now();
  const titleNorm = resolveTitleNorm(ctx.db, title);
  if (!titleNorm) {
    const data = { title, total: 0, upcoming: [], archived: [] };
    return okResult(data, `No airing of "${title}" in the guide.`);
  }

  const includePast = args.include_past ?? true;
  const airings = airingsOfTitle(ctx.db, titleNorm, {
    upcoming: 50,
    archived: includePast ? 50 : 0,
    now,
    year: args.year ?? null,
    includeAdult: settings.includeAdult,
  });

  const data = {
    title,
    total: airings.total,
    upcoming: airings.upcoming.map((row) => ({
      program_id: `${row.channel_id}@${row.start_utc}`,
      channel: row.name,
      start: timeText(row.start_utc, settings.timezone),
    })),
    archived: airings.archived.map((row) => ({
      program_id: `${row.channel_id}@${row.start_utc}`,
      channel: row.name,
      start: timeText(row.start_utc, settings.timezone),
      has_catchup: catchupPossible(
        {
          stream_url: row.stream_url,
          archive_days: row.archive_days,
          catchup_type: row.catchup_type,
        },
        row.start_utc,
        row.stop_utc,
        now,
      ),
    })),
  };

  return okResult(
    data,
    renderAirings(
      title,
      airings.upcoming,
      airings.archived,
      airings.total,
      settings.timezone,
      now,
    ),
  );
}

/**
 * `list_channels` — the groups, or the channels of a filter.
 */
export async function listChannelsTool(
  ctx: GuideToolContext,
  args: {
    theme?: string;
    region?: string;
    query?: string;
    include_timeshift?: boolean;
    only_with_stream?: boolean;
    limit?: number;
  },
): Promise<CallToolResult> {
  const settings = settingsOf(ctx);
  if (!settings.epgUrl && !settings.liveUrl) return notConfigured(ctx);

  const theme = args.theme?.trim() ?? '';
  const region = args.region?.trim() ?? '';
  const query = args.query?.trim() ?? '';

  const themeProblem = checkThemes(theme ? [theme] : []);
  if (themeProblem) return themeProblem;

  // Without a filter the groups are the answer: they name the values the
  // filters take.
  if (!theme && !region && !query) {
    const groups = groupSummaries(ctx.db, settings.includeAdult);
    const data = { mode: 'groups' as const, total: groups.length, groups };
    return okResult(data, renderGroupSummary(groups));
  }

  const regions = regionValues(region ? [region] : []);
  const list = channelList(ctx.db, {
    theme: theme || undefined,
    regions: [...regions.codes, ...regions.raws],
    query: query || undefined,
    includeTimeshift: args.include_timeshift ?? false,
    onlyWithStream: args.only_with_stream ?? true,
    includeAdult: settings.includeAdult,
  });

  const total = list.length;
  const limit = Math.min(args.limit ?? 100, 200);
  const shown = list.slice(0, limit);

  const data = {
    mode: 'channels' as const,
    total,
    channels: shown.map((channel) => ({
      channel_id: channel.channel_id,
      name: channel.name,
      theme: channel.theme,
      region: channel.region,
      quality: qualityLabel(channel.quality),
      has_stream: channel.stream_url !== null,
      archive_days: channel.archive_days,
    })),
  };

  return okResult(data, renderChannels(shown, total));
}
