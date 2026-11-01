/**
 * search-types.ts - the shapes of a search of the guide.
 *
 * They are in their own module, so that the words, the candidates, the
 * meaning and the search itself can use them without importing each other
 * in a circle (the cinema server splits the same way,
 * `src/cinema/search-types.ts`).
 */

import { type MeaningQuery } from '../shared/blend.ts';
import { type ListItem } from './items.ts';

/** The order a search may ask for. */
export type SortOrder = 'relevance' | 'time' | 'channel';

/** How the result was found, as the answer names it. */
export type SearchMode = 'words' | 'filters' | 'words+meaning';

/** The parts of a search that decide what the result is. */
export interface SearchRequest {
  query: string;
  keywords: string[];
  person: string;
  kinds: string[];
  /** The window, resolved out of `period` or `from` / `to`. */
  window: {
    field: 'start' | 'stop';
    from: number | null;
    to: number | null;
    onAir: boolean;
    onAirFrom: number | null;
  };
  themes: string[];
  regions: string[];
  channelIds: string[];
  productionCountries: { codes: string[]; raws: string[] };
  yearFrom: number | null;
  yearTo: number | null;
  onlyCatchup: boolean;
  hideRepeats: boolean;
  preferHd: boolean;
  sort: SortOrder;
}

/** The settings and the moment a search runs with. */
export interface SearchOptions {
  /** The frozen moment of the search, in epoch seconds. */
  now: number;
  timezone: string;
  snippetChars: number;
  includeAdult: boolean;
  /** The meaning of the query, or null when there is none. */
  meaning?: MeaningQuery | null;
  /** The weight of the meaning against the words, 0 to 1. */
  meaningWeight?: number;
}

/** What a search found. */
export interface SearchOutcome {
  total: number;
  items: ListItem[];
  usedWords: boolean;
  mode: SearchMode;
}
