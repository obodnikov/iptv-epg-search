/**
 * render.ts - the compact text of the answers.
 *
 * The model reads the text first: one line per programme, with the fields
 * that matter and nothing else. The structure behind it holds the same
 * data.
 *
 * A list never carries a link: the text names what `get_program` would
 * build (design: iptv-mcp-servers.md §5.4).
 */

import type { ListItem } from './items.ts';
import type { SearchMode } from './search.ts';
import type { NowAndNextRow, ProgramRow } from './queries.ts';
import type { ChannelRow, GroupSummary } from './channels-read.ts';
import { catchupPossible } from './guide-links.ts';
import { formatInTimezone } from '../shared/time.ts';

/**
 * One airing, as one line.
 */
export function renderListItem(item: ListItem): string {
  const parts: string[] = [];

  const time = item.start.replace(/:\d{2}(\+|Z|$)/, '$1');
  parts.push(`[${item.program_id}] ${item.title} — ${time} … ${item.end}`);
  parts.push(`${item.channel.name} (${item.kind})`);

  if (item.status !== 'upcoming') parts.push(item.status);
  if (item.year !== null) parts.push(String(item.year));
  if (item.countries.length > 0) parts.push(item.countries.join(', '));
  parts.push(`live:${item.has_live ? 'yes' : 'no'}`);
  parts.push(`catchup:${item.has_catchup ? 'yes' : 'no'}`);

  const line = parts.join(' · ');

  return item.snippet ? `${line}\n    ${item.snippet}` : line;
}

/**
 * The text of a list of programmes.
 */
export function renderList(
  items: ListItem[],
  total: number,
  mode: SearchMode,
  usedWords: boolean,
): string {
  if (items.length === 0) return 'Nothing found.';

  const how =
    mode === 'words' ? 'word search' : usedWords ? 'word search' : 'filters only';
  const head = `${total} programme(s) found (${how}). Showing ${items.length}:`;
  return [head, ...items.map(renderListItem)].join('\n');
}

/**
 * The label of a channel quality, as the web app's scale reads.
 *
 * An empty label is a regular channel: the quality is not worth a mark.
 */
export function qualityLabel(quality: number): string {
  switch (quality) {
    case 0:
      return 'SD';
    case 2:
      return 'HD';
    case 3:
      return 'UHD';
    case 4:
      return '4K';
    default:
      return '';
  }
}

/**
 * One channel of a list, as one line.
 */
export function renderChannel(channel: ChannelRow): string {
  const parts: string[] = [`[${channel.channel_id}] ${channel.name}`];
  if (channel.theme) parts.push(channel.theme);
  if (channel.region) parts.push(channel.region);
  const quality = qualityLabel(channel.quality);
  if (quality) parts.push(quality);
  parts.push(channel.stream_url ? 'stream:yes' : 'stream:no');
  parts.push(
    channel.archive_days > 0 ? `archive:${channel.archive_days}d` : 'archive:no',
  );
  if (channel.timeshift_h !== 0) parts.push(`shift:+${channel.timeshift_h}h`);
  return parts.join(' · ');
}

/**
 * The text of the group summary of `list_channels`.
 */
export function renderGroupSummary(groups: GroupSummary[]): string {
  const lines = [`${groups.length} group(s):`];
  for (const group of groups) {
    const name = group.group ?? '(no group)';
    const theme = group.theme ?? 'mixed';
    const region = group.region ?? '—';
    const archive =
      group.with_archive > 0
        ? `${group.with_archive} with archive (${group.archive_days}d)`
        : 'no archive';
    lines.push(`${name} — ${group.channels} ch. · ${theme} · ${region} · ${archive}`);
  }
  return lines.join('\n');
}

/**
 * The text of a list of channels.
 */
export function renderChannels(channels: ChannelRow[], total: number): string {
  const head = `${total} channel(s), showing ${channels.length}:`;
  return [head, ...channels.map(renderChannel)].join('\n');
}

/**
 * The time of a text line, as the zone of the user shows it.
 */
function timeOf(epoch: number, timezone: string): string {
  return formatInTimezone(epoch, timezone) ?? String(epoch);
}

/**
 * One channel with its now and next, as one block of lines.
 */
function renderNowAndNextRow(row: NowAndNextRow, timezone: string, now: number): string[] {
  const lines = [renderChannel(row.channel)];

  if (row.current) {
    const total = Math.max(row.current.stop_utc - row.current.start_utc, 1);
    const percent = Math.min(
      100,
      Math.max(0, Math.round(((now - row.current.start_utc) / total) * 100)),
    );
    lines.push(
      `  now: ${row.current.title} (${row.current.kind}, ${timeOf(
        row.current.start_utc,
        timezone,
      )} … ${timeOf(row.current.stop_utc, timezone)}, ${percent}%) [${programIdOf(
        row.current,
      )}]`,
    );
  } else {
    lines.push('  now: —');
  }

  if (row.next) {
    lines.push(
      `  next: ${row.next.title} (${row.next.kind}, ${timeOf(
        row.next.start_utc,
        timezone,
      )}) [${programIdOf(row.next)}]`,
    );
  }

  return lines;
}

/**
 * The id of a programme row.
 */
function programIdOf(row: ProgramRow): string {
  return `${row.channel_id}@${row.start_utc}`;
}

