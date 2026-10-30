/**
 * extract.ts - what the text of a programme says.
 *
 * Three things are read out of the text of a programme (the design:
 * tv-guide-server.md §4.4):
 *
 * - the **film ending** of the description: the director, the cast, the
 *   countries of the production, the year and the genres;
 * - the **venue**: the place of the event ("Трансляция из Мексики");
 * - the **sport**: the sport of the event ("Футбол. ЧМ-2026 …").
 *
 * The film ending is the tail of the description. The provider writes it
 * like this:
 *
 *     … Реж.: Борис Хлебников. В ролях: Александр Яценко. Россия, 2019, драма
 *
 * The talk shows carry a third field, the host of the show:
 *
 *     … Реж.: Роман Бутовский. Вед.: Дмитрий Борисов. Россия, 2005, ток-шоу
 *
 * The credits are **not** cut at the first full stop: the names carry
 * initials ("Реж.: А. Иванов", "В ролях: Дж. Смит, Том Харди"), and a
 * full stop inside a name is not the end of the credit. A credit ends at
 * the next credit field or at the country list — nothing else.
 *
 * The country list is therefore read from the sentences **after the last
 * credit field**, so that neither the cast nor the host is mistaken for a
 * country. The measured shape of the sample: 21,905 descriptions carry
 * "Реж.:", 15,699 "В ролях:" and 4,366 "Вед.:".
 */

import { countryCodeByStem } from '../shared/countries.ts';

/**
 * One country of a production.
 *
 * The name is the one the provider wrote; the code is null when the name
 * is not in the country table.
 */
export interface CountryRef {
  /** The name, as the source wrote it. */
  raw: string;
  /** The ISO 3166-1 alpha-2 code, or null. */
  code: string | null;
}

/** What the end of a description says. */
export interface FilmEnding {
  /** The director, as the provider wrote them. */
  directors: string;
  /** The cast, as the provider wrote them. */
  cast: string;
  /** The countries of the production. */
  countries: CountryRef[];
  /** The year of the production, or null. */
  year: number | null;
  /** The genres, as the provider wrote them. */
  genres: string[];
}

/** The kinds of credit field. */
type CreditKind = 'director' | 'cast' | 'host';

/** The credit fields of the description. */
const CREDIT_FIELDS: { kind: CreditKind; pattern: RegExp }[] = [
  { kind: 'director', pattern: /Реж\s*\.?\s*:/g },
  { kind: 'cast', pattern: /В\s+ролях\s*:/g },
  { kind: 'host', pattern: /Вед\s*\.?\s*:/g },
];

/** A year of a production. */
const YEAR = /^(?:19|20)\d{2}$/;

/** The longest country name that is accepted. */
const MAX_COUNTRY_CHARS = 40;

/** The most genres that are taken from one description. */
const MAX_GENRES = 10;

/**
 * One credit field of the description.
 */
interface Credit {
  kind: CreditKind;
  /** The position of the label of the field. */
  labelStart: number;
  /** The position right after the label of the field. */
  valueStart: number;
}

/**
 * The country list of a description.
 */
interface CountryList {
  /** The position where the list begins. */
  start: number;
  names: string[];
  year: number;
  genres: string[];
}

/**
 * All the credit fields of a description, in the order of the text.
 *
 * The field that comes last in the text is the last one, whatever field
 * it is: a description may carry the host before the director.
 */
function findCredits(text: string): Credit[] {
  const found: Credit[] = [];

  for (const { kind, pattern } of CREDIT_FIELDS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match !== null) {
      found.push({
        kind,
        labelStart: match.index,
        valueStart: match.index + match[0].length,
      });
      match = pattern.exec(text);
    }
  }

  found.sort((a, b) => a.valueStart - b.valueStart);
  return found;
}

/**
 * The sentences of a text, with the position of each of them.
 *
 * A sentence ends at a full stop that is followed by a space. A name with
 * an initial ("Дж. Смит") therefore ends a sentence early; the country
 * list is always the last one, and the credits are not cut at sentences
 * at all.
 */
