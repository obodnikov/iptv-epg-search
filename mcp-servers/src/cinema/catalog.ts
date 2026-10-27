/**
 * catalog.ts - from catalogue entries to the rows the database holds.
 *
 * Two groupings happen here:
 * - films with the same normalised title and the same year become one title
 *   with several quality variants (design: cinema-server.md §3.5);
 * - episodes are grouped into series and their metadata is consolidated
 *   with the web app's rules (public/scripts/utils/m3uParser.js:339-366).
 */

import type { CinemaEntry } from './parser.ts';

export interface ParsedVariant {
  quality: string;
  streamUrl: string | null;
  durationMin: number | null;
  category: string;
  addedAt: number | null;
}

export interface ParsedEpisode {
  season: number;
  episode: number;
  name: string;
  streamUrl: string | null;
  durationMin: number | null;
}

export interface ParsedTitle {
  type: 'film' | 'series';
  /** Display title: for a film without the quality suffix. */
  title: string;
  /** Normalised title: lower case, ё to е, punctuation collapsed. */
  titleNorm: string;
  year: number | null;
  rating: number | null;
  category: string;
  director: string;
  description: string;
  posterUrl: string;
  /** Film length; for a series the most common episode length. */
  durationMin: number | null;
  addedAt: number | null;
  addedRaw: string;
  isAdult: boolean;
  isNewTag: boolean;
  genres: string[];
  /** The raw country values of the title. */
  countries: string[];
  seasonCount: number;
  episodeCount: number;
  variants: ParsedVariant[];
  episodes: ParsedEpisode[];
  /** Input of the stable id: `type | title_norm | year`. */
  idSeed: string;
}

export interface CatalogStats {
  entries: number;
  filmEntries: number;
  episodeEntries: number;
  films: number;
  series: number;
  variants: number;
  episodes: number;
  adultTitles: number;
  newTagTitles: number;
  /**
   * Series whose episodes name more than one director. The name may cover
   * two different series, which the grouping by name cannot tell apart.
   */
  seriesCollisions: SeriesCollision[];
}

export interface SeriesCollision {
  /** The normalised series title. */
  title: string;
  /** The directors that were seen for it. */
  directors: string[];
}

export interface Catalog {
  titles: ParsedTitle[];
  stats: CatalogStats;
}

/**
 * Build the id seed of a title (design: cinema-server.md §3.2).
 *
 * The seed is not the id. The importer (phase C2) looks a title up by its
 * type and its normalised title and keeps the id the row already has. A
 * series whose earliest episode year changes therefore keeps its id, and the
 * model can still open a title it mentioned yesterday.
 */
export function idSeed(type: 'film' | 'series', titleNorm: string, year: number | null): string {
  return `${type} | ${titleNorm} | ${year === null ? '' : String(year)}`;
}

function addUnique(list: string[], value: string): void {
  if (value && !list.includes(value)) list.push(value);
}

