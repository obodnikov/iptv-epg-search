/**
 * support.ts - what the manual checks of §10 need: the types of the
 * answers, the helpers that read them, the server over stdio and two
 * readers of the database.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

import { openDatabase, type Db } from '../../src/shared/db.ts';
import { expandHome } from '../../src/shared/args.ts';
import { CINEMA_SETTINGS_TEMPLATE } from '../../src/cinema/config.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The server of the cinema catalogue. */
export const SERVER = resolve(HERE, '../../src/cinema/server.ts');

/** The working folder the checks use by default. */
export const DEFAULT_DATA_DIR = '~/.iptv-mcp/cinema';

/** The item of a list, as the tools answer it. */
export interface ListItem {
  title_id: string;
  type: 'film' | 'series';
  title: string;
  year: number | null;
  rating: number | null;
  genres: string[];
  countries: string[];
  category: string | null;
  director: string | null;
  seasons: number | null;
  episodes: number | null;
  duration_min: number | null;
  added: string | null;
  snippet: string;
  score: number;
}

/** What one check found. */
export interface Outcome {
  /** True when the answer is the one the design expects. */
  ok: boolean;
  /** The sentence that says what happened. */
  note: string;
  /**
   * True when the reason is outside the server (the catalogue is empty,
   * the vectors are not built yet). Such a check does not fail the run.
   */
  soft?: boolean;
}

/** What a check needs besides the server. */
export interface CheckContext {
  /** The working folder of the server. */
  dataDir: string;
}

/** One check of §10. */
export interface Check {
  /** The number of the check in §10. */
  id: number;
  /** The question, as it is asked in Pilot. */
  question: string;
  /** The tool call the design prescribes. */
  tool: string;
  run: (server: Server, ctx: CheckContext) => Promise<Outcome>;
}

/** The shape of the answer of a tool that the script reads. */
export interface CallToolResultLike {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
}

/** A server the script can talk to. */
export interface Server {
  call(name: string, args?: Record<string, unknown>): Promise<CallToolResultLike>;
  close(): Promise<void>;
}

/**
 * The structured content of an answer.
 */
export function structured(result: CallToolResultLike): Record<string, unknown> {
  return (result.structuredContent ?? {}) as Record<string, unknown>;
}

/**
 * The text of an answer.
 */
export function textOf(result: CallToolResultLike): string {
  return (result.content ?? [])
    .map((entry) => (entry.type === 'text' ? (entry.text ?? '') : ''))
    .join('\n');
}

/**
 * The items of a list answer.
 */
export function itemsOf(result: CallToolResultLike): ListItem[] {
  return (structured(result)['items'] ?? []) as ListItem[];
}

/**
 * The title of a list item, as it is written in the report.
 */
export function label(item: ListItem | undefined): string {
  if (!item) return 'no title';
  const year = item.year === null ? '' : ` (${item.year})`;
  const rating = item.rating === null ? '' : `, rating ${item.rating}`;
  return `«${item.title}»${year}${rating}`;
}

/**
 * Start the server over stdio, the way a client starts it.
 *
 * The whole environment is passed on: the key of the embedding service is
 * read from it, and the transport would otherwise keep only a few safe
 * variables.
 */
export async function startServer(dataDir: string): Promise<Server> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER, '--data-dir', dataDir],
    env,
    stderr: 'pipe',
  });

  const client = new Client({ name: 'manual-checks', version: '1.0.0' });
  await client.connect(transport);

  return {
    call: (name, args = {}) =>
      client.callTool({ name, arguments: args }) as Promise<CallToolResultLike>,
    close: () => client.close(),
  };
}

/**
 * Open the database of the working folder, read-only.
 *
 * @returns the connection, or null when the catalogue is not there yet.
 */
function openReadOnly(dataDir: string): Db | null {
  try {
    return openDatabase({
      path: join(dataDir, 'data.sqlite'),
      vectorsPath: join(dataDir, 'vectors.sqlite'),
      readOnly: true,
    });
  } catch {
    return null;
  }
}

/**
 * The ids of the adult titles of the catalogue.
 *
 * The database is opened read-only: the script never writes into the
 * working folder of the server.
 */
export function adultTitleIds(dataDir: string): string[] {
  const db = openReadOnly(dataDir);
  if (!db) return [];
  try {
    const rows = db.all<{ title_id: string }>(
      'SELECT title_id FROM titles WHERE is_adult = 1',
    );
    return rows.map((row) => row.title_id);
  } catch {
    return [];
  } finally {
    db.close();
  }
}

/**
 * The ids of the series that have at least three seasons.
 */
