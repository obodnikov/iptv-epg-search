/**
 * words.ts - the words of a search.
 *
 * The side of the search that matches words (design: iptv-mcp-servers.md
 * §7.1 steps 2 and 5):
 *
 * - the FTS5 expression of a query, with the stemmed words;
 * - the order of the results, which is the bm25 when the words are used;
 * - the search itself, for the case that there are no vectors.
 *
 * The index of the design uses the weights `bm25(titles_fts, 0, 3.0, 1.5,
 * 1.0)`: the title weighs most, then the people, then the description. The
 * value of `bm25()` is negative and the smaller it is, the better the
 * match.
 */

import { type Db } from '../shared/db.ts';
import { stemText } from '../shared/text.ts';
import { buildFilter, type SortOrder } from './filters.ts';
import { buildItems, type TitleRow } from './items.ts';
import { type SearchOptions, type SearchRequest } from './search-types.ts';

/**
 * Quote a term for the FTS5 query language.
 */
function quoteTerm(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

/**
 * The stemmed words of a text.
 *
 * The index holds stemmed text, and the query is stemmed the same way
 * (design: iptv-mcp-servers.md §6.3).
 */
export function stemmedTerms(text: string): string[] {
  if (!text || !text.trim()) return [];
  return stemText(text).split(/\s+/).filter((term) => term.length > 0);
}

/**
 * Build the FTS5 expression of a search.
 *
 * The words of the query and the words of the keywords are alternatives:
 * a title that matches more of them ranks higher (bm25 counts every match).
 * The words of one keyword belong together, and the person is looked for in
 * the people and in the description of the title.
 *
 * @returns the expression, or null when there is nothing to look for.
 */
export function buildMatchExpression(
  query: string,
  keywords: string[],
  person: string,
): string | null {
  const parts: string[] = [];

  const queryTerms = stemmedTerms(query);
  if (queryTerms.length > 0) {
    parts.push(`(${queryTerms.map(quoteTerm).join(' OR ')})`);
  }

  for (const keyword of keywords) {
    const terms = stemmedTerms(keyword);
    if (terms.length === 0) continue;
    parts.push(`(${terms.map(quoteTerm).join(' AND ')})`);
  }

  const personTerms = stemmedTerms(person);
  if (personTerms.length > 0) {
    parts.push(`{people description} : (${personTerms.map(quoteTerm).join(' AND ')})`);
  }

  if (parts.length === 0) return null;
  return parts.join(' AND ');
}

/**
 * The order of the results, as SQL.
 *
 * Every order ends with the id of the title, so that the order is total and
 * a page does not miss a title.
 */
export function orderClause(sort: SortOrder, usedWords: boolean): string {
  switch (sort) {
    case 'relevance':
      // bm25() is negative and the smaller the value, the better the match.
      return usedWords
        ? 'score ASC, t.title_id ASC'
        : 't.added_at IS NULL ASC, t.added_at DESC, t.title_id ASC';
    case 'rating':
      return 't.rating IS NULL ASC, t.rating DESC, t.title_id ASC';
    case 'year_desc':
      return 't.year IS NULL ASC, t.year DESC, t.title_id ASC';
    case 'year_asc':
      return 't.year IS NULL ASC, t.year ASC, t.title_id ASC';
    case 'added':
      return 't.added_at IS NULL ASC, t.added_at DESC, t.title_id ASC';
    case 'title':
      return 't.title COLLATE NOCASE ASC, t.title_id ASC';
  }
}

/**
 * The search without the meaning: the words and the filters.
 *
 * The page is taken in SQL: the number of the titles and the page belong to
 * the same snapshot.
 */
export function searchWithWords(
  db: Db,
  request: SearchRequest,
  options: SearchOptions,
  expression: string | null,
  sort: SortOrder,
): {
  total: number;
  items: ReturnType<typeof buildItems>;
  usedWords: boolean;
} {
  const usedWords = expression !== null;
  const filter = buildFilter(request.filters, options.aliases, options.now);
  const order = orderClause(sort, usedWords);

  let total: number;
  if (usedWords) {
    const row = db.get<{ found: number }>(
      `SELECT count(*) AS found
         FROM titles t
         JOIN titles_fts f ON f.rowid = t.rowid
        WHERE titles_fts MATCH ? AND ${filter.where}`,
      expression,
      ...filter.params,
    );
    total = row?.found ?? 0;
  } else {
    const row = db.get<{ found: number }>(
      `SELECT count(*) AS found FROM titles t WHERE ${filter.where}`,
      ...filter.params,
    );
    total = row?.found ?? 0;
  }

  if (total === 0) {
    return { total: 0, items: [], usedWords };
  }

  const select = `SELECT t.title_id, t.type, t.title, t.year, t.rating, t.category,
                           t.director, t.description, t.duration_min, t.added_at,
                           t.season_count, t.episode_count,
                           ${usedWords ? 'bm25(titles_fts, 0, 3.0, 1.5, 1.0)' : 'NULL'} AS score
                      FROM titles t`;

  const rows = usedWords
    ? db.all<TitleRow>(
        `${select}
           JOIN titles_fts f ON f.rowid = t.rowid
          WHERE titles_fts MATCH ? AND ${filter.where}
          ORDER BY ${order}
          LIMIT ? OFFSET ?`,
        expression,
        ...filter.params,
        request.limit,
        request.offset,
      )
    : db.all<TitleRow>(
        `${select}
          WHERE ${filter.where}
          ORDER BY ${order}
          LIMIT ? OFFSET ?`,
        ...filter.params,
        request.limit,
        request.offset,
      );

  const items = buildItems(db, rows, options, (row) =>
    // The bm25 value is negative and the smaller it is, the better the
    // match: the score is turned around, so that a bigger score is a
    // better match.
    row.score === null ? 0 : Math.round(-row.score * 1e6) / 1e6,
  );

  return { total, items, usedWords };
}
