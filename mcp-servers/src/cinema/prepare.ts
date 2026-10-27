/**
 * prepare.ts - the titles of the catalogue as the rows that are written.
 *
 * The parser knows the entries of the provider; this module normalises
 * them: the countries get their code, the genres are trimmed, the text
 * that is embedded is built, and the hashes of the title are computed
 * (design: cinema-server.md §4 step 6).
 */

import { countryCode } from '../shared/countries.ts';
import { buildEmbeddingText } from './embed-text.ts';
import { idSeedFor, lookupKeyFor, textHash } from './keys.ts';
import { computeContentHash, type PreparedTitle } from './store.ts';
import type { Catalog, ParsedTitle } from './catalog.ts';
import type { ImportOptions } from './import-options.ts';

/**
 * Turn the titles of the catalogue into the rows that are written.
 */
export function prepareTitles(catalog: Catalog, options: ImportOptions): PreparedTitle[] {
  return catalog.titles.map((title) => prepareTitle(title, options));
}

/**
 * Turn one title of the catalogue into the rows that are written.
 */
export function prepareTitle(title: ParsedTitle, options: ImportOptions): PreparedTitle {
  const countries = title.countries.map((raw) => ({
    raw,
    code: countryCode(raw, options.countryAliases),
  }));

  const embedText = buildEmbeddingText({
    type: title.type,
    title: title.title,
    year: title.year,
    genres: title.genres,
    countries: title.countries,
    director: title.director,
    description: title.description,
  });

  const prepared: PreparedTitle = {
    type: title.type,
    title: title.title,
    titleNorm: title.titleNorm,
    year: title.year,
    rating: title.rating,
    category: title.category,
    director: title.director,
    description: title.description,
    posterUrl: title.posterUrl,
    durationMin: title.durationMin,
    addedAt: title.addedAt,
    addedRaw: title.addedRaw,
    isAdult: title.isAdult,
    isNewTag: title.isNewTag,
    genres: title.genres,
    countries,
    seasonCount: title.type === 'series' ? title.seasonCount : null,
    episodeCount: title.type === 'series' ? title.episodeCount : null,
    variants: title.variants
      .filter((variant) => variant.streamUrl !== null)
      .map((variant) => ({
        quality: variant.quality,
        streamUrl: variant.streamUrl ?? '',
        durationMin: variant.durationMin,
        category: variant.category,
      })),
    episodes: title.episodes
      .filter((episode) => episode.streamUrl !== null)
      .map((episode) => ({
        season: episode.season,
        episode: episode.episode,
        name: episode.name,
        streamUrl: episode.streamUrl ?? '',
        durationMin: episode.durationMin,
      })),
    lookupKey: lookupKeyFor(title.type, title.titleNorm, title.year),
    seed: idSeedFor(title.type, title.titleNorm, title.year),
    embedText,
    textHash: textHash(embedText),
    contentHash: '',
  };

  prepared.contentHash = computeContentHash(prepared);
  return prepared;
}
