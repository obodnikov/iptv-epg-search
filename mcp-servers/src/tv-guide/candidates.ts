/**
 * candidates.ts - the SQL that produces the candidates of a search.
 *
 * The pipeline of the design (iptv-mcp-servers.md §7.1): the filters are
 * applied in SQL and produce the candidate set. The set is asked for from
 * one of two sources:
 *
 * - **words** — the programmes that match the keyword index, with their
 *   bm25 score (negative: the smaller, the better the match);
 * - **vectors** — the programmes whose text has a vector for the model of
 *   the settings, with their cosine distance to the query.
 *
 * The repeats are collapsed in the same SQL (window functions), whichever
 * the source: the collapse partitions by title, channel family and moment
 * and never looks at the score, so the two sources collapse into the same
 * rows and the union of the two is a union of programmes, not of rows
 * (design: tv-guide-server.md §7.1, the decisions of T3).
 *
 * The meaning search (`search-meaning.ts`) asks for both sources and
 * mixes the scores; the words-only search (`search.ts`) asks for the
 * first and counts in the same pass.
 */

import { toBlob } from '../shared/vectors.ts';
import type { MeaningQuery } from '../shared/blend.ts';
import type { CandidateRow } from './queries.ts';
import type { SearchOptions, SearchRequest } from './search-types.ts';

/** Where the candidates come from. */
export type CandidateSource =
  | { kind: 'words'; expression: string | null }
  | { kind: 'vectors'; meaning: MeaningQuery };

/**
 * The SQL of the filters of a search.
 */
function filterConditions(
  request: SearchRequest,
  options: SearchOptions,
): { conditions: string[]; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (!options.includeAdult) {
    conditions.push('c.is_adult = 0');
  }

  // The window of the time. A period that reaches into the present also
  // takes the programme that is on air right now; `tonight` floors that
  // clause at the evening hour (`onAirFrom`), so that the marathon of the
  // afternoon does not become an evening programme.
  const window = request.window;
  if (window.onAir) {
    const floor = window.onAirFrom ?? 0;

    conditions.push(
      '((p.start_utc <= ? AND p.stop_utc > ? AND p.start_utc >= ?) OR (p.start_utc >= ? AND p.start_utc < ?))',
    );
    params.push(
      options.now,
      options.now,
      floor,
      window.from ?? options.now,
      window.to ?? options.now,
    );
  } else {
    if (window.field === 'start') {
      if (window.from !== null) {
        conditions.push('p.start_utc >= ?');
        params.push(window.from);
      }
      if (window.to !== null) {
        conditions.push('p.start_utc < ?');
        params.push(window.to);
      }
    } else {
      if (window.from !== null) {
        conditions.push('p.stop_utc >= ?');
        params.push(window.from);
      }
      if (window.to !== null) {
        conditions.push('p.stop_utc < ?');
        params.push(window.to);
      }
    }
  }

  if (request.kinds.length > 0) {
    conditions.push(`t.kind IN (${request.kinds.map(() => '?').join(', ')})`);
    params.push(...request.kinds);
  }

  if (request.themes.length > 0) {
    conditions.push(`c.theme IN (${request.themes.map(() => '?').join(', ')})`);
    params.push(...request.themes);
  }

  if (request.regions.length > 0) {
    const values = [...request.regions];
    conditions.push(`upper(c.region) IN (${values.map(() => 'upper(?)').join(', ')})`);
    params.push(...values);
  }

  if (request.channelIds.length > 0) {
    conditions.push(`c.channel_id IN (${request.channelIds.map(() => '?').join(', ')})`);
    params.push(...request.channelIds);
  }

  const countries = request.productionCountries;
  if (countries.codes.length > 0 || countries.raws.length > 0) {
    const parts: string[] = [];
    if (countries.codes.length > 0) {
      parts.push(`tc.code IN (${countries.codes.map(() => '?').join(', ')})`);
      params.push(...countries.codes);
    }
    if (countries.raws.length > 0) {
      const lowered = countries.raws.map((raw) => raw.toLowerCase());
      parts.push(`lower(tc.raw) IN (${lowered.map(() => '?').join(', ')})`);
      params.push(...lowered);
    }
    conditions.push(
      `EXISTS (SELECT 1 FROM text_countries tc
                WHERE tc.text_hash = t.text_hash AND (${parts.join(' OR ')}))`,
    );
  }

  if (request.yearFrom !== null) {
    conditions.push('t.year >= ?');
    params.push(request.yearFrom);
  }
  if (request.yearTo !== null) {
    conditions.push('t.year <= ?');
    params.push(request.yearTo);
  }

  if (request.onlyCatchup) {
    // The conditions of `catchupPossible`, as SQL (guide-links.ts).
    conditions.push(
      `c.stream_url IS NOT NULL AND c.archive_days > 0
        AND c.catchup_type = 'shift'
        AND p.stop_utc <= ?
        AND (? - p.start_utc) <= c.archive_days * 86400`,
    );
    params.push(options.now, options.now);
  }

  return { conditions, params };
}

