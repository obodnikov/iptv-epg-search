/**
 * groups.ts - what the group of a channel says.
 *
 * The playlist groups the channels, and the group carries the two things
 * the search filters on: the **theme** of the channel (film, sport, news,
 * kids, documentary, music, general, adult) and its **region** (the ISO
 * 3166-1 alpha-2 code of the country, or a group code such as "BALTIC").
 *
 * The table of the built-in groups is the one of the design
 * (tv-guide-server.md §4.2). The owner can override every group in the
 * setting `groupMap`, which wins over the table. A group that is in
 * neither — the playlist of another provider — gets its region from the
 * country table and its theme from the words of the name.
 *
 * The groups of the sample are: Общероссийские, Кино, Познавательные,
 * Спорт, Мультфильмы, Новости, Музыкальные, Ultra HD, XXX (18+), the
 * three Russian time shifts ("Россия +2ч", "+4ч", "+7ч") and the foreign
 * ones (Israel, Deutschland, USA, UK, Украина, Armenia, Türkiye,
 * Azerbaijan, Беларусь, Baltic).
 */

import { countryCodeByStem } from '../shared/countries.ts';
import { stemText } from '../shared/text.ts';
import { timeshiftHours } from './channel-facts.ts';
import type { GroupOverride } from './config.ts';

/**
 * The theme of a channel.
 *
 * `null` is a theme of its own: the group "Ultra HD" holds films and
 * sport, and nothing can be said about it.
 */
export type Theme =
  | 'film'
  | 'sport'
  | 'news'
  | 'kids'
  | 'documentary'
  | 'music'
  | 'general'
  | 'adult';

/** The themes a group may carry. */
export const THEMES: readonly Theme[] = [
  'film',
  'sport',
  'news',
  'kids',
  'documentary',
  'music',
  'general',
  'adult',
];

/** What the group of a channel says. */
export interface GroupFacts {
  /** The theme of the channel, or null when the group says nothing. */
  theme: Theme | null;
  /** The ISO code of the country, or a group code such as "BALTIC". */
  region: string | null;
  /** The time shift of the group, in hours. */
  timeshiftHours: number;
}

/**
 * The groups of the provider, with the theme and the region.
 *
 * The three Russian time shifts are not in the table: they are found by
 * the pattern of the name (a group "Россия +4ч" is a copy of the Russian
 * channels that runs four hours later).
 *
 * The lookup ignores the case: the playlist writes "Общероссийские" and
 * another provider may write "общероссийские".
 */
const BUILT_IN: Record<string, { theme: Theme | null; region: string | null }> = {
  Общероссийские: { theme: 'general', region: 'RU' },
  Кино: { theme: 'film', region: 'RU' },
  Познавательные: { theme: 'documentary', region: 'RU' },
  Спорт: { theme: 'sport', region: 'RU' },
  Мультфильмы: { theme: 'kids', region: 'RU' },
  Новости: { theme: 'news', region: 'RU' },
  Музыкальные: { theme: 'music', region: 'RU' },
  // The group holds films and sport: nothing can be said about it.
  'Ultra HD': { theme: null, region: null },
  'XXX (18+)': { theme: 'adult', region: null },
  Israel: { theme: 'general', region: 'IL' },
  Deutschland: { theme: 'general', region: 'DE' },
  USA: { theme: 'general', region: 'US' },
  UK: { theme: 'general', region: 'GB' },
  Украина: { theme: 'general', region: 'UA' },
  Armenia: { theme: 'general', region: 'AM' },
  Türkiye: { theme: 'general', region: 'TR' },
  Azerbaijan: { theme: 'general', region: 'AZ' },
  Беларусь: { theme: 'general', region: 'BY' },
  Baltic: { theme: 'general', region: 'BALTIC' },
};

/**
 * The words that give a theme to a group that is not in the table.
 *
 * The design leaves the theme of an unknown group to the meaning of the
 * name ("the closest of the theme words by meaning when vectors exist",
 * tv-guide-server.md §4.2). The vectors do not exist yet — they arrive
 * with phase T4 — so the words are used for now.
 *
 * The words are compared by their stem, and the stem of the keyword has to
 * be the **beginning** of the stem of the word: "мультфильмы" holds
 * "фильм" in the middle of it and is a cartoon, not a film.
 */
