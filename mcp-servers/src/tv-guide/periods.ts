/**
 * periods.ts - the time windows of the tools.
 *
 * The tools speak in periods, not in raw times (design:
 * tv-guide-server.md §7): "tonight", "tomorrow", "the past day". Every
 * period is computed in the configured time zone, from the local wall
 * clock of the moment - never by dropping an offset of the provider.
 *
 * The windows of the provider times are epoch seconds; the walls of a
 * local day are found with the offset of the zone at that very moment, so
 * that a daylight-saving change moves the wall with the clock.
 */

import {
  formatInTimezone,
  offsetOf,
  parseProviderTimestamp,
} from '../shared/time.ts';

/** The periods a search may ask for. */
export type Period =
  | 'now'
  | 'tonight'
  | 'today'
  | 'tomorrow'
  | 'next_24h'
  | 'next_7d'
  | 'past_24h'
  | 'past_7d';

/** Every period, for the error messages. */
export const PERIODS: readonly Period[] = [
  'now',
  'tonight',
  'today',
  'tomorrow',
  'next_24h',
  'next_7d',
  'past_24h',
  'past_7d',
];

/** True when the value is a period the tools know. */
export function isPeriod(value: string): value is Period {
  return (PERIODS as readonly string[]).includes(value);
}

/**
 * A window over the times of the programmes, in epoch seconds.
 *
 * `from` is inclusive, `to` is exclusive. A null bound is open: the
 * default search runs from now to the end of the data.
 */
export interface TimeWindow {
  /** The window applies to the start of a programme, or to its stop. */
  field: 'start' | 'stop';
  from: number | null;
  to: number | null;
  /**
   * True when a programme counts that is on air right now: its start lies
   * before `moment` and its stop after it. `now`, `today` and `tonight`
   * set it.
   */
  onAir: boolean;
  /**
   * The floor of the on-air clause, in epoch seconds. A programme that is
   * on air counts only when it started at or after the floor. `tonight`
   * sets it to the evening hour: the film of 18:45 stays in when the user
   * asks at 19:00, the marathon of the afternoon does not. Null is no
   * floor.
   */
  onAirFrom: number | null;
  /** The moment the window is relative to, in epoch seconds. */
  moment: number;
}

/** The offset of a zone at a moment, in minutes east of UTC. */
function offsetMinutes(epochSeconds: number, timezone: string): number {
  const text = offsetOf(epochSeconds, timezone);
  const match = /([+-])(\d{2}):(\d{2})/.exec(text);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/**
 * The parts of the local wall clock of a moment: year, month, day, hour,
 * minute, second.
 */
export function localParts(
  epochSeconds: number,
  timezone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  // `formatInTimezone` renders `YYYY-MM-DDTHH:MM:SS±HH:MM`; the wall clock
  // is the part before the offset.
  const text = formatInTimezone(epochSeconds, timezone) ?? '1970-01-01T00:00:00+00:00';
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(text);
  if (!match) return { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 };
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6]),
  };
}

/**
 * The epoch seconds of a local wall clock.
 *
 * The wall clock is read as if it were UTC, then corrected with the offset
 * of the zone at that moment. The correction is repeated once: the offset
 * of the zone is asked at the corrected moment, because a daylight-saving
 * change moves the offset exactly at the wall that is looked for.
 *
 * A wall clock that the zone never had (the spring hour that is skipped)
 * lands on the moment the clock would have shown next; a wall clock that
 * the zone had twice (the autumn hour that is repeated) takes the first
 * pass. The guide is not that precise: a programme starts once.
 */
export function wallClockToEpoch(
  parts: {
    year: number;
    month: number;
    day: number;
    hour?: number;
    minute?: number;
    second?: number;
  },
  timezone: string,
): number {
  const hour = parts.hour ?? 0;
  const minute = parts.minute ?? 0;
  const second = parts.second ?? 0;

  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute, second) / 1000;
  let epoch = naive - offsetMinutes(naive, timezone) * 60;
  epoch = naive - offsetMinutes(epoch, timezone) * 60;
  return Math.floor(epoch);
}

/**
 * The epoch seconds of the local midnight of the day of a moment.
 */
export function localMidnight(epochSeconds: number, timezone: string): number {
  const { year, month, day } = localParts(epochSeconds, timezone);
  return wallClockToEpoch({ year, month, day }, timezone);
}

/**
 * The epoch seconds of a local date at midnight: `2026-06-15` in the zone.
 *
 * @returns the epoch seconds, or null when the date cannot be read.
 */
export function localDateToEpoch(date: string, timezone: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!match) return null;
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) return null;
  return wallClockToEpoch(parts, timezone);
}

