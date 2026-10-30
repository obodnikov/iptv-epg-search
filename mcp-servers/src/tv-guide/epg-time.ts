/**
 * epg-time.ts - the times of the XMLTV programme guide.
 *
 * A port of the web app's `epgRawToEpochSeconds`
 * (public/scripts/utils/epgParser.js:240), kept next to the original on
 * purpose (movability rule, iptv-mcp-servers.md §4.4). The web app returns
 * NaN for a bad string; here it returns null, so that the caller does not
 * have to know that NaN is falsy-but-not-null.
 *
 * The rules that matter (design: tv-guide-server.md §5 step 4):
 *
 * - the offset is part of the value: `20260614091000 +0300` is 06:10 UTC,
 *   and no local timezone is ever applied;
 * - impossible dates are rejected, not rolled over: month 13 and
 *   "2026-02-31" are errors, because Date.UTC would silently normalise
 *   them into the next month;
 * - a time without an offset is an error for the strict check; the import
 *   applies the setting `epgDefaultOffset` to such times and counts them,
 *   so that `get_status` can say how many there were.
 */

/** `20260614091000 +0300`: compact XMLTV time with a required offset. */
const EPG_TIME_RE = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})$/;

/** The same compact time, with the offset optional. */
const EPG_TIME_LOOSE_RE = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-]\d{4}))?$/;

/** `+0300` or `-0130`: the offset of the setting `epgDefaultOffset`. */
const OFFSET_RE = /^[+-]\d{4}$/;

/**
 * The exact result of parsing one EPG time.
 */
export interface EpgTime {
  /** UTC epoch seconds. */
  epoch: number;
  /** The offset that was applied, as `+HHMM`. */
  offset: string;
  /**
   * True when the offset came from the setting `epgDefaultOffset`, because
   * the source did not carry one.
   */
  usedDefault: boolean;
}

/**
 * Convert a raw XMLTV time into UTC epoch seconds.
 *
 * @param raw The raw attribute value, e.g. `20260614091000 +0300`.
 * @returns Epoch seconds, or null when the format or a range is invalid.
 */
export function epgRawToEpochSeconds(raw: string): number | null {
  const match = EPG_TIME_RE.exec(raw.trim());
  if (!match) return null;

  const offset = match[7];
  const year = match[1];
  const month = match[2];
  const day = match[3];
  const hour = match[4];
  const minute = match[5];
  const second = match[6];
  if (
    offset === undefined || year === undefined || month === undefined ||
    day === undefined || hour === undefined || minute === undefined ||
    second === undefined
  ) {
    return null;
  }

  return compactTimeToEpoch(year, month, day, hour, minute, second, offset);
}

/**
 * Convert a raw XMLTV time into UTC epoch seconds, applying a default
 * offset when the source did not carry one.
 *
 * @param raw The raw attribute value.
 * @param defaultOffset The offset of the setting `epgDefaultOffset`, as
 *   `+HHMM`. It is applied only when the value itself has no offset.
 * @returns The epoch, the applied offset and whether the default was used,
 *   or null when the value cannot be read at all.
 */
export function parseEpgTime(
  raw: string,
  defaultOffset: string,
): EpgTime | null {
  const match = EPG_TIME_LOOSE_RE.exec(raw.trim());
  if (!match) return null;

  const year = match[1];
  const month = match[2];
  const day = match[3];
  const hour = match[4];
  const minute = match[5];
  const second = match[6];
  const explicit = match[7];

  if (year === undefined || month === undefined || day === undefined) return null;
  if (hour === undefined || minute === undefined || second === undefined) return null;

  if (explicit !== undefined) {
    const epoch = compactTimeToEpoch(year, month, day, hour, minute, second, explicit);
    return epoch === null ? null : { epoch, offset: explicit, usedDefault: false };
  }

  if (!OFFSET_RE.test(defaultOffset)) return null;

  const epoch = compactTimeToEpoch(year, month, day, hour, minute, second, defaultOffset);
  return epoch === null ? null : { epoch, offset: defaultOffset, usedDefault: true };
}

/**
 * Turn the captured groups of a compact EPG time into epoch seconds.
 *
 * The ranges are checked before Date.UTC runs, and the result is checked
 * against the inputs afterwards, because Date.UTC normalises out-of-range
 * values (month 13 becomes January of the next year) and the value that
 * was written is the one that has to arrive. Hour 24 is invalid: the
 * sample never uses it, and the web app rejects it as well.
 */
function compactTimeToEpoch(
  year: string,
  month: string,
  day: string,
  hour: string,
  minute: string,
  second: string,
  offset: string,
): number | null {
  const y = Number.parseInt(year, 10);
  const mo = Number.parseInt(month, 10);
  const d = Number.parseInt(day, 10);
  const h = Number.parseInt(hour, 10);
  const mi = Number.parseInt(minute, 10);
  const s = Number.parseInt(second, 10);

  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  if (!Number.isFinite(h) || !Number.isFinite(mi) || !Number.isFinite(s)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (h > 23 || mi > 59 || s > 59) return null;

  // Validate the offset itself: sign + HHMM, HH ≤ 23, MM ≤ 59.
  const sign = offset.startsWith('-') ? -1 : 1;
  const offH = Number.parseInt(offset.slice(1, 3), 10);
  const offM = Number.parseInt(offset.slice(3, 5), 10);
  if (!Number.isFinite(offH) || !Number.isFinite(offM)) return null;
  if (offH > 23 || offM > 59) return null;

  const utcMs = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(utcMs);
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() + 1 !== mo ||
    check.getUTCDate() !== d ||
    check.getUTCHours() !== h ||
    check.getUTCMinutes() !== mi ||
    check.getUTCSeconds() !== s
  ) {
    return null;
  }

  const offsetMs = sign * (offH * 3600 + offM * 60) * 1000;
  return Math.floor((utcMs - offsetMs) / 1000);
}
