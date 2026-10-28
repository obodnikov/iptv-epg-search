/**
 * search-types.ts - the shapes of a search.
 *
 * They are in their own module, so that the words, the blend and the search
 * itself can use them without importing each other in a circle.
 */

import { type ListItem } from './items.ts';
import { type SearchFilters, type SortOrder } from './filters.ts';

/** The meaning of a query: the vector of the query and its model. */
export interface MeaningQuery {
  /** The vector of the query. */
  vector: Float32Array;
  /** The model the vector was made for. */
  model: string;
}

/** A search of the catalogue. */
export interface SearchRequest {
  /** A natural description, in any language. */
  query: string;
  /** Exact words: names of titles, people and places. */
  keywords: string[];
  /** A director. Also matched in the description. */
  person: string;
  filters: SearchFilters;
  sort: SortOrder;
  limit: number;
  offset: number;
}

/** The settings a search needs. */
export interface SearchOptions {
  /** The extra country names of the settings. */
  aliases: Record<string, string>;
  /** The length of the excerpt of the description. */
  snippetChars: number;
  /** The current moment, in epoch seconds. */
  now: number;
  /** The zone the times are shown in; 'auto' is the zone of the machine. */
  timezone: string;
  /** The meaning of the query, or null when there is none. */
  meaning?: MeaningQuery | null;
  /** The weight of the meaning against the words, 0 to 1. */
  meaningWeight?: number;
}

/** How the result was found. */
export type SearchMode = 'words' | 'words+meaning';

/** The result of a search. */
export interface SearchOutcome {
  /** How many titles match. */
  total: number;
  /** The page of titles. */
  items: ListItem[];
  /** The order the results really are in. */
  sort: SortOrder;
  /** True when the words of the query were used. */
  usedWords: boolean;
  /** True when the meaning of the query was used. */
  usedMeaning: boolean;
  /** How the result was found. */
  mode: SearchMode;
}