export function seriesWithThreeSeasons(dataDir: string): string[] {
  const db = openReadOnly(dataDir);
  if (!db) return [];
  try {
    const rows = db.all<{ title_id: string }>(
      `SELECT title_id FROM titles
        WHERE type = 'series' AND season_count >= 3 AND removed_at IS NULL
        ORDER BY season_count DESC, title_id
        LIMIT 20`,
    );
    return rows.map((row) => row.title_id);
  } catch {
    return [];
  } finally {
    db.close();
  }
}

/**
 * A working folder of a server that has no URL of the provider.
 *
 * It is used by the tenth check: the tools have to name the settings file
 * the owner has to fill in.
 */
export function emptySettingsFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'iptv-mcp-cinema-empty-'));
  writeFileSync(
    join(dir, 'settings.json'),
    `${JSON.stringify(CINEMA_SETTINGS_TEMPLATE, null, 2)}\n`,
    { mode: 0o600 },
  );
  return dir;
}

/**
 * Remove a folder of a check.
 */
export function removeFolder(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // The folder may be gone already.
  }
}

/**
 * The path of a folder, with the `~` of the home folder expanded.
 */
export function folderOf(path: string): string {
  return resolve(expandHome(path));
}

/**
 * How long the script waits for the import of the catalogue.
 */
export const CATALOGUE_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * How long the script waits for the vectors of the catalogue.
 */
export const VECTORS_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * Wait a moment.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until the catalogue holds titles.
 *
 * The import runs in the background of the server: the script waits for it
 * instead of killing it. A killed import leaves its lock behind, and the
 * lock blocks the next refresh for an hour.
 */
export async function waitForCatalogue(
  server: Server,
  timeoutMs = CATALOGUE_TIMEOUT_MS,
  onProgress?: (phase: string) => void,
): Promise<{ ready: boolean; note: string }> {
  const deadline = Date.now() + timeoutMs;
  let lastPhase = '';
  let lastPrint = 0;

  for (;;) {
    const result = await server.call('get_status');
    const data = structured(result);
    const counts = data['counts'] as Record<string, number> | undefined;
    const titles = counts?.titles ?? 0;
    if (titles > 0) return { ready: true, note: `the catalogue holds ${titles} titles` };

    const refresh = data['refresh_running'] as Record<string, unknown> | null;
    const phase = typeof refresh?.phase === 'string' ? refresh.phase : 'waiting';
    if (phase !== lastPhase && Date.now() - lastPrint > 5000) {
      lastPhase = phase;
      lastPrint = Date.now();
      onProgress?.(phase);
    }

    if (Date.now() > deadline) {
      return {
        ready: false,
        note: `the catalogue is still empty after ${Math.round(timeoutMs / 1000)} s (phase ${phase})`,
      };
    }
    await sleep(1000);
  }
}

/**
 * Wait until the queue of the texts is empty.
 *
 * The vectors are built by the worker of the server; the script waits for
 * them, so that the search by meaning can be checked.
 */
export async function waitForVectors(
  server: Server,
  timeoutMs = VECTORS_TIMEOUT_MS,
  onProgress?: (done: number, pending: number) => void,
): Promise<{ ready: boolean; note: string }> {
  const deadline = Date.now() + timeoutMs;
  let lastPrint = 0;

  for (;;) {
    const result = await server.call('get_status');
    const data = structured(result);
    const embedding = data['embedding'] as Record<string, unknown> | undefined;
    const vectors = data['vectors'] as Record<string, unknown> | undefined;
    const pending = typeof embedding?.pending === 'number' ? embedding.pending : 0;
    const done = typeof embedding?.done === 'number' ? embedding.done : 0;

    // The embeddings are off, or the key is missing: nothing will happen.
    if (embedding?.enabled !== true || embedding?.key_present !== true) {
      return {
        ready: false,
        note: 'the embeddings are off, or the key of the service is not in the environment',
      };
    }

    if (embedding?.running !== true && pending === 0) {
      return { ready: true, note: `${vectors?.done ?? 0} vectors are there` };
    }

    if (Date.now() - lastPrint > 10000) {
      lastPrint = Date.now();
      onProgress?.(done, pending);
    }

    if (Date.now() > deadline) {
      return {
        ready: false,
        note: `${pending} texts are still not embedded after ${Math.round(timeoutMs / 1000)} s`,
      };
    }
    await sleep(1000);
  }
}

/**
 * Wait until a running refresh is over.
 *
 * The script closes the server at the end: a refresh that is killed leaves
 * its lock behind, and the lock blocks the next refresh for an hour.
 */
export async function waitForRefreshToSettle(
  server: Server,
  timeoutMs = 3 * 60 * 1000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await server.call('get_status');
    const data = structured(result);
    const refresh = data['refresh_running'] as Record<string, unknown> | null;
    if (!refresh) return null;
    if (Date.now() > deadline) {
      return `a refresh is still running (${String(refresh['phase'] ?? '?')})`;
    }
    await sleep(1000);
  }
}
