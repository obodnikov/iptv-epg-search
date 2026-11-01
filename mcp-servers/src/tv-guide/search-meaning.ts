/**
 * search-meaning.ts - the search of the guide with the meaning of the
 * query.
 *
 * The pipeline of the design (iptv-mcp-servers.md §7.1), as T4 runs it:
 *
 * 1. the candidates are the union of the programmes that match the words
 *    and the programmes whose text has a vector, both inside the filters.
 *    The two sides are read from one snapshot (a refresh must not tear
 *    the union);
 * 2. the two sides are **merged in JavaScript**: a programme that both
 *    sides found is one candidate with both scores. The merge cannot live
 *    in SQL — bm25() loses its FTS context under any aggregation, so a
 *    union with a GROUP BY would refuse to run;
 * 3. the collapse of the repeats runs over the merged set, **in
 *    JavaScript**, with the same partitions and tie-breaks as the SQL of
 *    the words-only path (`collapseOverUnion` in candidates.ts): on a
 *    subset it would keep a different airing than the full set does, and
 *    the answer would hold the copies of one title (the first review of
 *    T4) — and after the merge, not before it, or one of the two scores
 *    would be lost (the second review);
 * 4. both scores are rescaled to 0–1 inside the candidate set and mixed
 *    with the weight of the settings (`shared/blend.ts`);
 * 5. the page is cut in JavaScript: the blend is not an SQL value.
 *
 * The meaning is only used when the order is `relevance` and the query has
 * words. When no candidate has a vector — a guide without vectors, or a
 * model without any — the search falls back to the words and says so.
 */

import { type Db, withSnapshot } from '../shared/db.ts';
import { blendScores } from '../shared/blend.ts';
import type { MeaningQuery } from '../shared/blend.ts';
import { vectorsTableExists } from '../shared/vectors.ts';
import { candidateSql } from './candidates.ts';
import { buildItem, type ItemOptions, type ListItem } from './items.ts';
import { countriesOfTexts, programRowsForPairs, type CandidateRow } from './queries.ts';
import type { SearchOptions, SearchOutcome, SearchRequest } from './search-types.ts';

/** The outcome of the meaning search, when it ran. */
export type MeaningOutcome = SearchOutcome & { mode: 'words+meaning' };

/**
 * True when the vectors database holds at least one vector of the model.
 *
 * The handler asks before embedding the query: a guide whose vectors are
 * still being built must not pay for a call the search cannot use (the
 * search falls back to the words until the vectors arrive).
 */
export function vectorsReady(db: Db, model: string): boolean {
  if (!db.hasVectors || !vectorsTableExists(db)) return false;
  const row = db.get<{ found: number }>(
    'SELECT 1 AS found FROM vec.vectors WHERE model = ? LIMIT 1',
    model,
  );
  return row !== undefined;
}

/**
 * True when the search may use the meaning at all.
 *
 * The meaning needs a query with words, the order `relevance`, and a
 * vectors file that is attached and holds the tables.
 */
export function meaningUsable(
  db: Db,
  request: SearchRequest,
  meaning: MeaningQuery | null | undefined,
): meaning is MeaningQuery {
  if (!meaning) return false;
  if (request.sort !== 'relevance') return false;
  if (request.query.trim().length === 0) return false;
  return db.hasVectors && vectorsTableExists(db);
}

/**
 * One candidate of the union, with both scores.
 */
interface UnionCandidate {
  row: CandidateRow;
  /** The bm25 score of the programme; null when it matched no word. */
  words: number | null;
  /** The distance of its text to the query; null when it has no vector. */
  distance: number | null;
}

/**
 * The key of a candidate: the programme.
 */
function keyOf(row: Pick<CandidateRow, 'channel_id' | 'start_utc'>): string {
  return `${row.channel_id}@${row.start_utc}`;
}

/**
 * The lowercase of a name, for the tie-breaks.
 *
 * The SQL of the words-only path compares the channel names with
 * COLLATE NOCASE, which folds the case; the JavaScript collapse of the
 * meaning path folds the same way, so that both paths keep the same row
 * when the qualities are equal.
 */
function lower(name: string): string {
  return name.toLowerCase();
}

/**
 * Search the guide with the words and the meaning.
 *
 * The two sources run **without** the collapse and are united in one
 * SQL, and the collapse runs over the union, once: on a subset it would
 * keep a different airing than the full set does, and the union would put
 * the copies back (the bug the review of T4 caught). The programmes that
 * both sources found are one candidate with both scores.
 *
 * @returns the outcome, or null when the meaning found nothing — the
 *   caller then runs the words-only search and says so.
 */
