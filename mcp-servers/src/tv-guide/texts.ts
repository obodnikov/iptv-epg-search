/**
 * texts.ts - the deduplicated programme texts and their derived fields.
 *
 * Programmes repeat heavily: the 321,787 programmes of the sample carry
 * only 102,467 distinct (title, description) pairs (design:
 * tv-guide-server.md §2.3, corrected in T1). The classification, the
 * extraction, the keyword index and the vectors are all per **text**, not
 * per programme.
 *
 * The hash of a text is over the pair exactly as the source wrote it: the
 * derived fields (the cleaned title, the facts of phase T2) change when
 * their extraction improves, but a text whose source pair did not change
 * must not get a new hash and a new vector.
 *
 * The vector is keyed by the hash of the **embedding text** and not by
 * the hash of the pair: the vector has to describe what was embedded.
 * The cinema server works the same way (`textHash` in
 * src/cinema/keys.ts:72). The two hashes live side by side in the row of
 * the text: `text_hash` is the identity of the text, `embed_hash` is the
 * key of its vector.
 */

import { createHash } from 'node:crypto';

import { normalizeText, normalizeTitle } from '../shared/text.ts';
import { extractFilmEnding, extractSport, extractVenue, type CountryRef } from './extract.ts';
import {
  KIND_WORDS,
  MARKER_PATTERN,
  resolveKind,
  sourceIsStronger,
  type Kind,
  type KindSource,
} from './kind.ts';

/**
 * The version of the derivation.
 *
 * The guide rewrites the derived fields of a text whose version differs
 * from the one in the database: the extraction of phase T2 changed, and
 * the facts of the text changed with it.
 */
export const DERIVED_VERSION = 1;

/**
 * The mark the provider puts before the title of a live broadcast.
 *
 * Measured on the sample (2026-10-30): 1,107 titles carry it, none of
 * them carries the same title without it, and all of them are sport
 * broadcasts. What it marks exactly is not known (design §12.1), so it
 * stays a flag.
 */
const LIVE_MARK = '⋗';

/**
 * One distinct (title, description) pair, with the facts of phase T2.
 */
export interface ProgrammeText {
  /** The hash of the source pair. */
  hash: string;
  /** The title as the source wrote it. */
  rawTitle: string;
  /** The description as the source wrote it. */
  rawDescription: string;
  /** The title without the type marker and without the live mark. */
  title: string;
  /** The normalised title (lower case, ё→е, punctuation collapsed). */
  titleNorm: string;
  /** The description as the source wrote it. */
  description: string;
  /** True when the title started with the live mark. */
  liveMark: boolean;
  /** The type marker of the title, or null. */
  marker: string | null;
  /** What kind of programme the text is. */
  kind: Kind;
  /** Where the kind came from. */
  kindSource: KindSource;
  /** The year of the production, or null. */
  year: number | null;
  /** The director, as the provider wrote them. */
  directors: string;
  /** The cast, as the provider wrote them. */
  castNames: string;
  /** The genres, as the provider wrote them. */
  genres: string[];
  /** The countries of the production. */
  countries: CountryRef[];
  /**
   * True when the description carries the film ending.
   *
   * The ending is the credits of the production (the director, the cast)
   * or the country list with the year of the production.
   */
  hasEnding: boolean;
  /** The sport of the event, or null. */
  sport: string | null;
  /** The place of the event, or null. */
  venue: string | null;
  /** The text that is embedded. */
  embedText: string;
  /** The hash of the embedding text: the key of the vector. */
  embedHash: string;
}

/**
 * The hash of a (title, description) pair.
 *
 * The lengths are part of the input, so that a title that ends where a
 * description begins cannot forge the same input.
 */
export function programmeTextHash(title: string, description: string): string {
  const hash = createHash('sha256');
  hash.update(`${title.length}`);
  hash.update('\u0000');
  hash.update(title);
  hash.update('\u0000');
  hash.update(description);
  hash.update('\u0000');
  return hash.digest('hex');
}

/**
 * The hash of an embedding text.
 *
 * The text is normalised before it is hashed, so that a change of the
 * whitespace does not cause a new vector (the rule of the cinema
 * server, src/cinema/keys.ts:72).
 */
export function embedTextHash(text: string): string {
  return createHash('sha256').update(normalizeText(text)).digest('hex');
}

/**
 * The marks that come off the title: the live mark and the type marker.
 *
 * The provider writes them in both orders ("⋗ ЧМ-2026. …" and
 * "х/ф Бык"), so they are taken off one after the other. The type
 * markers live in one table, in `kind.ts`.
 */
interface CleanTitle {
  title: string;
  liveMark: boolean;
  marker: string | null;
}

function cleanTitle(raw: string): CleanTitle {
  let title = raw.trim();
  let liveMark = false;
  let marker: string | null = null;

  for (;;) {
    if (title.startsWith(`${LIVE_MARK} `) || title === LIVE_MARK) {
      liveMark = true;
      title = title.slice(LIVE_MARK.length).trim();
      continue;
    }
    const found = MARKER_PATTERN.exec(title);
    if (found) {
      // The marker is kept in lower case: that is the way the provider
      // writes it, and the lookup of the kind uses it.
      marker = (found[1] ?? '').toLowerCase();
      title = title.slice(found[0].length).trim();
      continue;
    }
    break;
  }

  return { title, liveMark, marker };
}

