/**
 * channel-facts.ts - what the name of a channel says.
 *
 * Three things are read out of the name of a channel:
 *
 * - the **quality**: the scale of the web app (`getChannelQuality`,
 *   public/scripts/utils/search.js:80-91), 0 SD … 4 4K;
 * - the **time shift**: a name with `+N` hours ("Россия +2ч", "Первый
 *   канал (+2)") is a copy of another channel that runs N hours later;
 * - the **family key**: the name without the quality and the time-shift
 *   marks, normalised. It joins the copies of one channel, so that the
 *   search can show one airing per channel and not one per copy.
 *
 * The marks of the provider are written with a space around them
 * ("Первый HD", "Первый канал (+2)"); the rules work on the words, not on
 * the substrings, so that a name like "4Kids" does not become a 4K
 * channel.
 */

import { normalizeTitle } from '../shared/text.ts';

/** The quality of a channel: the scale of the web app (search.js:80-91). */
export const QUALITY_SD = 0;
export const QUALITY_REGULAR = 1;
export const QUALITY_HD = 2;
export const QUALITY_UHD = 3;
export const QUALITY_4K = 4;

/**
 * The quality marks, from the best to the worst.
 *
 * The web app looks for the marks in this order with `includes`; the
 * words are matched here, so that "4Kids" is not a 4K channel.
 */
const QUALITY_MARKS: { mark: string; quality: number }[] = [
  { mark: '4K', quality: QUALITY_4K },
  { mark: 'UHD', quality: QUALITY_UHD },
  { mark: 'FHD', quality: QUALITY_HD },
  { mark: 'HD', quality: QUALITY_HD },
  { mark: 'SD', quality: QUALITY_SD },
];

/**
 * The quality marks as one pattern.
 *
 * The look-around keeps the mark from eating the letter next to it:
 * "ПервыйHD" loses the "HD" and keeps the "ы". The pattern does not
 * match inside a word: "4Kids" is not a 4K channel.
 */
const QUALITY_PATTERN = /(?<![0-9A-Za-z])(4K|UHD|FHD|HD|SD)(?![0-9A-Za-z])/gi;

/**
 * True when the mark stands alone in the name.
 *
 * The marks are surrounded by spaces or by the ends of the name. A
 * Cyrillic letter is not a word character for the regex, so "Первый HD"
 * and "ПервыйHD" are both found.
 */
function hasStandaloneMark(upper: string, mark: string): boolean {
  const escaped = mark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^0-9A-Za-z])${escaped}([^0-9A-Za-z]|$)`).test(upper);
}

/**
 * The quality of a channel name.
 *
 * Ported from `getChannelQuality` (public/scripts/utils/search.js:80-91),
 * with the marks matched as words.
 *
 * @param name The name of the channel.
 * @returns 0 SD, 1 regular, 2 HD, 3 UHD, 4 4K.
 */
export function channelQuality(name: string | null | undefined): number {
  if (!name) return QUALITY_REGULAR;

  const upper = name.toUpperCase();
  for (const { mark, quality } of QUALITY_MARKS) {
    if (hasStandaloneMark(upper, mark)) return quality;
  }
  return QUALITY_REGULAR;
}
/** The time shift in parentheses: "Первый канал (+2)". */
const PAREN_SHIFT = /\(\s*\+\s*(\d{1,2})\s*\)/;

/**
 * The time shift with the sign: "Россия +2ч".
 *
 * The hour suffix is written in Cyrillic ("ч", "часа", "часов"), and a
 * Cyrillic letter is not a word character for the regex: a word boundary
 * after it never matches, and the suffix would stay in the name. The
 * suffix is therefore spelled out, and the look-ahead keeps the match
 * from eating the letters of the next word.
 *
 * The plus has to stand on its own: the channel "1+1" (of the group
 * "Украина") is not a copy of another channel.
 */
const SIGNED_SHIFT =
  /(?<![0-9A-Za-zА-Яа-яЁё])\+\s*(\d{1,2})\s*(?:ч(?:аса|асов|ас|а)?\.?|час(?:а|ов)?\.?|h(?:ours?|rs)?\.?)?(?![0-9A-Za-zА-Яа-яЁё])/iu;

/**
 * The time shift of a name, in hours.
 *
 * The group "Россия +2ч" and the channel "Первый канал (+2)" both say
 * two hours. A name without a shift says zero.
 *
 * @returns The number of hours, 0 when the name carries no shift.
 */
export function timeshiftHours(name: string | null | undefined): number {
  if (!name) return 0;

  const paren = PAREN_SHIFT.exec(name);
  if (paren) return Number(paren[1]);

  const signed = SIGNED_SHIFT.exec(name);
  if (signed) return Number(signed[1]);

  return 0;
}

/**
 * The family key of a channel: the name without the quality and the
 * time-shift marks, normalised.
 *
 * The provider writes the copies of one channel with different names:
 *
 * | name | family key |
 * | --- | --- |
 * | Первый HD | `первый` |
 * | Первый канал | `первый канал` |
 * | Первый канал (+2) | `первый канал` |
 * | Россия 1 HD | `россия 1` |
 * | Россия 1 (+2) | `россия 1` |
 * | Россия +2ч | `россия` |
 *
 * The time-shifted copies of a channel share the key, which is what the
 * search needs: one airing per channel and not one per copy. The channel
 * that comes in two qualities ("Первый HD" and "Первый канал") has two
 * keys — the provider names them differently — and the search joins them
 * the other way round, by the programme and the time (the rule of the web
 * app, `filterPreferHD`, public/scripts/utils/search.js:136).
 */
export function familyKey(name: string | null | undefined): string {
  if (!name) return '';

  let text = name;

  // The time shift in parentheses: "Первый канал (+2)".
  text = text.replace(PAREN_SHIFT, ' ');
  // The time shift with the sign: "Россия +2ч".
  text = text.replace(SIGNED_SHIFT, ' ');

  // The quality marks, as words. The mark alone comes off: the letter
  // next to it stays.
  text = text.replace(QUALITY_PATTERN, ' ');

  return normalizeTitle(text);
}