export function searchWithMeaning(
  db: Db,
  request: SearchRequest,
  options: SearchOptions,
  expression: string | null,
  meaning: MeaningQuery,
  limit: number,
  offset: number,
): MeaningOutcome | null {
  // The two sources run **without** the collapse. They are merged in
  // JavaScript — the scores cannot be merged in SQL (bm25 loses its FTS
  // context under any aggregation) — and the collapse of the repeats runs
  // over the merged set, once: on a subset it would keep a different
  // airing than the full set does, and the answer would hold the copies
  // of one title (the bug the review of T4 caught).
  const sourceRequest = { ...request, hideRepeats: false, preferHd: false };
  const candidates = new Map<string, UnionCandidate>();

  // The two source queries read one snapshot: a refresh that commits
  // between them must not tear the union (a programme on one side only,
  // or a count that names a programme the rows have lost). The words-only
  // path reads one query and needs no snapshot.
  withSnapshot(db, () => {
    if (expression !== null) {
      const words = candidateSql(sourceRequest, options, { kind: 'words', expression });
      for (const row of db.all<CandidateRow>(words.sql, ...words.params)) {
        candidates.set(keyOf(row), {
          row,
          words: row.score,
          distance: null,
        });
      }
    }
    {
      const vectors = candidateSql(sourceRequest, options, { kind: 'vectors', meaning });
      for (const row of db.all<CandidateRow>(vectors.sql, ...vectors.params)) {
        const key = keyOf(row);
        const known = candidates.get(key);
        if (known) known.distance = row.distance;
        else candidates.set(key, { row, words: null, distance: row.distance });
      }
    }
  });

  // The collapse of the repeats, in the order of the web app and of the
  // SQL of the words-only path: the best quality of the copies at one
  // moment first, then the airing nearest to now of one title and channel
  // family. Each runs only when it is asked for.
  let survivors = [...candidates.values()];
  if (request.preferHd) {
    const best = new Map<string, UnionCandidate>();
    for (const candidate of survivors) {
      const key = [
        candidate.row.title_norm,
        candidate.row.family_key,
        candidate.row.start_utc,
      ].join('\u0000');
      const kept = best.get(key);
      if (
        !kept ||
        candidate.row.quality > kept.row.quality ||
        (candidate.row.quality === kept.row.quality &&
          (lower(candidate.row.channel_name) < lower(kept.row.channel_name) ||
            (lower(candidate.row.channel_name) === lower(kept.row.channel_name) &&
              candidate.row.channel_id < kept.row.channel_id)))
      ) {
        best.set(key, candidate);
      }
    }
    survivors = [...best.values()];
  }
  if (request.hideRepeats) {
    const best = new Map<string, UnionCandidate>();
    for (const candidate of survivors) {
      const key = [candidate.row.title_norm, candidate.row.family_key].join('\u0000');
      const kept = best.get(key);
      if (!kept) {
        best.set(key, candidate);
        continue;
      }
      const distance = Math.abs(candidate.row.start_utc - options.now);
      const keptDistance = Math.abs(kept.row.start_utc - options.now);
      if (
        distance < keptDistance ||
        (distance === keptDistance &&
          (candidate.row.start_utc < kept.row.start_utc ||
            (candidate.row.start_utc === kept.row.start_utc &&
              candidate.row.channel_id < kept.row.channel_id)))
      ) {
        best.set(key, candidate);
      }
    }
    survivors = [...best.values()];
  }

  // The meaning is only used when it found something: a guide without
  // vectors for the model is searched by the words alone, and the answer
  // says so.
  const hasDistances = [...candidates.values()].some(
    (candidate) => candidate.distance !== null,
  );
  if (!hasDistances) return null;

  const scores = blendScores(
    survivors.map((candidate) => ({
      key: keyOf(candidate.row),
      words: candidate.words,
      distance: candidate.distance,
    })),
    options.meaningWeight ?? 0.7,
  );

  // The order is total: the channel and the start break a tie, so that a
  // page does not miss a programme.
  const page = survivors
    .sort((left, right) => {
      const leftScore = scores.get(keyOf(left.row)) ?? 0;
      const rightScore = scores.get(keyOf(right.row)) ?? 0;
      if (rightScore !== leftScore) return rightScore - leftScore;
      if (left.row.channel_id !== right.row.channel_id) {
        return left.row.channel_id < right.row.channel_id ? -1 : 1;
      }
      return left.row.start_utc - right.row.start_utc;
    })
    .slice(offset, offset + limit);

  const total = survivors.length;

  const itemOptions: ItemOptions = {
    now: options.now,
    timezone: options.timezone,
    snippetChars: options.snippetChars,
  };

  const hashes = [...new Set(page.map((candidate) => candidate.row.text_hash))];
  const countries = countriesOfTexts(db, hashes);

  // The full rows of the page, in one query.
  const full = programRowsForPairs(
    db,
    page.map((candidate) => ({
      channel_id: candidate.row.channel_id,
      start_utc: candidate.row.start_utc,
    })),
  );

  const items: ListItem[] = [];
  for (const candidate of page) {
    const fullRow = full.get(keyOf(candidate.row));
    if (!fullRow) continue;
    items.push(
      buildItem(
        fullRow,
        itemOptions,
        countries.get(candidate.row.text_hash),
        Math.round((scores.get(keyOf(candidate.row)) ?? 0) * 1e6) / 1e6,
      ),
    );
  }

  return { total, items, usedWords: expression !== null, mode: 'words+meaning' };
}
