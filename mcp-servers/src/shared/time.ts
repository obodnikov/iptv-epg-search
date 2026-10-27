/**
 * time.ts - absolute times from the provider's own strings.
 *
 * Every absolute time comes from the raw source string with its offset.
 * Nothing in the servers parses a date without an offset, and no local
 * timezone is ever applied (design: iptv-mcp-servers.md §11).
 */

/**
 * `YYYY-MM-DD HH:MM:SS±HH:MM`, the format the provider uses for `added`.
 * The offset may be missing; then the value is read as UTC and the caller
 * decides what to do with it.
 */
const TIMESTAMP_RE =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Parse a provider timestamp into UTC epoch seconds.
 *
 * @param raw The raw string, e.g. `2026-05-03 13:08:59+03:00`.
 * @returns Epoch seconds, or null when the string cannot be read.
 */
export function parseProviderTimestamp(raw: string | null | undefined): number | null {
  if (!raw) return null;

  const match = TIMESTAMP_RE.exec(raw.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const zone = match[7];

  if (![year, month, day, hour, minute, second].every((value) => Number.isFinite(value))) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 60) return null;

  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  // Date.UTC maps years 0-99 into the 20th century; fix that.
  date.setUTCFullYear(year);
  // Date.UTC rolls an impossible day into the next month ("2026-02-31"
  // becomes the 3rd of March). The date has to be the one that was written.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  const utcMs = date.getTime();
  if (Number.isNaN(utcMs)) return null;

  let offsetMinutes = 0;
  if (zone && zone !== 'Z') {
    const sign = zone.startsWith('-') ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    const offsetHours = Number(digits.slice(0, 2));
    const offsetRest = Number(digits.slice(2, 4));
    if (!Number.isFinite(offsetHours) || !Number.isFinite(offsetRest)) return null;
    offsetMinutes = sign * (offsetHours * 60 + offsetRest);
  }

  return Math.floor((utcMs - offsetMinutes * 60_000) / 1000);
}

/**
 * Format epoch seconds as an ISO 8601 string with an offset, in the given
 * IANA timezone. `auto` uses the timezone of the machine.
 *
 * The result looks like `2026-05-03T13:08:59+03:00`.
 */
export function formatInTimezone(
  epochSeconds: number | null | undefined,
  timezone: string,
): string | null {
  if (epochSeconds === null || epochSeconds === undefined) return null;
  if (!Number.isFinite(epochSeconds)) return null;

  const date = new Date(epochSeconds * 1000);
  if (Number.isNaN(date.getTime())) return null;

  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone === 'auto' ? undefined : timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
    });
    const parts = formatter.formatToParts(date);
    const part = (type: string): string =>
      parts.find((item) => item.type === type)?.value ?? '';

    const year = part('year');
    const month = part('month');
    const day = part('day');
    const hour = part('hour');
    const minute = part('minute');
    const second = part('second');

    if (!year || !month || !day) return date.toISOString();

    return `${year}-${month}-${day}T${hour}:${minute}:${second}${parseOffset(part('timeZoneName'))}`;
  } catch {
    return date.toISOString();
  }
}

/**
 * The offset of a timezone name, as "+03:00".
 *
 * The name comes from Intl and can be "GMT+03:00", "GMT+3", "GMT-05:30",
 * "GMT" or "UTC".
 */
export function parseOffset(zoneName: string): string {
  const match = /([+-])(\d{1,2})(?::?(\d{2}))?/.exec(zoneName);
  if (!match) return '+00:00';
  const sign = match[1] ?? '+';
  const hours = (match[2] ?? '0').padStart(2, '0');
  const minutes = (match[3] ?? '0').padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}

/**
 * The timezone of the machine, used when the setting says `auto`.
 */
export function systemTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * The offset of a timezone at the given moment, as "+03:00".
 */
export function offsetOf(epochSeconds: number, timezone: string): string {
  const formatted = formatInTimezone(epochSeconds, timezone);
  if (!formatted) return '+00:00';
  const match = /([+-]\d{2}:\d{2})$/.exec(formatted);
  return match?.[1] ?? '+00:00';
}
