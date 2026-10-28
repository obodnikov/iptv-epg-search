/**
 * blend.ts - the candidates of a search and the mix of their scores.
 *
 * The side of the search that knows the meaning (design:
 * iptv-mcp-servers.md §7.1 steps 1, 3 and 4):
 *
 * - the candidates: the titles that match the words and the titles that
 *   have a vector;
 * - the distance of every candidate to the query;
 * - the blend: both scores are rescaled to 0-1 inside the candidate set
 *   and mixed.
 */

import { type Db } from '../shared/db.ts';
import { toBlob, vectorsTableExists } from '../shared/vectors.ts';
import { type MeaningQuery } from './search-types.ts';

/**
 * A candidate of a search: a title, the words it matched and its distance
 * to the query.
 */
export interface Candidate {
  title_id: string;
  /** The bm25 score of the title; null when it matched no word. */
  words: number | null;
  /** The distance to the query; null when the title has no vector. */
  distance: number | null;
}

/**
 * The smallest and the biggest value of a list.
 */
function bounds(values: number[]): { min: number; max: number } | null {
  if (values.length === 0) return null;
  let min = values[0] as number;
  let max = values[0] as number;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

/**
 * Put a value between 0 and 1.
 *
 * The value that is the best of the set gets 1, the worst gets 0. When all
 * the values are the same, the ones that have a value get 1: there is
 * nothing to compare them with.
 */
export function rescale(value: number, range: { min: number; max: number } | null): number {
  if (!range) return 0;
  if (range.max <= range.min) return 1;
  return (value - range.min) / (range.max - range.min);
}

/**
 * The score of every candidate: the blend of the words and the meaning.
 *
 * The bm25 score is negative and the smaller it is, the better the match,
 * so it is turned around. The distance is smaller when the match is better,
 * so it is turned around as well.
 *
 * @param candidates The candidates of the search.
 * @param meaningWeight The weight of the meaning, 0 to 1.
 * @returns the score of every candidate, by title id.
 */
export function blendCandidates(
  candidates: Candidate[],
  meaningWeight: number,
): Map<string, number> {
  const weight = Math.min(1, Math.max(0, meaningWeight));

  const wordValues: number[] = [];
  const distanceValues: number[] = [];
  for (const candidate of candidates) {
    if (candidate.words !== null) wordValues.push(-candidate.words);
    if (candidate.distance !== null) distanceValues.push(-candidate.distance);
  }

  const wordRange = bounds(wordValues);
  const distanceRange = bounds(distanceValues);

  const scores = new Map<string, number>();
  for (const candidate of candidates) {
    const words = candidate.words === null ? 0 : rescale(-candidate.words, wordRange);
    const meaning =
      candidate.distance === null ? 0 : rescale(-candidate.distance, distanceRange);
    scores.set(candidate.title_id, weight * meaning + (1 - weight) * words);
  }

  return scores;
}

/**
 * The candidates of a search: the titles that match the words and the
 * titles that have a vector.
 *
 * The candidates are the **union** of the two: a title that was found by
 * one side only gets 0 for the other, and a query that matches no word at
 * all is answered by the meaning alone.
 *
 * @param expression The FTS5 expression, or null when there are no words.
 * @param meaning The meaning of the query, or null when there is none.
 */
export function collectCandidates(
  db: Db,
  filter: { where: string; params: unknown[] },
  expression: string | null,
  meaning: MeaningQuery | null,
): Candidate[] {
  const candidates = new Map<string, Candidate>();

  if (expression !== null) {
    for (const row of db.all<{ title_id: string; score: number }>(
      `SELECT t.title_id AS title_id, bm25(titles_fts, 0, 3.0, 1.5, 1.0) AS score
         FROM titles t
         JOIN titles_fts f ON f.rowid = t.rowid
        WHERE titles_fts MATCH ? AND ${filter.where}`,
      expression,
      ...filter.params,
    )) {
      candidates.set(row.title_id, {
        title_id: row.title_id,
        words: row.score,
        distance: null,
      });
    }
  }

  if (meaning && db.hasVectors && vectorsTableExists(db)) {
    for (const row of db.all<{ title_id: string; distance: number }>(
      `SELECT t.title_id AS title_id, vec_distance_cosine(v.embedding, ?) AS distance
         FROM titles t
         JOIN vec.vectors v ON v.text_hash = t.text_hash AND v.model = ?
        WHERE ${filter.where}`,
      toBlob(meaning.vector),
      meaning.model,
      ...filter.params,
    )) {
      const candidate = candidates.get(row.title_id) ?? {
        title_id: row.title_id,
        words: null,
        distance: null,
      };
      candidate.distance = row.distance;
      candidates.set(row.title_id, candidate);
    }
  }

  return [...candidates.values()];
}
