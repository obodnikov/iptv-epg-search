/**
 * blend.ts - the candidates of a search of the catalogue.
 *
 * The mix of the scores lives in the shared module (`src/shared/blend.ts`)
 * since phase T4, where the guide took the same mix. This module collects
 * the candidates (design: iptv-mcp-servers.md §7.1 steps 1 and 3):
 *
 * - the titles that match the words;
 * - the titles that have a vector, with their distance to the query.
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
