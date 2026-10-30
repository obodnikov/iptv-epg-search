/**
 * kind.ts - what kind of programme a text is.
 *
 * The design (tv-guide-server.md §4.3) gives twelve kinds and five
 * sources. The first match wins:
 *
 * 1. **the marker** at the start of the title: "х/ф" and "к/ф" are a film,
 *    "т/с" a series, "м/ф" an animation, "м/с" an animated series, "д/ф"
 *    a documentary, "д/с" a documentary series;
 * 2. **the pattern**: a title that starts with the name of a sport
 *    ("Футбол. …"), or that carries "Трансляция из" or "Прямая
 *    трансляция", is a sport programme;
 * 3. **the theme of the channel**: the sport, news, kids, music and
 *    documentary channels give their theme; a film channel gives "film"
 *    only when the description carries the film ending;
 * 4. **the meaning** of the text (phase T4, with the vectors);
 * 5. otherwise the programme is "other".
 *
 * The kind of the text is decided by the text alone, except for the third
 * source: the theme of a channel is a property of an **airing**, and the
 * same text airs on channels of different themes. The writer therefore
 * gives the third source to the texts whose channels agree, and the
 * search (phase T3) falls back to the theme of the channel of the airing.
 */

import { extractSport } from './extract.ts';
import type { Theme } from './groups.ts';

/**
 * The kind of a programme.
 */
export type Kind =
  | 'film'
  | 'series'
  | 'animation'
  | 'animated_series'
  | 'documentary'
  | 'docuseries'
  | 'sport'
  | 'news'
  | 'kids'
  | 'music'
  | 'show'
  | 'other';

/**
 * Where the kind came from.
 *
 * "channel" and "meaning" arrive later: the channel theme with the write
 * of the guide, the meaning with the vectors of phase T4.
 */
export type KindSource = 'marker' | 'pattern' | 'channel' | 'meaning' | 'ending' | 'none';

/**
 * How strong the source of a kind is.
 *
 * A stronger source wins. The order is the one of the design, with the
 * theme of the channel between the pattern and the weak inference of the
 * film ending:
 *
 * | source | strength | why |
 * | --- | --- | --- |
 * | `marker` | 4 | the provider names the kind itself ("х/ф") |
 * | `pattern` | 3 | the provider names it in the title or in the genre ("Футбол.", "ток-шоу") |
 * | `meaning` | 3 | the meaning of the text (phase T4) |
 * | `channel` | 2 | the theme of the channel — the channel knows more than the ending, less than the title |
 * | `ending` | 1 | the film ending with a year — an inference, not a word of the provider |
 * | `none` | 0 | nothing said anything |
 */
const SOURCE_STRENGTH: Record<KindSource, number> = {
  marker: 4,
  pattern: 3,
  meaning: 3,
  channel: 2,
  ending: 1,
  none: 0,
};

/**
 * Is a source stronger than another one?
 */
export function sourceIsStronger(source: KindSource, than: KindSource): boolean {
  return SOURCE_STRENGTH[source] > SOURCE_STRENGTH[than];
}

/** The kinds, in the order of the design. */
export const KINDS: readonly Kind[] = [
  'film',
  'series',
  'animation',
  'animated_series',
  'documentary',
  'docuseries',
  'sport',
  'news',
  'kids',
  'music',
  'show',
  'other',
];

/**
 * The type markers of the provider and the kind they name.
 *
 * The counts of the sample (verified 2026-10-30): х/ф 8,455, т/с 6,859,
 * м/ф 6,025, м/с 5,648, д/с 2,700, д/ф 2,011, and the rare з/л 4, к/ф 2.
 *
 * This table is the only place the markers live: the title is cleaned
 * with it and the kind is read from it.
 */
export const KIND_MARKERS: Record<string, Kind> = {
  'х/ф': 'film',
  'к/ф': 'film',
  'т/с': 'series',
  'м/ф': 'animation',
  'м/с': 'animated_series',
  'д/ф': 'documentary',
  'д/с': 'docuseries',
};

/**
 * The markers that come off the title without naming a kind.
 *
 * "з/л" is rare in the sample (4 programmes) and the design does not say
 * what it means.
 */
export const OTHER_MARKERS: readonly string[] = ['з/л'];

/**
 * The kind of a text, and where it came from.
 */
export interface KindOfText {
  kind: Kind;
  source: KindSource;
}

/**
 * The pattern of a type marker at the start of a title.
 *
 * The markers live in one table, and this pattern is built from it: the
 * title is cleaned with it and the marker is read with it. The case does
 * not matter ("Х/Ф …" is a marker).
 */
export const MARKER_PATTERN = new RegExp(
  `^(${[...Object.keys(KIND_MARKERS), ...OTHER_MARKERS]
    .map((marker) => marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})\\s+`,
  'i',
);

/**
 * The marker at the start of a title.
 *
 * @param title The title of the programme.
 * @returns The marker, or null when the title does not start with one.
 */
export function markerOf(title: string): string | null {
  const found = MARKER_PATTERN.exec(title);
  return found ? (found[1] ?? '').toLowerCase() : null;
}

/**
 * The kind of a marker.
 *
 * @param marker The marker, e.g. "х/ф". The case does not matter.
 * @returns The kind, or null when the marker is not known.
 */
export function kindOfMarker(marker: string | null): Kind | null {
  if (marker === null) return null;
  return KIND_MARKERS[marker.toLowerCase()] ?? null;
}