/**
 * The WHERE clause of the filters, or nothing when there are none.
 *
 * A search without filters and without words is legal (the whole guide is
 * the candidate set), and a dangling `WHERE` would be a syntax error.
 */
function whereClause(conditions: string[]): string {
  return conditions.length === 0 ? '' : ` WHERE ${conditions.join(' AND ')}`;
}

/**
 * How the collapse reports its size.
 *
 * - `window` — the count rides on the page (`count(*) OVER ()` over the
 *   collapsed rows), and a plain count comes with the answer for a page
 *   behind the end;
 * - `plain` — the rows without a window count, with the plain count;
 * - `none` — the rows only.
 */
export type CollapseCount = 'window' | 'plain' | 'none';

/**
 * The collapse of the repeats over candidate selects.
 *
 * This is the one place the collapse SQL lives — the words-only path runs
 * through it too (the two copies of the window SQL had already drifted —
 * the review of T4).
 *
 * The meaning search does **not** run through this helper: its scores
 * cannot be merged in SQL, because bm25() loses its FTS context under any
 * aggregation, so it merges and collapses in JavaScript
 * (`search-meaning.ts`) — and its collapse keeps the same partitions and
 * tie-breaks as this one: the two are one contract (the review of T4
 * caught the drift of exactly this kind).
 *
 * The selects must produce the candidate columns in the same shape; their
 * parameters are joined in order, and the `now` of `hide_repeats` is
 * appended last.
 */
export function collapseOverUnion(
  request: SearchRequest,
  options: SearchOptions,
  selects: { sql: string; params: unknown[] }[],
  count: CollapseCount = 'none',
): { sql: string; params: unknown[]; countSql: string; countParams: unknown[] } {
  const hd = request.preferHd
    ? `, hd AS (
         SELECT cand.*,
                ROW_NUMBER() OVER (
                  PARTITION BY title_norm, family_key, start_utc
                  ORDER BY quality DESC, channel_name COLLATE NOCASE ASC,
                           channel_id ASC
                ) AS hd_rn
           FROM cand
       )`
    : '';
  const hdFrom = request.preferHd ? 'hd' : 'cand';
  const hdWhere = request.preferHd ? 'WHERE hd_rn = 1' : '';

  const uniSql = request.hideRepeats
    ? `, uni AS (
        SELECT ${hdFrom}.*,
               ROW_NUMBER() OVER (
                 PARTITION BY title_norm, family_key
                 ORDER BY abs(start_utc - ?), start_utc ASC, channel_id ASC
               ) AS uni_rn
          FROM ${hdFrom} ${hdWhere}
      )`
    : '';
  const from = request.hideRepeats ? 'uni' : hdFrom;
  const where = request.hideRepeats ? 'WHERE uni_rn = 1' : hdWhere;

  const params = [
    ...selects.flatMap((select) => select.params),
    ...(request.hideRepeats ? [options.now] : []),
  ];

  // The window count sits over the cand CTE, never inside it: a window
  // function next to bm25() breaks the FTS context, just like an
  // aggregation does. The plain count reads the collapsed rows once more;
  // it is meant for a page behind the end, which has no rows to carry the
  // window count.
  const cte = `WITH cand AS (
${selects.map((select) => select.sql).join('\nUNION ALL\n')}
)${hd}${uniSql}`;

  const rowSelect = `SELECT ${from}.*, ${from}.score AS score, ${from}.distance AS distance${
    count === 'window' ? ', count(*) OVER () AS total' : ''
  }
  FROM ${from} ${where}`;

  const countSelect = `SELECT count(*) AS found FROM ${from} ${where}`;

  const sql = `${cte}
${rowSelect}`;

  const countSql = `${cte}
${countSelect}`;

  return { sql, params, countSql, countParams: params };
}

