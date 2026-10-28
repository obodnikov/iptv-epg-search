/**
 * search.ts - the search of the cinema catalogue.
 *
 * The pipeline of the design (iptv-mcp-servers.md §7.1):
 *
 * 1. the filters are applied in SQL and produce the candidates;
 * 2. the words are matched in the keyword index, which holds the stemmed
 *    text (FTS5 has no Russian stemmer);
 * 3. the meaning of the query is compared with the vector of every
 *    candidate;
 * 4. both scores are rescaled to 0-1 inside the candidate set and mixed:
 *    `score = meaningWeight * meaning + (1 - meaningWeight) * words`;
 * 5. the result is sorted and cut to the limit.
 *
 * The candidate set is the **union** of the titles that match the words and
 * the titles that have a vector: a title that was found by one side only
 * gets 0 for the other. A query that matches no word at all ("a film about
 * loneliness in space") is answered by the meaning alone.
 *
 * Without vectors the search runs on the words alone and says so:
 * `search_mode` is "words".
 *
 * The words are in `words.ts`, the candidates and the mix of the scores in
 * `blend.ts`, the rows of a title in `items.ts`.
 */

import { type Db, withSnapshot } from '../shared/db.ts';
import { buildFilter, type SortOrder } from './filters.ts';
import { blendCandidates, collectCandidates } from './blend.ts';
import { buildItems, fetchTitleRows } from './items.ts';
import {
  type MeaningQuery,
  type SearchOptions,
  type SearchOutcome,
  type SearchRequest,
} from './search-types.ts';
import { buildMatchExpression, searchWithWords } from './words.ts';

export type {
  MeaningQuery,
  SearchMode,
  SearchOptions,
  SearchOutcome,
  SearchRequest,
} from './search-types.ts';

/**
 * True when the search uses the meaning of the query.
 *
 * The meaning is only used when the result is ordered by relevance: another
 * order asks for something else. A query without words has no meaning to
 * compare with.
 */
export function usesMeaning(
  request: SearchRequest,
  meaning: MeaningQuery | null | undefined,
): boolean {
  if (!meaning) return false;
  if (request.sort !== 'relevance') return false;
  return request.query.trim().length > 0;
}

/**
 * Search the catalogue.
 *
 * The words are matched in the keyword index, the meaning in the vectors;
 * the filters are applied in SQL. The result is the page of titles and the
 * number of titles that match.
 */
export function searchTitles(
  db: Db,
  request: SearchRequest,
  options: SearchOptions,
): SearchOutcome {
  const expression = buildMatchExpression(request.query, request.keywords, request.person);
  const usedWords = expression !== null;

  const meaning = usesMeaning(request, options.meaning) ? (options.meaning as MeaningQuery) : null;
  const usedMeaning = meaning !== null;

  const sort =
    request.sort === 'relevance' && !usedWords && !usedMeaning ? 'added' : request.sort;

  // The number of titles and the page of the titles belong to the same
  // snapshot: a refresh that commits in the middle of the search must not
  // make the two disagree.
  return withSnapshot(db, () => {
    if (!usedMeaning) {
      const outcome = searchWithWords(db, request, options, expression, sort);
      return {
        total: outcome.total,
        items: outcome.items,
        sort,
        usedWords: outcome.usedWords,
        usedMeaning: false,
        mode: 'words' as const,
      };
    }

    return searchWithMeaning(db, request, options, expression, meaning as MeaningQuery, sort);
  });
}

/**
 * The search with the meaning: the words, the vectors and the blend.
 */
function searchWithMeaning(
  db: Db,
  request: SearchRequest,
  options: SearchOptions,
  expression: string | null,
  meaning: MeaningQuery,
  sort: SortOrder,
): SearchOutcome {
  const filter = buildFilter(request.filters, options.aliases, options.now);
  const candidates = collectCandidates(db, filter, expression, meaning);

  // The meaning is only used when it found something: a catalogue without
  // vectors is searched by the words alone, and the answer says so.
  const hasDistances = candidates.some((candidate) => candidate.distance !== null);
  if (!hasDistances) {
    const outcome = searchWithWords(db, request, options, expression, sort);
    return {
      total: outcome.total,
      items: outcome.items,
      sort,
      usedWords: outcome.usedWords,
      usedMeaning: false,
      mode: 'words' as const,
    };
  }

  const scores = blendCandidates(candidates, options.meaningWeight ?? 0.7);

  const scored = candidates.map((candidate) => ({
    title_id: candidate.title_id,
    score: scores.get(candidate.title_id) ?? 0,
  }));

  // The order is total: the id of the title breaks a tie, so that a page
  // does not miss a title.
  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.title_id < right.title_id ? -1 : left.title_id > right.title_id ? 1 : 0;
  });

  const total = scored.length;
  const page = scored.slice(request.offset, request.offset + request.limit);

  const rows = fetchTitleRows(
    db,
    page.map((entry) => entry.title_id),
  );
  const scoreById = new Map(page.map((entry) => [entry.title_id, entry.score]));

  const items = buildItems(db, rows, options, (row) =>
    Math.round((scoreById.get(row.title_id) ?? 0) * 1e6) / 1e6,
  );

  return {
    total,
    items,
    sort,
    usedWords: expression !== null,
    usedMeaning: true,
    mode: 'words+meaning',
  };
}

/**
 * The signature of a search.
 *
 * Two searches with the same signature have the same result, so the cursor
 * of one of them fits the other. The model of the vectors is part of it:
 * the vectors of two models are never compared.
 */
export function searchSignature(request: SearchRequest, meaningModel = ''): string {
  const filters = request.filters;
  return JSON.stringify([
    request.query.trim(),
    [...request.keywords].map((keyword) => keyword.trim()).sort(),
    request.person.trim(),
    filters.type,
    [...filters.categories].sort(),
    [...filters.genres].sort(),
    [...filters.excludeGenres].sort(),
    [...filters.countries].map((country) => country.trim().toLowerCase()).sort(),
    filters.yearFrom,
    filters.yearTo,
    filters.minRating,
    filters.maxMinutes,
    filters.addedWithinDays,
    filters.includeAdult,
    request.sort,
    meaningModel,
  ]);
}