function sentencesWithOffsets(text: string): { text: string; start: number }[] {
  const result: { text: string; start: number }[] = [];
  const split = /(?<=\.)\s+/g;

  let start = 0;
  let match = split.exec(text);
  while (match !== null) {
    result.push({ text: text.slice(start, match.index), start });
    start = match.index + match[0].length;
    match = split.exec(text);
  }
  result.push({ text: text.slice(start), start });

  return result;
}

/**
 * The comma list of a sentence: the countries, the year and the genres.
 *
 * @returns The list, or null when the sentence does not hold one.
 */
function commaListOf(sentence: string): { names: string[]; year: number; genres: string[] } | null {
  const parts = sentence
    .replace(/[.\s]*$/, '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  let index = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (YEAR.test(parts[i] as string)) {
      index = i;
      break;
    }
  }
  if (index === -1) return null;

  // The countries are the parts before the year. A year is not a
  // country. The parts are not split here: a name that holds a hyphen may
  // be one country ("Коста-Рика") or several ("Великобритания-Германия"),
  // and only the lookup can tell them apart.
  const names = parts
    .slice(0, index)
    .filter((part) => !YEAR.test(part))
    .map((name) => name.replace(/^[…\s]+/, '').trim())
    .filter((name) => name.length > 0 && name.length <= MAX_COUNTRY_CHARS);

  if (names.length === 0) return null;

  return {
    names,
    year: Number(parts[index]),
    genres: parts.slice(index + 1).filter((genre) => genre.length > 0).slice(0, MAX_GENRES),
  };
}

/**
 * The countries of a list.
 *
 * A name that is a country on its own is one country, even when it holds
 * a hyphen ("Коста-Рика"). A name that is not a country may be several
 * countries joined by a hyphen ("Великобритания-Германия-США"): it is
 * split only when every piece is a country on its own.
 */
function resolveCountries(names: string[]): CountryRef[] {
  const result: CountryRef[] = [];

  for (const name of names) {
    const code = countryCodeByStem(name);
    if (code !== null) {
      result.push({ raw: name, code });
      continue;
    }

    const parts = name
      .split('-')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (parts.length > 1) {
      const codes = parts.map((part) => countryCodeByStem(part));
      if (codes.every((value) => value !== null)) {
        parts.forEach((part, index) => {
          result.push({ raw: part, code: codes[index] as string });
        });
        continue;
      }
    }

    result.push({ raw: name, code: null });
  }

  return result;
}

/**
 * The country list of a description.
 *
 * The list is the last sentence that holds one. It is accepted only when
 * at least one of the names is a country the table knows: the
 * descriptions of the serial programmes of another channel end with a
 * season number and a year ("Сезон 5, 2019"), and those are not a
 * production.
 */
function findCountryList(text: string): CountryList | null {
  const sentences = sentencesWithOffsets(text);

  for (let i = sentences.length - 1; i >= 0; i--) {
    const sentence = sentences[i] as { text: string; start: number };
    const list = commaListOf(sentence.text);
    if (!list) continue;

    const countries = resolveCountries(list.names);
    if (!countries.some((country) => country.code !== null)) continue;

    return { start: sentence.start, names: list.names, year: list.year, genres: list.genres };
  }

  return null;
}

/**
 * The value of a credit field.
 *
 * The credit ends at the next credit field or at the country list —
 * nothing else. A full stop inside a name ("А. Иванов") is not the end of
 * the credit.
 */