const THEME_WORDS: { theme: Theme; words: string[] }[] = [
  { theme: 'kids', words: ['мульт', 'мультфильм', 'детск', 'детский', 'kids'] },
  { theme: 'documentary', words: ['познават', 'документ', 'научн', 'documentary'] },
  { theme: 'sport', words: ['спорт', 'спортив', 'футбол', 'хоккей', 'sport'] },
  { theme: 'news', words: ['новости', 'новост', 'news'] },
  { theme: 'music', words: ['музык', 'музыкальн', 'music'] },
  { theme: 'film', words: ['кино', 'фильм', 'кинотеатр', 'movie', 'film'] },
  { theme: 'adult', words: ['xxx', '18+', 'adult'] },
];

/**
 * The stem of a word, with the stemmer of its script.
 */
function stemOfWord(word: string): string {
  const cyrillic = /[\u0400-\u04FF]/.test(word);
  return stemText(word, cyrillic ? 'russian' : 'english');
}

/**
 * The theme of a group that is not in the table, from the words of its
 * name.
 */
function themeFromWords(group: string): Theme | null {
  const words = group
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);

  for (const { theme, words: keywords } of THEME_WORDS) {
    for (const word of words) {
      const stem = stemOfWord(word);
      if (!stem) continue;
      for (const keyword of keywords) {
        const key = stemOfWord(keyword);
        // The keyword has to be the beginning of the word: "фильм" is not
        // the beginning of "мультфильм".
        if (key && stem.startsWith(key)) return theme;
      }
    }
  }
  return null;
}

/**
 * The region of a group that is not in the table, from the country table.
 *
 * The name of the group is the name of a country for the foreign groups
 * ("Deutschland" → DE). The comparison is by stem, so that the group
 * "Беларусь" is found as well.
 */
function regionFromName(group: string): string | null {
  return countryCodeByStem(group);
}

/**
 * The table of the built-in groups, with the keys in lower case.
 */
const BUILT_IN_LOWER = new Map(
  Object.entries(BUILT_IN).map(([name, facts]) => [name.toLowerCase(), facts] as const),
);

/**
 * True when the group is one of the Russian time shifts.
 *
 * The groups of the sample are "Россия +2ч", "Россия +4ч" and
 * "Россия +7ч": the Russian channels that run two, four and seven hours
 * later.
 */
function isRussianTimeShift(group: string): boolean {
  return /^россия\s*\+/iu.test(group.trim());
}

/**
 * The overrides of a group, found by the name as it was written and by the
 * name in lower case.
 */
function findOverride(
  name: string,
  overrides: Record<string, GroupOverride>,
): GroupOverride | undefined {
  const exact = overrides[name];
  if (exact !== undefined) return exact;

  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(overrides)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

/**
 * Read the theme, the region and the time shift of a group.
 *
 * The overrides of the setting `groupMap` win over the built-in table.
 *
 * @param group The name of the group, as the playlist wrote it.
 * @param overrides The `groupMap` of the settings.
 */
export function resolveGroup(
  group: string | null | undefined,
  overrides: Record<string, GroupOverride> = {},
): GroupFacts {
  const name = (group ?? '').trim();
  if (!name) {
    return { theme: null, region: null, timeshiftHours: 0 };
  }

  const shift = timeshiftHours(name);

  const override = findOverride(name, overrides);
  const built = BUILT_IN_LOWER.get(name.toLowerCase());

  let theme: Theme | null = built?.theme ?? null;
  let region: string | null = built?.region ?? null;

  if (override) {
    if (override.theme !== undefined) {
      theme = THEMES.includes(override.theme as Theme) ? (override.theme as Theme) : null;
    }
    if (override.region !== undefined) {
      region = override.region.trim().length > 0 ? override.region.trim().toUpperCase() : null;
    }
  }

  // A group that is in neither the table nor the overrides: the country
  // table and the words of the name. A group that **is** in the table
  // keeps what the table says, also when the table says nothing (the
  // group "Ultra HD" holds films and sport).
  if (!built && !override) {
    region = regionFromName(name);
    theme = themeFromWords(name);
  }

  // The Russian time shifts: a copy of the Russian channels.
  if (isRussianTimeShift(name)) {
    if (theme === null) theme = 'general';
    if (region === null) region = 'RU';
  }

  const timeshift =
    override?.timeshiftHours !== undefined && Number.isFinite(override.timeshiftHours)
      ? override.timeshiftHours
      : shift;

  return { theme, region, timeshiftHours: timeshift };
}

/**
 * True when the theme of a group says that the channel is for adults.
 *
 * The group "XXX (18+)" is the mark of the provider; the name of a
 * channel can carry it too.
 */
export function isAdultGroup(group: string | null | undefined): boolean {
  if (!group) return false;
  return /\(18\+\)/i.test(group);
}