/** The most common value of a list, or null when the list is empty. */
function mostCommon(values: (number | null)[]): number | null {
  const counts = new Map<number, number>();
  for (const value of values) {
    if (value === null) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Group the entries into titles: films with their variants, series with
 * their episodes.
 */
export function buildCatalog(entries: CinemaEntry[]): Catalog {
  const filmMap = new Map<string, ParsedTitle>();
  const filmVariants = new Map<string, Map<string, ParsedVariant>>();

  const seriesMap = new Map<string, ParsedTitle>();
  const seriesEpisodes = new Map<string, Map<string, ParsedEpisode>>();
  // Keyed by the normalised series title, so that a collision can be
  // reported with the name of the series.
  const seriesDirectors = new Map<string, Set<string>>();

  let filmEntries = 0;
  let episodeEntries = 0;

  for (const entry of entries) {
    if (entry.type === 'episode') {
      episodeEntries += 1;
      addEpisode(entry, seriesMap, seriesEpisodes, seriesDirectors);
      continue;
    }

    filmEntries += 1;
    addFilm(entry, filmMap, filmVariants);
  }

  const titles: ParsedTitle[] = [];

  for (const [groupKey, title] of filmMap) {
    const variants = filmVariants.get(groupKey);
    if (variants) title.variants = [...variants.values()];
    title.idSeed = idSeed(title.type, title.titleNorm, title.year);
    titles.push(title);
  }

  for (const [groupKey, title] of seriesMap) {
    const episodes = seriesEpisodes.get(groupKey);
    const list = episodes ? [...episodes.values()] : [];
    list.sort((a, b) => a.season - b.season || a.episode - b.episode);
    title.episodes = list;
    title.episodeCount = list.length;
    title.seasonCount = new Set(list.map((episode) => episode.season)).size;
    title.durationMin = mostCommon(list.map((episode) => episode.durationMin));
    // The id of a series uses the earliest year of its episodes, so it is
    // only known once every episode was consolidated.
    title.idSeed = idSeed(title.type, title.titleNorm, title.year);
    titles.push(title);
  }

  const stats: CatalogStats = {
    entries: entries.length,
    filmEntries,
    episodeEntries,
    films: filmMap.size,
    series: seriesMap.size,
    variants: titles.reduce((sum, title) => sum + title.variants.length, 0),
    episodes: titles.reduce((sum, title) => sum + title.episodes.length, 0),
    adultTitles: titles.filter((title) => title.isAdult).length,
    newTagTitles: titles.filter((title) => title.isNewTag).length,
    seriesCollisions: [...seriesDirectors.entries()]
      .filter(([, directors]) => directors.size > 1)
      .map(([titleNorm, directors]) => ({ title: titleNorm, directors: [...directors] }))
      .sort((a, b) => b.directors.length - a.directors.length),
  };

  return { titles, stats };
}

/**
 * Add one film entry, merging it into the title of the same normalised
 * title and year.
 */
function addFilm(
  entry: CinemaEntry,
  filmMap: Map<string, ParsedTitle>,
  filmVariants: Map<string, Map<string, ParsedVariant>>,
): void {
  // Films are grouped by normalised title and year.
  const seed = idSeed('film', entry.titleNorm, entry.year);
  let title = filmMap.get(seed);

  if (!title) {
    title = {
      type: 'film',
      title: entry.title,
      titleNorm: entry.titleNorm,
      year: entry.year,
      rating: null,
      category: '',
      director: '',
      description: '',
      posterUrl: '',
      durationMin: entry.durationMin,
      addedAt: entry.addedAt,
      addedRaw: entry.addedRaw,
      isAdult: false,
      isNewTag: false,
      genres: [],
      countries: [],
      seasonCount: 0,
      episodeCount: 0,
      variants: [],
      episodes: [],
      idSeed: seed,
    };
    filmMap.set(seed, title);
    filmVariants.set(seed, new Map());
  }

  // The web app keeps the first non-empty value of every field
  // (public/scripts/utils/m3uParser.js:339-366). A rating of 0 is a real
  // rating, so "not set" is null and not 0.
  if (title.rating === null && entry.rating !== null) title.rating = entry.rating;
  if (title.durationMin === null && entry.durationMin !== null) title.durationMin = entry.durationMin;
  if (!title.category && entry.category) title.category = entry.category;
  if (!title.director && entry.director) title.director = entry.director;
  if (!title.description && entry.description) title.description = entry.description;
  if (!title.posterUrl && entry.poster) title.posterUrl = entry.poster;

  // The film entered the catalogue with its first variant: the earliest
  // `added` is the day the title appeared.
  if (entry.addedAt !== null && (title.addedAt === null || entry.addedAt < title.addedAt)) {
    title.addedAt = entry.addedAt;
    title.addedRaw = entry.addedRaw;
  }

  for (const genre of entry.genres) addUnique(title.genres, genre);
  // The country attribute holds a list: every single name is kept, so that
  // the country filter can match any country of the film.
  for (const country of entry.countryList) addUnique(title.countries, country);
  if (entry.isAdult) title.isAdult = true;
  if (entry.tags.includes('Новинки')) title.isNewTag = true;

  const variants = filmVariants.get(seed);
  if (variants && !variants.has(entry.quality)) {
    variants.set(entry.quality, {
      quality: entry.quality,
      streamUrl: entry.streamUrl,
      durationMin: entry.durationMin,
      category: entry.category,
      addedAt: entry.addedAt,
    });
  }
}

/**
 * Add one episode entry, consolidating it into its series.
 */
function addEpisode(
  entry: CinemaEntry,
  seriesMap: Map<string, ParsedTitle>,
  seriesEpisodes: Map<string, Map<string, ParsedEpisode>>,
  seriesDirectors: Map<string, Set<string>>,
): void {
  const seriesTitle = entry.seriesTitle ?? entry.title;
  const seriesNorm = entry.seriesTitleNorm ?? entry.titleNorm;
  // Episodes are grouped by the series title alone: the episodes of one
  // series carry different years, and the series takes the earliest one.
  // Two series of the same name would be merged; the sample holds none.
  const seed = idSeed('series', seriesNorm, null);

  let title = seriesMap.get(seed);

  if (!title) {
    title = {
      type: 'series',
      title: seriesTitle,
      titleNorm: seriesNorm,
      year: entry.year,
      rating: null,
      category: '',
      director: '',
      description: '',
      posterUrl: '',
      durationMin: null,
      addedAt: entry.addedAt,
      addedRaw: entry.addedRaw,
      isAdult: false,
      isNewTag: false,
      genres: [],
      countries: [],
      seasonCount: 0,
      episodeCount: 0,
      variants: [],
      episodes: [],
      idSeed: seed,
    };
    seriesMap.set(seed, title);
    seriesEpisodes.set(seed, new Map());
  }

  if (title.rating === null && entry.rating !== null) title.rating = entry.rating;
  if (!title.category && entry.category) title.category = entry.category;
  if (!title.director && entry.director) title.director = entry.director;
  if (!title.description && entry.description) title.description = entry.description;
  if (!title.posterUrl && entry.poster) title.posterUrl = entry.poster;

  // Earliest year: the year the series started.
  if (entry.year !== null && (title.year === null || entry.year < title.year)) {
    title.year = entry.year;
  }

  // Latest `added`: the newest episode of the series.
  if (entry.addedAt !== null && (title.addedAt === null || entry.addedAt > title.addedAt)) {
    title.addedAt = entry.addedAt;
    title.addedRaw = entry.addedRaw;
  }

  for (const genre of entry.genres) addUnique(title.genres, genre);
  for (const country of entry.countryList) addUnique(title.countries, country);
  if (entry.isAdult) title.isAdult = true;
  if (entry.tags.includes('Новинки')) title.isNewTag = true;

  const episodes = seriesEpisodes.get(seed);
  if (!episodes) return;

  // Two series of the same name would be merged. More than one director for
  // the same name is the signal that this happened; the importer logs it.
  if (entry.director) {
    const directors = seriesDirectors.get(seriesNorm) ?? new Set<string>();
    directors.add(entry.director);
    seriesDirectors.set(seriesNorm, directors);
  }
  const season = entry.season ?? 1;
  const episode = entry.episode ?? 1;
  const key = `${season}-${episode}`;

  // Episodes are de-duplicated by season and episode number
  // (public/scripts/utils/m3uParser.js:373-384).
  if (!episodes.has(key)) {
    episodes.set(key, {
      season,
      episode,
      name: entry.title,
      streamUrl: entry.streamUrl,
      durationMin: entry.durationMin,
    });
  }
}
