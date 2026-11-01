/**
 * search.ts - the search of the guide.
 *
 * The pipeline of the design (iptv-mcp-servers.md §7.1):
 *
 * 1. the filters are applied in SQL and produce the candidates
 *    (`candidates.ts`);
 * 2. the words are matched in the keyword index, which holds the stemmed
 *    text (FTS5 has no Russian stemmer);
 * 3. the meaning of the query is compared with the vector of every
 *    candidate's text (`search-meaning.ts`, phase T4) — only when the
 *    order is `relevance` and the query has words. That path merges its
 *    two sources and collapses the repeats in JavaScript (bm25 cannot be
 *    aggregated in SQL, so the merge lives there; see the header of
 *    `search-meaning.ts`);
 * 4. the blend of the two scores sorts the meaning path
 *    (`shared/blend.ts`);
 * 5. on the words-only path the repeats are collapsed in SQL
 *    (`collapseOverUnion`): the copies of one programme on one channel
 *    family keep the airing nearest to now (`hide_repeats`), and of the
 *    copies at the same moment the best quality stays (`prefer_hd`); both
 *    re-implement the web app's `filterUniqueByClosestTime` and
 *    `filterPreferHD` (`public/scripts/utils/search.js`) on epoch
 *    seconds. The collapse runs before the page is cut, so that `total`
 *    counts the programmes the collapse left.
 *
 * Without vectors — the key missing, the embeddings off, the vectors of
 * the model still being built — the search runs on the words alone and
 * says so (`search_mode`).
 */

import { type Db } from '../shared/db.ts';
import {
  countriesOfTexts,
  programRowsForPairs,
  type CandidateRow,
} from './queries.ts';
import { buildItem, type ItemOptions, type ListItem } from './items.ts';
import { searchWithMeaning, meaningUsable } from './search-meaning.ts';
import { candidateSql, collapseOverUnion } from './candidates.ts';
import type {
  SearchMode,
  SearchOptions,
  SearchOutcome,
  SearchRequest,
  SortOrder,
} from './search-types.ts';
import { buildMatchExpression, orderClause } from './words.ts';

export type {
  SearchMode,
  SearchOptions,
  SearchOutcome,
  SearchRequest,
  SortOrder,
} from './search-types.ts';

/**
 * The signature of a search.
 *
 * Two searches with the same signature have the same result, so the cursor
 * of one of them fits the other. The parts are the raw inputs: the window
 * is derived from them and from the moment the cursor carries. The model
 * of the vectors is part of it: the vectors of two models are never
 * compared, so a page of a search does not mix two models.
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
}, meaningModel = ''): string {
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
    meaningModel,
  ]);
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
 * The words are matched in the keyword index, the meaning in the vectors;
 * the filters are applied in SQL; the collapse of the repeats runs before
 * the page is cut.
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

  // The meaning of the query: it is only used when the result is ordered
  // by relevance and the query has words. A guide without vectors for the
  // model answers null from the meaning search, and the words answer.
  const meaning = meaningUsable(db, request, options.meaning) ? options.meaning : null;
  if (meaning) {
    const found = searchWithMeaning(
      db,
      request,
      options,
      expression,
      meaning,
      limit,
      offset,
    );
    if (found) return found;
  }

  // A window that ends before now is read backwards: the newest first. The
  // catch-up of yesterday evening is read the other way round than the
  // programme of this evening.
  const past = request.window.to !== null && request.window.to <= options.now;
  const order = orderClause(request.sort, usedWords, past);

  // The one implementation of the collapse lives in `collapseOverUnion`;
  // the words-only path runs through it in both shapes, with the collapse
  // and without it. The count rides on the page: `count(*) OVER ()` sits
  // over the candidates and costs one window pass instead of two (inside
  // the candidates it would break the bm25 context). A page past the end
  // comes back without rows, and the plain count is read on its own then.
  const source = candidateSql(request, options, { kind: 'words', expression });
  const shape = request.hideRepeats || request.preferHd ? 'window' : 'plain';
  const collapse = collapseOverUnion(request, options, [{ sql: source.sql, params: source.params }], shape);
  const sql = collapse.sql;
  const params = collapse.params;
  // The window shape carries the count on the page; the plain shape has
  // no window total next to bm25 and reads the count on its own, always.
  // The plain shape is built without the collapse, so its parameters are
  // the source's own — the collapse shape appends `now`, and its count
  // binds them with it.
  const plain = collapseOverUnion(request, options, [{ sql: source.sql, params: source.params }], 'plain');
  const countSql = plain.countSql;
  const countParams = plain.countParams;

  const rows = db.all<CandidateRow & { total?: number }>(
    `${sql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset,
  );

  // With the collapse the count rides on the page; without it, the plain
  // count query answers. A page past the end of the collapsed result has
  // no rows to carry the count, and the count query answers for it too.
  // The window shape carries the count on the page; the plain shape (no
  // collapse asked for) has no window total next to bm25 and reads the
  // count on its own.
  let total: number | null = rows[0]?.total ?? null;
  if (total === null) {
    total = db.get<{ found: number }>(countSql, ...countParams)?.found ?? 0;
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
