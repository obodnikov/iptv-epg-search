/**
 * items.ts - the rows of the guide, as the tools show them.
 *
 * The list item is the record of the design (tv-guide-server.md §7):
 * `program_id, title, kind, channel, start, end, status, year, countries,
 * snippet, has_live, has_catchup, score`.
 *
 * A list never carries a link: `has_live` and `has_catchup` say what
 * `get_program` would build.
 */

import { snippet } from '../shared/text.ts';
import { formatInTimezone } from '../shared/time.ts';
import { catchupPossible } from './guide-links.ts';
import type { ProgramRow } from './queries.ts';
import type { ProgramStatus } from './periods.ts';
import { statusOf } from './periods.ts';

/** One airing, as a list shows it. */
export interface ListItem {
  program_id: string;
  title: string;
  kind: string;
  channel: {
    id: string;
    name: string;
    theme: string | null;
    region: string | null;
  };
  start: string;
  end: string;
  status: ProgramStatus;
  year: number | null;
  countries: string[];
  snippet: string;
  has_live: boolean;
  has_catchup: boolean;
  score: number;
}

/**
 * The id of a programme: `<channel_id>@<start_utc>`.
 *
 * It is stable while the programme stays in the guide
 * (tv-guide-server.md §4.5).
 */
export function programIdOf(channelId: string, startUtc: number): string {
  return `${channelId}@${startUtc}`;
}

/**
 * The channel and the start of a programme id.
 *
 * The channel id may hold an `@` itself; the start is after the last one.
 *
 * @returns the parts, or null when the id cannot be read.
 */
export function parseProgramId(
  programId: string,
): { channelId: string; startUtc: number } | null {
  const at = programId.lastIndexOf('@');
  if (at <= 0 || at === programId.length - 1) return null;
  const startUtc = Number(programId.slice(at + 1));
  if (!Number.isInteger(startUtc) || !Number.isFinite(startUtc)) return null;
  return { channelId: programId.slice(0, at), startUtc };
}

/**
 * The genres of a text, out of their JSON column.
 */
export function genresOf(json: string | null): string[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
}

/**
 * The options the items of an answer are built with.
 */
export interface ItemOptions {
  /** The moment the statuses are relative to, in epoch seconds. */
  now: number;
  timezone: string;
  snippetChars: number;
}

/**
 * The countries of an item, out of the rows of `text_countries`.
 */
export function countryNames(
  countries: { raw: string; code: string | null }[] | undefined,
): string[] {
  const list = countries ?? [];
  return list.map((country) => country.code ?? country.raw);
}

/**
 * Build a list item out of a row of the guide.
 *
 * @param countries The countries of the text of the programme.
 * @param scoreOf The score of the row, when the search has one.
 */
export function buildItem(
  row: ProgramRow,
  options: ItemOptions,
  countries: { raw: string; code: string | null }[] | undefined,
  score = 0,
): ListItem {
  const start = formatInTimezone(row.start_utc, options.timezone) ?? String(row.start_utc);
  const end = formatInTimezone(row.stop_utc, options.timezone) ?? String(row.stop_utc);

  return {
    program_id: programIdOf(row.channel_id, row.start_utc),
    title: row.title,
    kind: row.kind,
    channel: {
      id: row.channel_id,
      name: row.name,
      theme: row.theme,
      region: row.region,
    },
    start,
    end,
    status: statusOf(row.start_utc, row.stop_utc, options.now),
    year: row.year,
    countries: countryNames(countries),
    snippet: snippet(row.description ?? '', options.snippetChars),
    has_live: row.stream_url !== null,
    has_catchup: catchupPossible(
      {
        stream_url: row.stream_url,
        archive_days: row.archive_days,
        catchup_type: row.catchup_type,
      },
      row.start_utc,
      row.stop_utc,
      options.now,
    ),
    score,
  };
}
