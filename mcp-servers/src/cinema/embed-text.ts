/**
 * embed-text.ts - the text that is embedded for one title.
 *
 * One text per title (design: cinema-server.md §5):
 *
 *     {title} ({year}). {Фильм|Сериал}. Жанры: {genres}. Страна: {countries}.
 *     Режиссёр: {director}.
 *     {description}
 *
 * Empty parts are left out, so that a title without a director does not get
 * a "Режиссёр:" with nothing after it. The text is normalised before it is
 * hashed, so that a change of the whitespace does not cause a new vector.
 */

import { normalizeText } from '../shared/text.ts';

export interface EmbeddingTextInput {
  /** 'film' or 'series'. */
  type: 'film' | 'series';
  /** The display title, without the quality suffix. */
  title: string;
  /** The year, or null when the provider did not say. */
  year: number | null;
  /** The genres of the title, as the provider wrote them. */
  genres: string[];
  /** The country names, as the provider wrote them. */
  countries: string[];
  /** The director, or an empty string. */
  director: string;
  /** The description, or an empty string. */
  description: string;
}

/** The word that tells the model which kind of title this is. */
export const TYPE_WORDS: Record<'film' | 'series', string> = {
  film: 'Фильм',
  series: 'Сериал',
};

/**
 * Build the embedding text of a title.
 *
 * The result is normalised: the ё becomes е and the spaces are collapsed.
 */
export function buildEmbeddingText(input: EmbeddingTextInput): string {
  const parts: string[] = [];

  const title = input.title.trim();
  if (title) {
    parts.push(input.year === null ? title : `${title} (${input.year})`);
  }

  parts.push(TYPE_WORDS[input.type]);

  const genres = input.genres.map((genre) => genre.trim()).filter((genre) => genre.length > 0);
  if (genres.length > 0) parts.push(`Жанры: ${genres.join(', ')}`);

  const countries = input.countries
    .map((country) => country.trim())
    .filter((country) => country.length > 0);
  if (countries.length > 0) parts.push(`Страна: ${countries.join(', ')}`);

  const director = input.director.trim();
  if (director) parts.push(`Режиссёр: ${director}`);

  const head = parts.join('. ');

  const description = input.description.trim();
  if (!description) return normalizeText(head);

  return normalizeText(`${head}.\n${description}`);
}
