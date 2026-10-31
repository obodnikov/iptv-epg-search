/**
 * words.ts - the words of a search of the guide.
 *
 * The keyword index holds stemmed text (FTS5 has no Russian stemmer), and
 * the query is stemmed the same way (design: iptv-mcp-servers.md §6.3).
 * The helpers are a port of the cinema server's `src/cinema/words.ts`
 * (`stemmedTerms`, `buildMatchExpression`): the same stemmer, the same
 * quoting, the same shape of the expression.
 *
 * The index of the guide weighs its columns
 * `bm25(program_texts_fts, 0, 3.0, 1.5, 1.0)`: the title weighs most, then
 * the people, then the description. The value of `bm25()` is negative, and
 * the smaller it is, the better the match.
 */

import { stemText } from '../shared/text.ts';

/**
 * Quote one term for the FTS5 query language.
 */
function quoteTerm(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

/**
 * The stemmed words of a text, each quoted for FTS5.
 */
export function quoteTerms(text: string): string[] {
  if (!text || !text.trim()) return [];
  return stemText(text)
    .split(/\s+/)
    .filter((term) => term.length > 0)
    .map(quoteTerm);
}

/**
 * The stemmed words of a text, unquoted.
 */
export function stemmedTerms(text: string): string[] {
  if (!text || !text.trim()) return [];
  return stemText(text)
    .split(/\s+/)
    .filter((term) => term.length > 0);
}

/**
 * Build the FTS5 expression of a search.
 *
 * The words of the query and the words of the keywords are alternatives:
 * a text that matches more of them ranks higher (bm25 counts every
 * match). This is the "plus" of the design (iptv-mcp-servers.md §7.1
 * step 2: "the stemmed `query` plus every entry of `keywords`"): the
 * model adds venues and teams it only suspects, and a text that answers
 * the query alone must not be lost. The person is different: it is a
 * requirement, and it is looked for in the people and in the description
 * of the text.
 *
 * @returns the expression, or null when there is nothing to look for.
 */
export function buildMatchExpression(
  query: string,
  keywords: string[],
  person: string,
): string | null {
  const alternatives: string[] = [];

  const queryTerms = quoteTerms(query);
  if (queryTerms.length > 0) {
    alternatives.push(`(${queryTerms.join(' OR ')})`);
  }

  for (const keyword of keywords) {
    const terms = quoteTerms(keyword);
    if (terms.length === 0) continue;
    alternatives.push(`(${terms.join(' AND ')})`);
  }

  const parts: string[] = [];
  if (alternatives.length > 0) {
    parts.push(`(${alternatives.join(' OR ')})`);
  }

  const personTerms = quoteTerms(person);
  if (personTerms.length > 0) {
    parts.push(`{people description} : (${personTerms.join(' AND ')})`);
  }

  if (parts.length === 0) return null;
  return parts.join(' AND ');
}

/**
 * The order of a search, as SQL.
 *
 * `time` shows the soonest first, and the past windows the newest first:
 * the catch-up of yesterday evening is read the other way round than the
 * programme of this evening. Every order ends with the channel and the
 * start, so that the order is total and a page does not miss a programme.
 *
 * @param past True when the window lies in the past.
 */
export function orderClause(sort: 'relevance' | 'time' | 'channel', usedWords: boolean, past: boolean): string {
  switch (sort) {
    case 'relevance':
      // bm25() is negative and the smaller the value, the better the match.
      return usedWords
        ? 'score ASC, start_utc ASC, channel_id ASC'
        : 'start_utc ASC, channel_id ASC';
    case 'time':
      return past
        ? 'start_utc DESC, channel_id ASC'
        : 'start_utc ASC, channel_id ASC';
    case 'channel':
      return 'channel_name COLLATE NOCASE ASC, start_utc ASC, channel_id ASC';
  }
}