/**
 * An ISO date-time of a tool call, as epoch seconds.
 *
 * With an offset the string is absolute and is read as it stands. Without
 * one the string is a wall clock of the configured zone: the model writes
 * `2026-06-15T20:00:00` and means eight in the evening of the user.
 *
 * @returns the epoch seconds, or null when the text cannot be read.
 */
export function isoToEpoch(text: string, timezone: string): number | null {
  const value = text.trim();
  if (!value) return null;

  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(
      value,
    );
  if (!match) return null;

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: match[4] === undefined ? 0 : Number(match[4]),
    minute: match[5] === undefined ? 0 : Number(match[5]),
    second: match[6] === undefined ? 0 : Number(match[6]),
  };
  if (
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.day > 31 ||
    parts.hour > 23 ||
    parts.minute > 59 ||
    parts.second > 59
  ) {
    return null;
  }

  const zone = match[7];
  if (zone === undefined) {
    return wallClockToEpoch(parts, timezone);
  }

  // With an offset the string is absolute; `parseProviderTimestamp` reads
  // it and refuses impossible dates.
  const withOffset =
    zone === 'Z'
      ? `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}+00:00`
      : (() => {
          const digits = zone.slice(1).replace(':', '');
          const normalized = `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
          return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}${zone[0]}${normalized}`;
        })();

  return parseProviderTimestamp(withOffset);
}

/**
 * The window of a period.
 *
 * @param period The period of the request.
 * @param now The moment of the request, in epoch seconds.
 * @param timezone The IANA zone of the user.
 * @param tonightFromHour The hour `tonight` starts at.
 */
export function periodWindow(
  period: Period,
  now: number,
  timezone: string,
  tonightFromHour: number,
): TimeWindow {
  const parts = localParts(now, timezone);
  const dayEnd = wallClockToEpoch(
    { year: parts.year, month: parts.month, day: parts.day + 1 },
    timezone,
  );
  const tomorrowEnd = wallClockToEpoch(
    { year: parts.year, month: parts.month, day: parts.day + 2 },
    timezone,
  );

  switch (period) {
    case 'now':
      // A programme that is on air at this moment: the window narrows in
      // SQL, here it only carries the moment.
      return { field: 'start', from: null, to: null, onAir: true, onAirFrom: null, moment: now };
    case 'tonight': {
      // The evening hour is a wall clock of the zone: on a 23h or 25h
      // day the fixed seconds would move it off the wall.
      const evening = wallClockToEpoch(
        { ...localParts(now, timezone), hour: tonightFromHour },
        timezone,
      );
      return {
        field: 'start',
        from: Math.max(now, evening),
        to: dayEnd,
        onAir: true,
        onAirFrom: evening,
        moment: now,
      };
    }
    case 'today':
      // On air now, or starting between now and the end of the day.
      return { field: 'start', from: now, to: dayEnd, onAir: true, onAirFrom: null, moment: now };
    case 'tomorrow':
      return { field: 'start', from: dayEnd, to: tomorrowEnd, onAir: false, onAirFrom: null, moment: now };
    case 'next_24h':
      return { field: 'start', from: now, to: now + 86400, onAir: false, onAirFrom: null, moment: now };
    case 'next_7d':
      return { field: 'start', from: now, to: now + 7 * 86400, onAir: false, onAirFrom: null, moment: now };
    case 'past_24h':
      return { field: 'stop', from: now - 86400, to: now, onAir: false, onAirFrom: null, moment: now };
    case 'past_7d':
      return { field: 'stop', from: now - 7 * 86400, to: now, onAir: false, onAirFrom: null, moment: now };
  }
}

/**
 * The default window of a search without a period: from now on.
 */
export function upcomingWindow(now: number): TimeWindow {
  return { field: 'start', from: now, to: null, onAir: false, onAirFrom: null, moment: now };
}

/**
 * The window of an exact `from` / `to` pair.
 *
 * `from` is inclusive, `to` is exclusive: a programme starts before `to`,
 * as the schema of the search says.
 */
export function exactWindow(
  from: number | null,
  to: number | null,
  now: number,
): TimeWindow {
  return { field: 'start', from, to: to === null ? null : to, onAir: false, onAirFrom: null, moment: now };
}

/**
 * What a programme is doing at a moment.
 */
export type ProgramStatus = 'past' | 'live' | 'upcoming';

/**
 * The status of a programme at a moment.
 *
 * The last second of a programme is live: the programme ends strictly
 * before the moment, the way the catch-up rule draws the line
 * (`guide-links.ts`). One comparison for both, so that a status of `past`
 * never meets the refusal "has not ended yet".
 */
export function statusOf(
  startUtc: number,
  stopUtc: number,
  now: number,
): ProgramStatus {
  if (now > stopUtc) return 'past';
  if (now >= startUtc) return 'live';
  return 'upcoming';
}