/**
 * The text that is embedded for one programme text.
 *
 * The shape follows the cinema server (src/cinema/embed-text.ts): the
 * facts come first, the description last. The empty parts are left out.
 */
function buildEmbedText(
  title: string,
  kind: Kind,
  year: number | null,
  genres: readonly string[],
  countries: readonly CountryRef[],
  directors: string,
  castNames: string,
  sport: string | null,
  venue: string | null,
  description: string,
): string {
  // A text without a title and without a description has nothing to say:
  // there is nothing to embed, and the vector of nothing would be the
  // vector of every other text without anything.
  if (!title.trim() && !description.trim()) return '';

  const parts: string[] = [];

  parts.push(year === null ? title : `${title} (${year})`);
  parts.push(KIND_WORDS[kind]);

  const genreList = genres.map((genre) => genre.trim()).filter((genre) => genre.length > 0);
  if (genreList.length > 0) parts.push(`Жанры: ${genreList.join(', ')}`);

  const countryList = countries
    .map((country) => country.raw.trim())
    .filter((country) => country.length > 0);
  if (countryList.length > 0) parts.push(`Страна: ${countryList.join(', ')}`);

  if (directors.trim().length > 0) parts.push(`Режиссёр: ${directors.trim()}`);
  if (castNames.trim().length > 0) parts.push(`В ролях: ${castNames.trim()}`);
  if (sport !== null) parts.push(`Спорт: ${sport}`);
  if (venue !== null) parts.push(`Место: ${venue}`);

  const head = parts.join('. ');

  const text = description.trim();
  if (!text) return normalizeText(head);

  return normalizeText(`${head}.\n${text}`);
}

/**
 * Build the record of one programme text.
 *
 * @param rawTitle The title as the source wrote it.
 * @param rawDescription The description as the source wrote it.
 */
export function buildProgrammeText(rawTitle: string, rawDescription: string): ProgrammeText {
  const title = rawTitle.trim();
  const description = rawDescription.trim();

  const cleaned = cleanTitle(title);

  // The facts of the description.
  const ending = extractFilmEnding(description);
  const countries = ending?.countries ?? [];
  const genres = ending?.genres ?? [];

  // The kind of the text: the marker, the pattern and the film ending.
  // The theme of the channel arrives later, when the channels of the text
  // are known.
  const resolved = resolveKind({
    marker: cleaned.marker,
    title: cleaned.title,
    genres,
    hasProductionYear: ending !== null && ending.year !== null,
  });
  const kind = resolved.kind;
  const kindSource = resolved.source;

  // The sport and the venue are read once: they go into the text that is
  // embedded and into the row of the text.
  const sport = extractSport(cleaned.title);
  const venue = extractVenue(cleaned.title);

  const embedText = buildEmbedText(
    cleaned.title,
    kind,
    ending?.year ?? null,
    genres,
    countries,
    ending?.directors ?? '',
    ending?.cast ?? '',
    sport,
    venue,
    description,
  );

  return {
    hash: programmeTextHash(title, description),
    rawTitle: title,
    rawDescription: description,
    title: cleaned.title,
    titleNorm: normalizeTitle(cleaned.title),
    description,
    liveMark: cleaned.liveMark,
    marker: cleaned.marker,
    kind,
    kindSource,
    year: ending?.year ?? null,
    directors: ending?.directors ?? '',
    castNames: ending?.cast ?? '',
    genres,
    countries,
    hasEnding: ending !== null,
    sport,
    venue,
    embedText,
    embedHash: embedTextHash(embedText),
  };
}

/**
 * Give a text the kind of the theme of its channels.
 *
 * The theme of a channel is a property of an airing: the same text airs
 * on a sports channel and on a general one. The writer gives the theme
 * to the texts whose channels agree on it, and the search (phase T3)
 * falls back to the theme of the channel of the airing.
 *
 * @param text The text.
 * @param channelKind The kind the theme of the channels gives, or null.
 * @returns The text with the kind, and the embedding text rebuilt when
 *   the kind changed.
 */
export function applyChannelKind(text: ProgrammeText, channelKind: Kind | null): ProgrammeText {
  if (channelKind === null) return text;
  // The theme of the channel wins over the weak inference of the film
  // ending, and it loses against the words of the provider: a sports
  // title on a news channel is a sport programme, and a documentary
  // channel shows documentaries, also the ones whose description names
  // them a film. The order is written down once, in `kind.ts`.
  if (!sourceIsStronger('channel', text.kindSource)) return text;
  if (text.kind === channelKind) {
    // The kind is the same, but the source of it is stronger: the row
    // says where the kind came from. The embedding text does not change —
    // it carries the kind, not the source.
    return { ...text, kindSource: 'channel' };
  }

  const embedText = buildEmbedText(
    text.title,
    channelKind,
    text.year,
    text.genres,
    text.countries,
    text.directors,
    text.castNames,
    text.sport,
    text.venue,
    text.description,
  );

  return {
    ...text,
    kind: channelKind,
    kindSource: 'channel',
    embedText,
    embedHash: embedTextHash(embedText),
  };
}