function creditValue(
  text: string,
  credits: Credit[],
  list: CountryList | null,
  kind: CreditKind,
): string {
  const index = credits.findIndex((credit) => credit.kind === kind);
  if (index === -1) return '';

  const credit = credits[index] as Credit;

  let end = text.length;
  const next = credits[index + 1];
  // The credit ends before the label of the next one.
  if (next && next.labelStart < end) end = next.labelStart;
  if (list && list.start > credit.valueStart && list.start < end) end = list.start;

  return text
    .slice(credit.valueStart, end)
    .replace(/[\s.,;:]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Read the film ending out of a description.
 *
 * @returns The ending, or null when the description does not carry one.
 */
export function extractFilmEnding(description: string | null | undefined): FilmEnding | null {
  if (!description) return null;

  const text = description.replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const credits = findCredits(text);
  const list = findCountryList(text);

  const directors = creditValue(text, credits, list, 'director');
  const cast = creditValue(text, credits, list, 'cast');

  if (list) {
    return {
      directors,
      cast,
      countries: resolveCountries(list.names),
      year: list.year,
      genres: list.genres,
    };
  }

  // The credits without the country list: the director and the cast are
  // still facts worth keeping.
  if (directors || cast) {
    return { directors, cast, countries: [], year: null, genres: [] };
  }

  return null;
}

/**
 * The age mark the provider puts after a place: "(12+)".
 *
 * The data carries a broken form of it as well ("Канады (1"), so the
 * closing bracket is optional.
 */
const AGE_MARK = /\s*\(\s*\d{1,2}\s*\+?\s*\)?\s*$/;

/** The longest venue that is kept. */
const MAX_VENUE_CHARS = 80;

/** The venue in a title: "Трансляция из Мексики". */
const VENUE = /Трансляция из\s+(.+)$/;

/**
 * Cut the venue at the end of its sentence.
 *
 * A full stop ends the venue — but not the one of an abbreviation
 * ("г. Москвы", "С. Петербурга"), where a single letter stands before it.
 */
function cutAtSentenceEnd(text: string): string {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '.') continue;

    const before = text.slice(0, i).trimEnd();
    const lastWord = before.split(/[\s(]/).pop() ?? '';
    // A single letter before the full stop is an abbreviation.
    if (lastWord.length === 1) continue;

    return text.slice(0, i);
  }
  return text;
}

/**
 * Read the place of the event out of a title.
 *
 * The mark of the age limit comes off ("Казани (12+)" → "Казани"), and a
 * venue that the provider wrote with the names of the performers inside
 * it is cut short.
 *
 * @returns The place, or null when the title does not name one.
 */
export function extractVenue(title: string | null | undefined): string | null {
  if (!title) return null;

  const match = VENUE.exec(title);
  if (!match) return null;

  const place = cutAtSentenceEnd((match[1] as string).replace(/\s+/g, ' '))
    .replace(AGE_MARK, '')
    .trim();

  if (!place) return null;
  if (place.length > MAX_VENUE_CHARS) {
    return `${place.slice(0, MAX_VENUE_CHARS).trimEnd()}…`;
  }
  return place;
}

/**
 * The sports the provider names at the start of a title.
 *
 * The list holds the sports of the sample (verified 2026-10-30: Футбол
 * 1,211 programmes, Автоспорт 205, Велоспорт 150, Гандбол 114, Хоккей
 * 109, Волейбол 104, Регби 74, Бокс 57, Баскетбол 54, Теннис 50,
 * Плавание 30, Фигурное катание 8) and the sports of the other seasons
 * (Биатлон, Формула, Дартс, Сноуборд, …).
 */
const SPORTS: readonly string[] = [
  'Футбол',
  'Хоккей',
  'Биатлон',
  'Теннис',
  'Регби',
  'Баскетбол',
  'Волейбол',
  'Гандбол',
  'Плавание',
  'Бокс',
  'Борьба',
  'Карате',
  'Автоспорт',
  'Формула',
  'Дартс',
  'Велоспорт',
  'Сноуборд',
  'Фигурное катание',
  'Конный спорт',
  'Олимпийские игры',
  'UFC',
];

/**
 * Read the sport out of a title.
 *
 * The provider writes the sport at the start of the title, followed by a
 * full stop: "Футбол. ЧМ-2026. Нидерланды – Швеция. Трансляция из США".
 *
 * @returns The sport, or null when the title does not name one.
 */
export function extractSport(title: string | null | undefined): string | null {
  if (!title) return null;

  for (const sport of SPORTS) {
    if (title.startsWith(`${sport}.`) || title.startsWith(`${sport} `)) {
      return sport;
    }
  }
  return null;
}
