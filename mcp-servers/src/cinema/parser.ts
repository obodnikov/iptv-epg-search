/**
 * parser.ts - one catalogue entry of the provider's extended M3U.
 *
 * The web app's parser (public/scripts/utils/m3uParser.js) is the reference.
 * This parser reads the attributes the web app ignores as well:
 * - `duration="44"` - the episode length in minutes;
 * - `censored="1"`   - the provider's adult marker.
 *
 * It also reads the number after `#EXTINF:` as the film length in seconds,
 * and `added` with its offset, so that every absolute time is correct
 * (design: cinema-server.md §2.2).
 */

import { sanitizeUrl } from '../shared/links.ts';
import { splitCountryList } from '../shared/countries.ts';
import { parseM3uText, type M3uDocument } from '../shared/m3u.ts';
import { normalizeTitle } from '../shared/text.ts';
import { parseProviderTimestamp } from '../shared/time.ts';

/**
 * Detects the S01E01 pattern in a title.
 * Ported from public/scripts/utils/m3uParser.js:291 (web app).
 */
export const EPISODE_REGEX = /^(.+?)\s+[Ss](\d+)\s*[Ee](\d+)(?:\s*[-:].*)?$/;

/**
 * Quality suffix at the end of a film title.
 *
 * Only the tokens the provider really uses are stripped: "4K", "4K HDR",
 * "4K SDR", "4K HD", "HDR" and "UHD". The "К" of "4К" is the Cyrillic letter
 * in some entries of the sample. A title that only starts like a quality
 * ("4Kids", "UHDTV") keeps its bracket.
 */
export const QUALITY_SUFFIX = /\s*\((4[KК](?:\s+(?:HDR|SDR|HD))?|HDR|UHD)\)\s*$/;

/** Provider tag: the title was added recently. */
export const TAG_NEW = 'Новинки';

/** Provider tag: the title is a series. It is not a genre. */
export const TAG_SERIAL = 'Сериал';

/** One catalogue entry. */
export interface CinemaEntry {
  /** Position in the file. */
  index: number;
  /** 'film' or 'episode'. */
  type: 'film' | 'episode';
  /** Display title: for a film without the quality suffix. */
  title: string;
  /** 'standard' or the suffix, e.g. '4K HDR'. */
  quality: string;
  /** Normalised title: lower case, ё to е, punctuation collapsed. */
  titleNorm: string;
  /** Series title, for episodes. */
  seriesTitle: string | null;
  /** Normalised series title: the grouping key. */
  seriesTitleNorm: string | null;
  season: number | null;
  episode: number | null;
  year: number | null;
  /** Provider rating 0-10, null when the provider left it empty. */
  rating: number | null;
  /** Genres, trimmed; the provider tags are not in here. */
  genres: string[];
  /** Provider tags found on the entry. */
  tags: string[];
  /** The raw country attribute, as the provider wrote it. */
  country: string;
  /** The single country names of that attribute. */
  countryList: string[];
  director: string;
  /** The `group-title` attribute: the catalogue category. */
  category: string;
  /** The raw `added` string. */
  addedRaw: string;
  /** `added` as UTC epoch seconds. */
  addedAt: number | null;
  /** The provider marked the entry as censored. */
  censored: boolean;
  /** The entry belongs to adult content. */
  isAdult: boolean;
  /** Length in minutes, or null when the provider did not say. */
  durationMin: number | null;
  poster: string;
  description: string;
  /** The stream URL, or null when it failed the http/https check. */
  streamUrl: string | null;
}

export interface CinemaParseResult {
  entries: CinemaEntry[];
  /** Entries whose stream line was not an http/https URL. */
  rejected: number;
  /** `#EXTINF` blocks without a stream line. */
  incomplete: number;
  /** True when the file started with `#EXTM3U`. */
  hasHeader: boolean;
}

/**
 * Split the `genres` attribute into trimmed genres and provider tags.
 */
export function splitGenres(raw: string): { genres: string[]; tags: string[] } {
  const genres: string[] = [];
  const tags: string[] = [];

  for (const part of raw.split(',')) {
    const value = part.trim();
    if (!value) continue;
    if (value === TAG_NEW || value === TAG_SERIAL) {
      if (!tags.includes(value)) tags.push(value);
      continue;
    }
    if (!genres.includes(value)) genres.push(value);
  }

  return { genres, tags };
}

/**
 * Read the provider rating. An empty attribute means "unknown" and becomes
 * null; a real 0 stays 0. A value that is not a number, or a number outside
 * 0-10, is not a rating.
 */
