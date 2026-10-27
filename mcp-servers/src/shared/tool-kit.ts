/**
 * tool-kit.ts - the shared shape of the answers of the tools.
 *
 * Every tool of both servers answers in the same way (design:
 * iptv-mcp-servers.md §8.3):
 *
 * - `content`: a compact text rendering for the model, one line per item;
 * - `structuredContent`: the same data as a structure, with an output
 *   schema that is declared on the tool;
 * - an error is `isError: true` with a sentence the model can act on.
 *
 * The cursor lives here as well: it encodes the position in the result and
 * the signature of the query it belongs to, so that a cursor of one query
 * cannot be used for another.
 */

import type { CallToolResult } from '@modelcontextprotocol/server';

import { sha256Prefix } from './hash.ts';

/**
 * A successful answer: the text for the model and the data behind it.
 *
 * @param data The structured data. It must match the output schema of the
 *   tool.
 * @param text The compact text rendering.
 */
export function okResult<T extends object>(
  data: T,
  text: string,
): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent: data as Record<string, unknown>,
  };
}

/**
 * An answer that failed.
 *
 * The message is a sentence the model can act on: what is wrong and what to
 * do about it. There is no structured content: the output schema of the
 * tool describes the successful answer, and this one did not happen.
 */
export function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

/**
 * The number of characters of the compact text of a list.
 *
 * A list of fifty items with a paragraph of description each would fill the
 * context of the model. The excerpt is cut to the setting of the server.
 */
export function renderLines(lines: string[]): string {
  return lines.join('\n');
}

/**
 * The cursor of a list: the position and the signature of the query.
 */
export interface Cursor {
  /** How many items were skipped. */
  offset: number;
  /** The signature of the query the cursor belongs to. */
  signature: string;
}

/**
 * The signature of a query.
 *
 * The parts are the parts that decide what the result is: the filters, the
 * words and the order. Two queries with the same signature have the same
 * result, so the cursor of one of them fits the other.
 */
export function signatureOf(parts: readonly unknown[]): string {
  return sha256Prefix(JSON.stringify(parts), 16);
}

/**
 * Encode a cursor.
 *
 * The cursor is base64url of a small JSON object: it holds nothing secret
 * and nothing of the catalogue.
 */
export function encodeCursor(cursor: Cursor): string {
  const json = JSON.stringify({ o: cursor.offset, s: cursor.signature });
  return Buffer.from(json, 'utf8').toString('base64url');
}

/**
 * Decode a cursor.
 *
 * @returns the cursor, or null when the text is not a cursor of this server.
 */
export function decodeCursor(text: string): Cursor | null {
  if (!text) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const value = parsed as { o?: unknown; s?: unknown };

  const offset = typeof value.o === 'number' && Number.isFinite(value.o) ? value.o : null;
  const signature = typeof value.s === 'string' ? value.s : null;
  if (offset === null || signature === null) return null;
  if (offset < 0 || !Number.isInteger(offset)) return null;

  return { offset, signature };
}

/**
 * The sentence that says that a cursor belongs to another query.
 */
export function cursorMismatchMessage(): string {
  return 'This cursor belongs to a different query. Run the search again without a cursor.';
}
