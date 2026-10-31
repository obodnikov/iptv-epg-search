/**
 * search.ts - the search of the guide, on the words alone.
 *
 * The pipeline of the design (iptv-mcp-servers.md §7.1), without the
 * meaning of phase T4:
 *
 * 1. the filters are applied in SQL and produce the candidates;
 * 2. the words are matched in the keyword index, which holds the stemmed
 *    text (FTS5 has no Russian stemmer);
 * 3. the repeats are collapsed: the copies of one programme on one channel
 *    family keep the airing nearest to now (`hide_repeats`), and of the
 *    copies at the same moment the best quality stays (`prefer_hd`); both
 *    re-implement the web app's `filterUniqueByClosestTime` and
 *    `filterPreferHD` (`public/scripts/utils/search.js`) on epoch seconds;
 * 4. the result is sorted, cut to a page and returned with a cursor.
 *
 * The collapse runs before the page is cut, so that `total` counts the
 * programmes the collapse left. It is written as window functions in SQL:
 * the candidate set of a search without words can be the whole guide, and
 * dragging it through JavaScript would be wasted memory.
 */

import { type Db } from '../shared/db.ts';
import {
  countriesOfTexts,
  programRowsForPairs,
  type CandidateRow,
} from './queries.ts';
import { buildItem, type ItemOptions, type ListItem } from './items.ts';
import { buildMatchExpression, orderClause } from './words.ts';

/** The order a search may ask for. */
export type SortOrder = 'relevance' | 'time' | 'channel';

/** How the result was found, as the answer names it. */
export type SearchMode = 'words' | 'filters';

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
}

/** What a search found. */
export interface SearchOutcome {
  total: number;
  items: ListItem[];
  usedWords: boolean;
  mode: SearchMode;
}

/**
 * The signature of a search.
 *
 * Two searches with the same signature have the same result, so the cursor
 * of one of them fits the other. The parts are the raw inputs: the window
 * is derived from them and from the moment the cursor carries.
 */
export function searchSignature(parts: {
  query: string;
  keywords: string[];
  person: string;
  kinds: string[];
  period: string | null;
  from: string | null;
  to: string | null;
  themes: string[];
  regions: string[];
  channels: string[];
  productionCountries: string[];
  yearFrom: number | null;
  yearTo: number | null;
  onlyCatchup: boolean;
  hideRepeats: boolean;
  preferHd: boolean;
  sort: SortOrder;
  timezone: string;
  tonightFromHour: number;
}): string {
  return JSON.stringify([
    parts.query.trim(),
    [...parts.keywords].map((keyword) => keyword.trim()).sort(),
    parts.person.trim(),
    [...parts.kinds].sort(),
    parts.period,
    parts.from,
    parts.to,
    [...parts.themes].sort(),
    [...parts.regions].map((region) => region.trim().toLowerCase()).sort(),
    [...parts.channels].map((channel) => channel.trim().toLowerCase()).sort(),
    [...parts.productionCountries]
      .map((country) => country.trim().toLowerCase())
      .sort(),
    parts.yearFrom,
    parts.yearTo,
    parts.onlyCatchup,
    parts.hideRepeats,
    parts.preferHd,
    parts.sort,
    parts.timezone,
    parts.tonightFromHour,
  ]);
}

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
 * The candidate SQL: the filters, the words and the collapse.
 */
function candidateSql(
  request: SearchRequest,
  options: SearchOptions,
  expression: string | null,
): { sql: string; countSql: string; params: unknown[]; countParams: unknown[] } {
  const { conditions, params } = filterConditions(request, options);
  const usedWords = expression !== null;

  const whereSql = usedWords
    ? `program_texts_fts MATCH ? AND ${conditions.join(' AND ')}`
    : conditions.join(' AND ');

  const fromSql = `FROM programmes p
    JOIN channels c ON c.channel_id = p.channel_id
    JOIN program_texts t ON t.text_hash = p.text_hash
    ${usedWords ? 'JOIN program_texts_fts f ON f.text_hash = t.text_hash' : ''}`;

  const candidateParams = usedWords ? [expression, ...params] : params;

  const columns = `p.channel_id AS channel_id, p.start_utc AS start_utc,
      p.stop_utc AS stop_utc, t.text_hash AS text_hash,
      t.title_norm AS title_norm, c.family_key AS family_key,
      c.quality AS quality, c.name AS channel_name,
      ${usedWords ? 'bm25(program_texts_fts, 0, 3.0, 1.5, 1.0)' : 'NULL'} AS score`;

  // Without the collapse the candidates are the result.
  if (!request.hideRepeats && !request.preferHd) {
    return {
      sql: `SELECT ${columns}, count(*) OVER () AS total ${fromSql} WHERE ${whereSql}`,
      countSql: `SELECT count(*) AS found ${fromSql} WHERE ${whereSql}`,
      params: candidateParams,
      countParams: candidateParams,
    };
  }

  // The collapse of `prefer_hd` runs first: of the copies of one title in
  // one channel family at one moment, the best quality stays (the web app
  // applies the two in the same order). The family is part of the
  // partition: two different channels that air the same title at the same
  // moment are not copies of one another, and `hide_repeats` would keep
  // both. Then `hide_repeats` keeps the airing of one title and channel
  // family that is nearest to now. Each of the two runs only when it is
  // asked for: a search with the repeats visible must not lose them.
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

  if (!request.hideRepeats) {
    const sql = `WITH cand AS (
  SELECT ${columns} ${fromSql} WHERE ${whereSql}
)${hd}
SELECT channel_id, start_utc, stop_utc, text_hash, title_norm, family_key,
       quality, channel_name, score, count(*) OVER () AS total
  FROM ${hdFrom} ${hdWhere}`;

    const countSql = `WITH cand AS (
  SELECT ${columns} ${fromSql} WHERE ${whereSql}
)${hd}
SELECT count(*) AS found FROM ${hdFrom} ${hdWhere}`;

    return {
      sql,
      countSql,
      params: candidateParams,
      countParams: candidateParams,
    };
  }

  const uniSql = `, uni AS (
        SELECT ${hdFrom}.*,
               ROW_NUMBER() OVER (
                 PARTITION BY title_norm, family_key
                 ORDER BY abs(start_utc - ?), start_utc ASC, channel_id ASC
               ) AS uni_rn
          FROM ${hdFrom} ${hdWhere}
      )`;

  const sql = `WITH cand AS (
  SELECT ${columns} ${fromSql} WHERE ${whereSql}
)${hd}${uniSql}
SELECT channel_id, start_utc, stop_utc, text_hash, title_norm, family_key,
       quality, channel_name, score, count(*) OVER () AS total
  FROM uni WHERE uni_rn = 1`;

  const countSql = `WITH cand AS (
  SELECT ${columns} ${fromSql} WHERE ${whereSql}
)${hd}${uniSql}
SELECT count(*) AS found FROM uni WHERE uni_rn = 1`;

  return {
    sql,
    countSql,
    params: [...candidateParams, options.now],
    countParams: [...candidateParams, options.now],
  };
}