/**
 * The candidate SQL: the source of the candidates and the collapse.
 *
 * The words source carries the count of the result in the same pass
 * (`count(*) OVER ()`); the vectors source does not: the meaning search
 * mixes two sources into one union, and the count of the union is the
 * number of the union's rows, not the count of a side.
 */
export function candidateSql(
  request: SearchRequest,
  options: SearchOptions,
  source: CandidateSource,
): { sql: string; countSql: string; params: unknown[]; countParams: unknown[] } {
  const { conditions, params } = filterConditions(request, options);
  const words = source.kind === 'words';
  const usedWords = words && source.expression !== null;

  // With words the MATCH is the first filter and the WHERE is always
  // there; without them the conditions alone make the clause, and it may
  // be empty (a search without filters is legal).
  const whereSql = usedWords
    ? ` WHERE program_texts_fts MATCH ?${conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : ''}`
    : whereClause(conditions);

  const fromSql = `FROM programmes p
    JOIN channels c ON c.channel_id = p.channel_id
    JOIN program_texts t ON t.text_hash = p.text_hash
    ${usedWords ? 'JOIN program_texts_fts f ON f.text_hash = t.text_hash' : ''}
    ${words ? '' : 'JOIN vec.vectors v ON v.text_hash = t.embed_hash AND v.model = ?'}`;

  // The score of the source: the bm25 of the words (negative, the smaller
  // the better), the distance of the vectors (the smaller the better), or
  // nothing when the words source has no words. The other column is NULL,
  // so that one union of the two sources carries both scores and the
  // collapse runs once over the union (the meaning search pairs them).
  const scoreSql = words
    ? usedWords
      ? 'bm25(program_texts_fts, 0, 3.0, 1.5, 1.0)'
      : 'NULL'
    : 'NULL';
  const distanceSql = words
    ? 'NULL'
    : 'vec_distance_cosine(v.embedding, ?)';

  // The parameters of the score stand in the SQL before the filters: the
  // columns of the candidate CTE are built first.
  const headParams = words
    ? usedWords
      ? [source.expression]
      : []
    : [toBlob(source.meaning.vector), source.meaning.model];

  const candidateParams = [...headParams, ...params];

  const columns = `p.channel_id AS channel_id, p.start_utc AS start_utc,
      p.stop_utc AS stop_utc, t.text_hash AS text_hash,
      t.title_norm AS title_norm, c.family_key AS family_key,
      c.quality AS quality, c.name AS channel_name,
      ${scoreSql} AS score, ${distanceSql} AS distance`;

  // The collapse is not built here: the one implementation of it is
  // `collapseOverUnion`, and the words-only search runs through it too
  // (the two copies of the window SQL had already drifted — the review of
  // T4; and bm25 cannot be aggregated, so the meaning search must merge
  // its scores in JavaScript and must not union through this helper).
  // The words-only search carries the count of the result on the page;
  // the vectors source has none — its count parameters would misbind.
  return {
    sql: `SELECT ${columns} ${fromSql}${whereSql}`,
    countSql: `SELECT count(*) AS found ${fromSql}${whereSql}`,
    params: candidateParams,
    countParams: candidateParams,
  };
}
