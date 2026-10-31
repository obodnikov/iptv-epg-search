/**
 * handler-search.ts - the `search_programs` tool.
 *
 * The search of phase T3 runs on the words alone: the filters are applied
 * in SQL, the words are matched in the keyword index, the repeats are
 * collapsed, the result is sorted and cut. The meaning of the query comes
 * with phase T4.
 */

import type { CallToolResult } from '@modelcontextprotocol/server';

import {
  cursorMismatchMessage,
  errorResult,
  okResult,
} from '../shared/tool-kit.ts';
import { formatInTimezone } from '../shared/time.ts';
import { exactWindow, isoToEpoch, isPeriod, PERIODS, periodWindow, upcomingWindow } from './periods.ts';
import { regionValues, resolveChannels } from './channels-read.ts';
import { decodeSearchCursor, encodeSearchCursor, searchPrograms, searchSignature } from './search.ts';
import { renderList } from './render.ts';
import {
  checkKinds,
  checkThemes,
  cleanValues,
  guideEmptyResult,
  MAX_LIMIT,
  notConfigured,
  settingsOf,
  type GuideToolContext,
} from './tool-context.ts';

/**
 * `search_programs` — the main search of the guide.
 */
export async function searchProgramsTool(
  ctx: GuideToolContext,
  args: {
    query?: string;
    keywords?: string[];
    kinds?: string[];
    period?: string;
    from?: string;
    to?: string;
    channel_themes?: string[];
    channel_regions?: string[];
    channels?: string[];
    production_countries?: string[];
    year_from?: number;
    year_to?: number;
    person?: string;
    only_catchup?: boolean;
    hide_repeats?: boolean;
    prefer_hd?: boolean;
    sort?: 'relevance' | 'time' | 'channel';
    limit?: number;
    cursor?: string;
  },
): Promise<CallToolResult> {
  const settings = settingsOf(ctx);
  if (!settings.epgUrl && !settings.liveUrl) return notConfigured(ctx);

  const empty = guideEmptyResult(ctx);
  if (empty) return empty;

  const query = args.query?.trim() ?? '';
  const keywords = cleanValues(args.keywords);
  const person = args.person?.trim() ?? '';
  const kinds = cleanValues(args.kinds);
  const themes = cleanValues(args.channel_themes);
  const regionsRaw = cleanValues(args.channel_regions);
  const channelsRaw = cleanValues(args.channels);
  const countriesRaw = cleanValues(args.production_countries);

  const kindProblem = checkKinds(kinds);
  if (kindProblem) return kindProblem;
  const themeProblem = checkThemes(themes);
  if (themeProblem) return themeProblem;

  const channels = resolveChannels(ctx.db, channelsRaw);
  if (channels.unknown.length > 0) {
    return errorResult(
      `Channel '${channels.unknown.join("', '")}' not found. Take the names from list_channels.`,
    );
  }

  const regions = regionValues(regionsRaw);
  const countries = regionValues(countriesRaw);

  const timezone = settings.timezone;
  const tonightFromHour = settings.tonightFromHour;

  // The relevance order is the default when the request carries words.
  const sort = args.sort ?? (query.length > 0 || keywords.length > 0 ? 'relevance' : 'time');

  const signature = searchSignature({
    query,
    keywords,
    person,
    kinds,
    period: args.period ?? null,
    from: args.from ?? null,
    to: args.to ?? null,
    themes,
    regions: regionsRaw,
    channels: channelsRaw,
    productionCountries: countriesRaw,
    yearFrom: args.year_from ?? null,
    yearTo: args.year_to ?? null,
    onlyCatchup: args.only_catchup ?? false,
    hideRepeats: args.hide_repeats ?? true,
    preferHd: args.prefer_hd ?? true,
    sort,
    timezone,
    tonightFromHour,
  });

  // The cursor belongs to one search: it may not be used for another one.
  // The moment of the search rides in the cursor: a page is read minutes
  // after the first call, and the window moves with the moment.
  let offset = 0;
  let now = ctx.now();
  if (args.cursor) {
    const cursor = decodeSearchCursor(args.cursor);
    if (!cursor) {
      return errorResult(
        'This cursor is not readable. Run the search again without a cursor.',
      );
    }
    if (cursor.signature !== signature) {
      return errorResult(cursorMismatchMessage());
    }
    offset = cursor.offset;
    now = cursor.now;
  }

  // The window: an exact from/to pair wins over a period; the default is
  // upcoming, from now to the end of the data.
  let window;
  if (args.from || args.to) {
    const from = args.from ? isoToEpoch(args.from, timezone) : null;
    if (args.from && from === null) {
      return errorResult(
        `'${args.from}' is not a date-time the server can read. Use ISO, e.g. "2026-06-15T20:00:00".`,
      );
    }
    const to = args.to ? isoToEpoch(args.to, timezone) : null;
    if (args.to && to === null) {
      return errorResult(
        `'${args.to}' is not a date-time the server can read. Use ISO, e.g. "2026-06-15T23:00:00".`,
      );
    }
    if (from !== null && to !== null && from > to) {
      return errorResult('`from` lies after `to`.');
    }
    window = exactWindow(from, to, now);
  } else if (args.period) {
    if (!isPeriod(args.period)) {
      return errorResult(`Period '${args.period}' not found. Valid: ${PERIODS.join(', ')}.`);
    }
    window = periodWindow(args.period, now, timezone, tonightFromHour);
  } else {
    window = upcomingWindow(now);
  }

  const limit = Math.min(
    args.limit ?? settings.search.defaultLimit,
    settings.search.maxLimit,
    MAX_LIMIT,
  );

  const outcome = searchPrograms(
    ctx.db,
    {
      query,
      keywords,
      person,
      kinds,
      window: {
        field: window.field,
        from: window.from,
        to: window.to,
        onAir: window.onAir,
        onAirFrom: window.onAirFrom,
      },
      themes,
      regions: [...regions.codes, ...regions.raws],
      channelIds: channels.ids,
      productionCountries: countries,
      yearFrom: args.year_from ?? null,
      yearTo: args.year_to ?? null,
      onlyCatchup: args.only_catchup ?? false,
      hideRepeats: args.hide_repeats ?? true,
      preferHd: args.prefer_hd ?? true,
      sort,
    },
    {
      now,
      timezone,
      snippetChars: settings.search.snippetChars,
      includeAdult: settings.includeAdult,
    },
    limit,
    offset,
  );

  const nextOffset = offset + outcome.items.length;
  const nextCursor =
    nextOffset < outcome.total
      ? encodeSearchCursor({ offset: nextOffset, signature, now })
      : null;

  const data = {
    total: outcome.total,
    search_mode: outcome.mode,
    window: {
      from: window.from === null ? null : formatInTimezone(window.from, timezone),
      to: window.to === null ? null : formatInTimezone(window.to, timezone),
    },
    items: outcome.items,
    next_cursor: nextCursor,
  };

  return okResult(
    data,
    renderList(outcome.items, outcome.total, outcome.mode, outcome.usedWords),
  );
}