/**
 * The cursor of a search.
 *
 * It is base64url of a small JSON object, the way the shared cursor is
 * (`shared/tool-kit.ts`), with one field more: the moment the search ran
 * at. A page is read minutes after the first call, and the window, the
 * collapse and the statuses all move with the moment - a page of a search
 * is only consistent when the whole search keeps the moment it started
 * with.
 */
export interface SearchCursor {
  offset: number;
  signature: string;
  /** The frozen moment of the search, in epoch seconds. */
  now: number;
}

/**
 * Encode a search cursor.
 */
export function encodeSearchCursor(cursor: SearchCursor): string {
  const json = JSON.stringify({ o: cursor.offset, s: cursor.signature, n: cursor.now });
  return Buffer.from(json, 'utf8').toString('base64url');
}

/**
 * Decode a search cursor.
 *
 * @returns the cursor, or null when the text is not one.
 */
export function decodeSearchCursor(text: string): SearchCursor | null {
  if (!text) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const value = parsed as { o?: unknown; s?: unknown; n?: unknown };

  const offset = typeof value.o === 'number' && Number.isInteger(value.o) && value.o >= 0
    ? value.o
    : null;
  const signature = typeof value.s === 'string' ? value.s : null;
  const now = typeof value.n === 'number' && Number.isFinite(value.n) ? value.n : null;
  if (offset === null || signature === null || now === null) return null;

  return { offset, signature, now };
}

/**
 * Search the guide.
 *
 * The words are matched in the keyword index; the filters are applied in
 * SQL; the collapse of the repeats runs before the page is cut.
 */
export function searchPrograms(
  db: Db,
  request: SearchRequest,
  options: SearchOptions,
  limit: number,
  offset: number,
): SearchOutcome {
  const expression = buildMatchExpression(request.query, request.keywords, request.person);
  const usedWords = expression !== null;

  // A window that ends before now is read backwards: the newest first. The
  // catch-up of yesterday evening is read the other way round than the
  // programme of this evening.
  const past = request.window.to !== null && request.window.to <= options.now;
  const order = orderClause(request.sort, usedWords, past);

  const { sql, countSql, params, countParams } = candidateSql(
    request,
    options,
    expression,
  );

  // The count rides on the page: `count(*) OVER ()` costs one window pass
  // instead of two (the collapse of a whole guide is the most expensive
  // thing a search can ask for). A page past the end comes back without
  // rows, and the count is read on its own then.
  const rows = db.all<CandidateRow & { total?: number }>(
    `${sql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset,
  );

  let total = rows[0]?.total ?? null;
  if (total === null) {
    if (rows.length === 0 && offset > 0) {
      total = db.get<{ found: number }>(countSql, ...countParams)?.found ?? 0;
    } else {
      total = 0;
    }
  }
  if (total === 0) {
    return { total: 0, items: [], usedWords, mode: usedWords ? 'words' : 'filters' };
  }

  const itemOptions: ItemOptions = {
    now: options.now,
    timezone: options.timezone,
    snippetChars: options.snippetChars,
  };

  const hashes = [...new Set(rows.map((row) => row.text_hash))];
  const countries = countriesOfTexts(db, hashes);

  // The full rows of the page, in one query.
  const full = programRowsForPairs(
    db,
    rows.map((row) => ({ channel_id: row.channel_id, start_utc: row.start_utc })),
  );

  const items: ListItem[] = [];
  for (const row of rows) {
    const fullRow = full.get(`${row.channel_id}@${row.start_utc}`);
    if (!fullRow) continue;
    const score =
      row.score === null ? 0 : Math.round(-row.score * 1e6) / 1e6;
    items.push(buildItem(fullRow, itemOptions, countries.get(row.text_hash), score));
  }

  return { total, items, usedWords, mode: usedWords ? 'words' : 'filters' };
}