/**
 * The text of `get_now_and_next`.
 */
export function renderNowAndNext(
  rows: NowAndNextRow[],
  total: number,
  timezone: string,
  now: number,
): string {
  if (rows.length === 0) return 'No channel matches.';

  const head = `${total} channel(s), showing ${rows.length}:`;
  const blocks = rows.flatMap((row) => renderNowAndNextRow(row, timezone, now));
  return [head, ...blocks].join('\n');
}

/**
 * The text of the schedule of one channel.
 */
export function renderSchedule(
  channel: ChannelRow,
  items: ListItem[],
  total: number,
): string {
  const head = `${channel.name}: ${total} programme(s) in the window, showing ${items.length}:`;
  if (items.length === 0) return head;
  return [head, ...items.map(renderListItem)].join('\n');
}

/**
 * One airing of `find_airings`, as one line.
 */
function renderAiring(row: ProgramRow, timezone: string, now: number, past: boolean): string {
  const parts: string[] = [
    `[${programIdOf(row)}] ${row.name} — ${timeOf(row.start_utc, timezone)} … ${timeOf(
      row.stop_utc,
      timezone,
    )}`,
  ];
  if (past) {
    // The same test the structured `has_catchup` applies, so that the text
    // cannot contradict the payload.
    const possible = catchupPossible(
      {
        stream_url: row.stream_url,
        archive_days: row.archive_days,
        catchup_type: row.catchup_type,
      },
      row.start_utc,
      row.stop_utc,
      now,
    );
    parts.push(`catchup:${possible ? 'yes' : 'no'}`);
  }
  return parts.join(' · ');
}

/**
 * The text of `find_airings`.
 */
export function renderAirings(
  title: string,
  upcoming: ProgramRow[],
  archived: ProgramRow[],
  total: number,
  timezone: string,
  now: number,
): string {
  if (total === 0) return `No airing of "${title}" in the guide.`;

  const lines: string[] = [`${total} airing(s) of "${title}" in the guide.`];

  if (upcoming.length > 0) {
    lines.push(`Upcoming (${upcoming.length}):`);
    for (const row of upcoming) {
      lines.push(`  ${renderAiring(row, timezone, now, false)}`);
    }
  } else {
    lines.push('Upcoming: none.');
  }

  if (archived.length > 0) {
    lines.push(`Archived (${archived.length}):`);
    for (const row of archived) {
      lines.push(`  ${renderAiring(row, timezone, now, true)}`);
    }
  }

  return lines.join('\n');
}

/** The rendered facts of `get_program`. */
export interface ProgramDetails {
  program_id: string;
  title: string;
  description: string | null;
  kind: string;
  live_mark: boolean;
  channel: {
    id: string;
    name: string;
    theme: string | null;
    region: string | null;
    quality: string;
    has_stream: boolean;
    archive_days: number;
  };
  start: string;
  end: string;
  status: 'past' | 'live' | 'upcoming';
  facts: {
    year: number | null;
    directors: string[];
    cast: string[];
    genres: string[];
    countries: { raw: string; code: string | null }[];
    sport: string | null;
    venue: string | null;
  };
  watch_live_url: string | null;
  catchup_url: string | null;
  catchup_refusal: string | null;
  link_built_at: string;
}

/**
 * The text of the details of one programme.
 */
export function renderProgramDetails(details: ProgramDetails): string {
  const lines: string[] = [];
  lines.push(`[${details.program_id}] ${details.title} — ${details.kind}`);
  lines.push(
    `${details.channel.name}${details.channel.quality ? ` (${details.channel.quality})` : ''} · ${details.start} … ${details.end} · ${details.status}`,
  );
  if (details.channel.theme) lines.push(`Theme of the channel: ${details.channel.theme}`);
  if (details.channel.region) lines.push(`Country of the channel: ${details.channel.region}`);
  if (!details.channel.has_stream) lines.push('The channel has no stream.');

  const facts: string[] = [];
  if (details.facts.year !== null) facts.push(String(details.facts.year));
  if (details.facts.countries.length > 0) {
    facts.push(
      details.facts.countries
        .map((country) => (country.code ? `${country.raw} (${country.code})` : country.raw))
        .join(', '),
    );
  }
  if (details.facts.directors.length > 0) facts.push(`реж. ${details.facts.directors.join(', ')}`);
  if (details.facts.cast.length > 0) facts.push(`в ролях: ${details.facts.cast.join(', ')}`);
  if (details.facts.genres.length > 0) facts.push(details.facts.genres.join(', '));
  if (details.facts.sport) facts.push(details.facts.sport);
  if (details.facts.venue) facts.push(`трансляция из ${details.facts.venue}`);
  if (facts.length > 0) lines.push(facts.join(' · '));
  if (details.live_mark) lines.push('The provider marks this airing as a live broadcast.');

  if (details.description) lines.push('', details.description);

  lines.push('', 'Links (fetched now; fetch again right before watching):');
  lines.push(
    details.watch_live_url
      ? `  Watch Live: ${details.watch_live_url}`
      : '  Watch Live: — (the channel has no stream)',
  );
  if (details.catchup_url) {
    lines.push(`  Catch-up: ${details.catchup_url}`);
  } else {
    lines.push(`  Catch-up: — (${details.catchup_refusal ?? 'not possible'})`);
  }

  return lines.join('\n');
}