/**
 * The kind of a title, from the pattern.
 *
 * The marker is not read here: it is the first source, and `resolveKind`
 * reads it.
 *
 * @param title The title of the programme, without the marker and without
 *   the live mark.
 * @returns The kind, or null when the title says nothing about it.
 */
export function kindFromTitle(title: string): KindOfText | null {
  // The sport: the title starts with the name of a sport and a full stop,
  // or it names the place of a broadcast.
  const sport = extractSport(title);
  if (sport !== null && title.startsWith(`${sport}.`)) {
    return { kind: 'sport', source: 'pattern' };
  }
  if (title.includes('Трансляция из') || title.includes('Прямая трансляция')) {
    return { kind: 'sport', source: 'pattern' };
  }

  return null;
}

/**
 * The kind that the theme of a channel gives.
 *
 * A film channel gives "film" only when the description carries the film
 * ending: a channel of films carries trailers and talks as well.
 *
 * @param theme The theme of the channel.
 * @param hasFilmEnding True when the description carries the film ending.
 * @returns The kind, or null when the theme says nothing.
 */
export function kindFromTheme(theme: Theme | null, hasFilmEnding: boolean): Kind | null {
  switch (theme) {
    case 'sport':
      return 'sport';
    case 'news':
      return 'news';
    case 'kids':
      return 'kids';
    case 'music':
      return 'music';
    case 'documentary':
      return 'documentary';
    case 'film':
      return hasFilmEnding ? 'film' : null;
    case 'general':
    case 'adult':
      return null;
    default:
      return null;
  }
}

/**
 * The genres that name the kind of a text.
 *
 * The talk shows of the provider end their description with the genre
 * "ток-шоу" ("Пусть говорят … Россия, 2005, ток-шоу"), the documentaries
 * with "документальный фильм" and the animated films with "анимация".
 * The design lists the kinds "show", "documentary" and "animation" but
 * does not say where they come from; the genre of the description is the
 * one place that names them.
 *
 * The order matters: a talk show carries a year and a country as well,
 * and it is a show before it is a film.
 */
const GENRE_KINDS: { kind: Kind; words: string[] }[] = [
  { kind: 'show', words: ['ток-шоу', 'токшоу', 'юмористический', 'развлекательный'] },
  { kind: 'docuseries', words: ['документальный сериал'] },
  { kind: 'documentary', words: ['документальный', 'документально'] },
  { kind: 'animated_series', words: ['мультсериал', 'анимационный сериал'] },
  { kind: 'animation', words: ['анимация', 'мультфильм', 'анимационный'] },
];

/**
 * The kind of a text that the genres name.
 *
 * @returns The kind, or null when the genres say nothing.
 */
export function kindFromGenres(genres: readonly string[]): Kind | null {
  for (const genre of genres) {
    const lower = genre.trim().toLowerCase();
    for (const { kind, words } of GENRE_KINDS) {
      if (words.some((word) => lower.includes(word))) return kind;
    }
  }
  return null;
}

/**
 * What the kind of a text is decided from.
 */
export interface KindInput {
  /** The marker that came off the title, or null. */
  marker: string | null;
  /** The title, without the marker and without the live mark. */
  title: string;
  /** The genres of the description. */
  genres: readonly string[];
  /** True when the description carries the film ending with a year. */
  hasProductionYear: boolean;
}

/**
 * The kind of a text, from the text alone.
 *
 * The sources are tried in the order of the design (tv-guide-server.md
 * §4.3), and the first one that says something wins:
 *
 * 1. the **marker** of the provider ("х/ф");
 * 2. the **pattern** of the title (the name of a sport, "Трансляция из")
 *    or of the description (the genre "ток-шоу");
 * 3. the **film ending with a year** — the weak inference that the
 *    programme is a production.
 *
 * The theme of the channel is not in the list: it is not known when the
 * text is built, and it is applied by `applyChannelKind` when the guide
 * is written. It wins over the third source and loses against the first
 * two (see `sourceIsStronger`).
 *
 * @returns The kind and the source it came from.
 */
export function resolveKind(input: KindInput): KindOfText {
  const fromMarker = kindOfMarker(input.marker);
  if (fromMarker !== null) {
    return { kind: fromMarker, source: 'marker' };
  }

  const fromTitle = kindFromTitle(input.title);
  if (fromTitle !== null) return fromTitle;

  const fromGenres = kindFromGenres(input.genres);
  if (fromGenres !== null) return { kind: fromGenres, source: 'pattern' };

  if (input.hasProductionYear) return { kind: 'film', source: 'ending' };

  return { kind: 'other', source: 'none' };
}

/**
 * The word that tells the model what kind of programme a text is.
 *
 * It goes into the text that is embedded, so that the meaning of the
 * query and the meaning of the programme meet in the same words.
 */
export const KIND_WORDS: Record<Kind, string> = {
  film: 'Фильм',
  series: 'Сериал',
  animation: 'Анимационный фильм',
  animated_series: 'Мультсериал',
  documentary: 'Документальный фильм',
  docuseries: 'Документальный сериал',
  sport: 'Спортивная трансляция',
  news: 'Новостной выпуск',
  kids: 'Детская программа',
  music: 'Музыкальная программа',
  show: 'Развлекательная программа',
  other: 'Программа',
};
