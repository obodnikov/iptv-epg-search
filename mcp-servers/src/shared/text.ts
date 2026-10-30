/**
 * text.ts - text normalisation, language detection and stemming.
 *
 * The web app's behaviour is the reference:
 * - `detectLanguage` is a port of public/scripts/utils/fuzzySearch.js:20
 * - `stemText` is a port of public/scripts/utils/fuzzySearch.js:61
 *
 * FTS5 has no Russian stemmer, so the text that goes into the index and the
 * text that goes into a query are stemmed the same way, before the search
 * (design: iptv-mcp-servers.md §6.3).
 */

import { newStemmer } from 'snowball-stemmers';

/** Common Russian words, used by the language guess. */
const COMMON_RUSSIAN_WORDS = new Set([
  'и', 'в', 'не', 'на', 'с', 'что', 'как', 'это', 'по', 'но',
  'из', 'за', 'для', 'от', 'до', 'при', 'без', 'под', 'над', 'про',
  'все', 'его', 'она', 'они', 'мы', 'вы', 'так', 'же', 'то', 'бы',
]);

export type Language = 'russian' | 'english';

/**
 * Guess the language of a text.
 *
 * Ported from public/scripts/utils/fuzzySearch.js:20 (web app).
 */
export function detectLanguage(text: string): Language {
  if (!text || typeof text !== 'string') return 'english';

  const lowerText = text.toLowerCase();
  const words = lowerText.split(/\s+/);

  let russianWordCount = 0;
  for (const word of words) {
    if (COMMON_RUSSIAN_WORDS.has(word)) russianWordCount++;
  }

  if (russianWordCount >= 2 || (russianWordCount >= 1 && words.length <= 3)) {
    return 'russian';
  }

  const cyrillicMatches = text.match(/[\u0400-\u04FF]/g);
  const cyrillicCount = cyrillicMatches ? cyrillicMatches.length : 0;

  const letterMatches = text.match(/[a-zA-Z\u0400-\u04FF]/g);
  const totalLetters = letterMatches ? letterMatches.length : 0;

  if (totalLetters === 0) return 'english';

  const cyrillicRatio = cyrillicCount / totalLetters;
  return cyrillicRatio > 0.3 ? 'russian' : 'english';
}

/** Longest text that is stemmed; the web app uses the same limit. */
const MAX_STEM_LENGTH = 2000;

const stemmerCache = new Map<Language, { stem(word: string): string }>();

function stemmerFor(language: Language): { stem(word: string): string } {
  const cached = stemmerCache.get(language);
  if (cached) return cached;
  const stemmer = newStemmer(language);
  stemmerCache.set(language, stemmer);
  return stemmer;
}

/**
 * Stem a text with Snowball.
 *
 * Ported from public/scripts/utils/fuzzySearch.js:61 (web app).
 *
 * @param text Text to stem.
 * @param language Language to stem with; guessed when omitted.
 */
export function stemText(text: string, language?: Language): string {
  if (!text || typeof text !== 'string') return '';

  const truncated = text.length > MAX_STEM_LENGTH ? text.substring(0, MAX_STEM_LENGTH) : text;
  const lang = language ?? detectLanguage(truncated);

  try {
    const stemmer = stemmerFor(lang);
    const words = truncated.toLowerCase().split(/\s+/);
    const stemmed = words.map((word) => {
      const cleanWord = word.replace(/[^\w\u0400-\u04FF]/g, '');
      if (!cleanWord) return '';
      return stemmer.stem(cleanWord);
    });
    return stemmed.filter((word) => word).join(' ');
  } catch {
    return truncated.toLowerCase();
  }
}

/**
 * Lower case, ё to е, punctuation to spaces, spaces collapsed.
 *
 * This is the `title_norm` rule of the design (cinema-server.md §3.2): the
 * normalised title takes part in the stable id and in the series grouping.
 *
 * Every letter of every script is kept: the catalogue holds Japanese and
 * Chinese titles as well, and a title that normalises to an empty string
 * would merge with every other title that does the same.
 */
export function normalizeTitle(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[ёЁ]/g, (char) => (char === 'ё' ? 'е' : 'Е'))
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalise free text: ё becomes е, the spaces are collapsed.
 *
 * The case is kept on purpose: the embedding text carries the names of the
 * films, their people and their places, and the capitalisation of a name
 * carries meaning. Only the whitespace and the ё/е difference are folded, so
 * that a re-import of the same catalogue does not produce a new vector for
 * every title.
 */
export function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .replace(/[ёЁ]/g, (char) => (char === 'ё' ? 'е' : 'Е'))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The number of characters of a text.
 *
 * SQLite counts the characters of a text, not the units of UTF-16: a text
 * with a character outside the basic plane is shorter in JavaScript than
 * in SQLite. The two have to be the same, so that a text is queued for
 * embedding on one path and skipped on the other (the queue modules of
 * the two servers use it).
 */
export function charLength(text: string): number {
  let count = 0;
  for (const _character of text) count += 1;
  return count;
}

/**
 * Cut a text to a length, on a word boundary when possible.
 */
export function snippet(text: string, maxChars: number): string {
  if (!text) return '';
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}

/**
 * Split a text into words that can be searched: letters and digits of every
 * script.
 */
export function words(text: string): string[] {
  if (!text) return [];
  return text
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((word) => word.length > 0);
}
