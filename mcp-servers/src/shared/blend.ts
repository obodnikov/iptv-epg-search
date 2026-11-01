/**
 * blend.ts - the arithmetic that mixes the words and the meaning.
 *
 * The side of the search that knows the meaning (design:
 * iptv-mcp-servers.md §7.1 steps 3 and 4):
 *
 * - every candidate has a word score (bm25, negative, the smaller the
 *   better) and a distance to the query (cosine, the smaller the better);
 *   a candidate that was found by one side only has nothing for the other;
 * - both scores are rescaled to 0-1 inside the candidate set and mixed:
 *   `score = meaningWeight * meaning + (1 - meaningWeight) * words`.
 *
 * The arithmetic knows nothing about titles or programmes: the key of a
 * candidate is whatever the server uses (`title_id` in the cinema, the
 * pair of channel and start in the guide). The candidates themselves are
 * collected by each server (`src/cinema/blend.ts`, the search of the
 * guide), because the SQL of the two differs.
 *
 * The module was in the cinema server until phase T4; the guide needed
 * the same mix, and the move is part of the phase (iptv-mcp-servers.md
 * §4.3).
 */

/**
 * The meaning of a query: the vector of the query and its model.
 *
 * The vectors of two models are never compared (design:
 * iptv-mcp-servers.md §6.2), so the model rides next to the vector.
 */
export interface MeaningQuery {
  /** The vector of the query. */
  vector: Float32Array;
  /** The model the vector was made for. */
  model: string;
}

/**
 * One candidate of a search, as the mix sees it.
 */
export interface ScoredCandidate<K> {
  /** Whatever identifies the candidate inside this search. */
  key: K;
  /** The bm25 score of the candidate; null when it matched no word. */
  words: number | null;
  /** The distance to the query; null when the candidate has no vector. */
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
export function rescale(
  value: number,
  range: { min: number; max: number } | null,
): number {
  if (!range) return 0;
  if (range.max <= range.min) return 1;
  return (value - range.min) / (range.max - range.min);
}

/**
 * The score of every candidate: the blend of the words and the meaning.
 *
 * The bm25 score is negative and the smaller it is, the better the match,
 * so it is turned around. The distance is smaller when the match is better,
 * so it is turned around as well. A candidate that was found by one side
 * only gets 0 for the other.
 *
 * @param candidates The candidates of the search.
 * @param meaningWeight The weight of the meaning, 0 to 1.
 * @returns the score of every candidate, by its key.
 */
export function blendScores<K>(
  candidates: ScoredCandidate<K>[],
  meaningWeight: number,
): Map<K, number> {
  const weight = Math.min(1, Math.max(0, meaningWeight));

  const wordValues: number[] = [];
  const distanceValues: number[] = [];
  for (const candidate of candidates) {
    if (candidate.words !== null) wordValues.push(-candidate.words);
    if (candidate.distance !== null) distanceValues.push(-candidate.distance);
  }

  const wordRange = bounds(wordValues);
  const distanceRange = bounds(distanceValues);

  const scores = new Map<K, number>();
  for (const candidate of candidates) {
    const words =
      candidate.words === null ? 0 : rescale(-candidate.words, wordRange);
    const meaning =
      candidate.distance === null ? 0 : rescale(-candidate.distance, distanceRange);
    scores.set(candidate.key, weight * meaning + (1 - weight) * words);
  }

  return scores;
}