export function parseRating(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const value = Number.parseFloat(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > 10) return null;
  return value;
}

/**
 * Read the year. A value that is not a number is not a year.
 */
export function parseYear(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^\d{1,4}$/.test(trimmed)) return null;
  const value = Number.parseInt(trimmed, 10);
  return Number.isFinite(value) ? value : null;
}

/**
 * Split a title into the display title and the quality.
 */
export function splitQuality(title: string): { title: string; quality: string } {
  const match = QUALITY_SUFFIX.exec(title);
  if (!match) return { title: title.trim(), quality: 'standard' };
  const quality = (match[1] ?? '').trim();
  const base = title.slice(0, match.index).trim();
  return { title: base, quality: quality || 'standard' };
}

/**
 * True when the category marks adult content.
 *
 * The provider writes "Эротика (18+)". The marker is matched with the
 * boundaries around it, so that a category like "2018+" is not adult.
 */
export function isAdultCategory(category: string): boolean {
  return /(^|[\s(])18\+/.test(category);
}

/**
 * Turn one `#EXTINF` block into a catalogue entry.
 */
export function parseEntry(entry: {
  index: number;
  extinfNumber: number | null;
  attributes: Record<string, string>;
  title: string;
  poster: string;
  description: string;
  streamLine: string | null;
}): CinemaEntry {
  const attributes = entry.attributes;

  const episodeMatch = EPISODE_REGEX.exec(entry.title);
  const isEpisode = episodeMatch !== null;

  const seriesTitle = isEpisode ? (episodeMatch?.[1] ?? '').trim() : null;
  const season = isEpisode ? Number.parseInt(episodeMatch?.[2] ?? '', 10) : null;
  const episode = isEpisode ? Number.parseInt(episodeMatch?.[3] ?? '', 10) : null;

  const { title, quality } = splitQuality(entry.title);
  const { genres, tags } = splitGenres(attributes['genres'] ?? '');

  const country = (attributes['country'] ?? '').trim();
  // The attribute holds a list of countries: "Canada, United States of America".
  const countryList = splitCountryList(country);

  const category = (attributes['group-title'] ?? '').trim();
  const censored = (attributes['censored'] ?? '').trim() === '1';

  // Films: the number after #EXTINF is the length in seconds.
  // Episodes: the `duration` attribute is the length in minutes.
  let durationMin: number | null = null;
  const durationAttribute = attributes['duration'];
  if (isEpisode) {
    if (durationAttribute !== undefined && durationAttribute.trim()) {
      const value = Number.parseInt(durationAttribute.trim(), 10);
      if (Number.isFinite(value) && value > 0 && /^\d+$/.test(durationAttribute.trim())) {
        durationMin = value;
      }
    }
  } else if (entry.extinfNumber !== null && entry.extinfNumber > 0) {
    const minutes = Math.round(entry.extinfNumber / 60);
    // A length that rounds down to nothing is not a length.
    if (minutes > 0) durationMin = minutes;
  }

  const addedRaw = (attributes['added'] ?? '').trim();

  return {
    index: entry.index,
    type: isEpisode ? 'episode' : 'film',
    title,
    quality,
    titleNorm: normalizeTitle(title),
    seriesTitle,
    seriesTitleNorm: seriesTitle ? normalizeTitle(seriesTitle) : null,
    season,
    episode,
    year: parseYear(attributes['year']),
    rating: parseRating(attributes['rating']),
    genres,
    tags,
    country,
    countryList,
    director: (attributes['director'] ?? '').trim(),
    category,
    addedRaw,
    addedAt: parseProviderTimestamp(addedRaw),
    censored,
    isAdult: censored || isAdultCategory(category),
    durationMin,
    poster: sanitizeUrl(entry.poster) ?? '',
    description: entry.description,
    streamUrl: sanitizeUrl(entry.streamLine),
  };
}

/**
 * Read the whole catalogue file.
 *
 * An entry whose stream line is not an http/https URL is rejected and
 * counted; the entry itself is kept out of the result
 * (design: cinema-server.md §4 step 3).
 */
export function parseCinemaCatalog(text: string): CinemaParseResult {
  const document: M3uDocument = parseM3uText(text);

  const entries: CinemaEntry[] = [];
  let rejected = 0;

  for (const entry of document.entries) {
    const parsed = parseEntry(entry);
    if (parsed.streamUrl === null) {
      rejected += 1;
      continue;
    }
    entries.push(parsed);
  }

  return {
    entries,
    rejected,
    incomplete: document.incomplete,
    hasHeader: document.hasHeader,
  };
}
