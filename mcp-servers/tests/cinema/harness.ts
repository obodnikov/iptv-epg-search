/**
 * harness.ts - the cinema server in the tests.
 *
 * The tools are called through the SDK's in-memory transport, the way a
 * client calls them: the contract of the tools is tested, not their
 * internals (design: iptv-mcp-servers.md §10).
 */

import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, type CallToolResult, type McpServer } from '@modelcontextprotocol/server';

import { openDatabase, type Db } from '../../src/shared/db.ts';
import { createFakeEmbedder, type TextEmbedder } from '../../src/shared/embeddings.ts';
import { Logger } from '../../src/shared/log.ts';
import { RefreshRunner } from '../../src/shared/refresh.ts';
import { SettingsStore } from '../../src/shared/settings.ts';
import { ensureVectorSchema } from '../../src/shared/vectors.ts';
import { CINEMA_SETTINGS_SPEC, CINEMA_SETTINGS_TEMPLATE } from '../../src/cinema/config.ts';
import { createEmbedder, type Embedder } from '../../src/cinema/embedder.ts';
import { importCatalogText, type ImportOptions } from '../../src/cinema/import.ts';
import { QueryCache } from '../../src/shared/query-cache.ts';
import { createCinemaServer } from '../../src/cinema/server.ts';
import { createCinemaRefresh } from '../../src/cinema/refresh.ts';
import { applyCinemaSchema } from '../../src/cinema/schema.ts';
import { tempDir } from '../helpers.ts';

export interface CinemaHarness {
  client: Client;
  server: McpServer;
  db: Db;
  /** The working folder of the test. */
  dir: string;
  /** The path of the settings file. */
  settingsPath: string;
  /** The client of the embedding service. */
  embedder: TextEmbedder;
  /** The worker of the embeddings. */
  worker: Embedder;
  /** Call a tool of the server. */
  call(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
  /** Wait until the background refresh is over. */
  waitForRefresh(timeoutMs?: number): Promise<void>;
  /** Wait until the background embedding run is over. */
  waitForEmbedding(timeoutMs?: number): Promise<void>;
  /** Close everything and remove the folder. */
  cleanup(): Promise<void>;
}

export interface HarnessOptions {
  /** The values of the settings file. */
  settings?: Record<string, unknown>;
  /** A catalogue that is imported before the tools are called. */
  catalogue?: string;
  /**
   * The client of the embedding service.
   *
   * The tests use the fake one: it never reaches the network.
   */
  embedder?: TextEmbedder;
}

/**
 * The options of the import of the test.
 */
function importOptions(): ImportOptions {
  return {
    cinemaUrl: '',
    excludeCategories: [],
    countryAliases: {},
    trackChanges: true,
    embeddingModel: 'BAAI/bge-m3',
    minTextChars: 0,
    now: 1_800_000_000,
  };
}

/**
 * A cinema server with a client, in a temporary folder.
 */
export async function cinemaHarness(options: HarnessOptions = {}): Promise<CinemaHarness> {
  const dir = tempDir('iptv-mcp-cinema-');
  const settingsPath = join(dir, 'settings.json');

  // The settings file is written before the store reads it: the store only
  // writes the template when the file does not exist.
  writeFileSync(
    settingsPath,
    `${JSON.stringify({ ...CINEMA_SETTINGS_TEMPLATE, ...options.settings }, null, 2)}\n`,
    { mode: 0o600 },
  );

  const db = openDatabase({
    path: join(dir, 'data.sqlite'),
    vectorsPath: join(dir, 'vectors.sqlite'),
  });
  applyCinemaSchema(db);
  ensureVectorSchema(db);

  if (options.catalogue !== undefined) {
    const outcome = importCatalogText(db, options.catalogue, importOptions());
    if (!outcome.ok) throw new Error(`the fixture could not be imported: ${outcome.error}`);
  }

  const settings = new SettingsStore(settingsPath, CINEMA_SETTINGS_SPEC);
  const logger = new Logger(join(dir, 'logs', 'server.log'), 'error');
  const runner = new RefreshRunner();

  const embedder = options.embedder ?? createFakeEmbedder();
  const queryCache = new QueryCache(db);
  const worker = createEmbedder({
    db,
    dataDir: dir,
    settings,
    logger,
    embedder,
  });

  const refresh = createCinemaRefresh({
    db,
    dataDir: dir,
    settings,
    logger,
    runner,
    worker,
  });

  const server = createCinemaServer({
    db,
    dataDir: dir,
    settings,
    logger,
    runner,
    refresh,
    client: embedder,
    queryCache,
    worker,
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'cinema-test', version: '1.0.0' });
  await client.connect(clientTransport);

  /**
   * Wait until the background refresh is over.
   *
   * A refresh that does not settle is a failure: the test would go on
   * with a background task that writes into the folder.
   */
  async function waitForRefresh(timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!runner.progress().running) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const progress = runner.progress();
    throw new Error(
      `the refresh did not finish in ${timeoutMs} ms (phase ${progress.phase}, ${progress.elapsedMs} ms)`,
    );
  }

  /**
   * Wait until the background embedding run is over.
   *
   * A run that does not settle is a failure: the test would go on with a
   * background task that writes into the folder.
   */
  async function waitForEmbedding(timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!worker.status().running) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const status = worker.status();
    throw new Error(
      `the embedding run did not finish in ${timeoutMs} ms (phase ${status.phase}, ${status.done} texts)`,
    );
  }

  /**
   * Call a tool of the server.
   */
  async function call(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<CallToolResult> {
    return client.callTool({ name, arguments: args });
  }

  /**
   * Close everything and remove the folder.
   */
  async function cleanup(): Promise<void> {
    // The refresh may still be running: it writes into the folder. A
    // refresh that does not settle is reported, not ignored.
    let problem: unknown = null;
    try {
      await waitForRefresh(5000);
    } catch (error) {
      problem = error;
    }

    await client.close();
    await server.close();
    db.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // The folder may be gone already.
    }

    if (problem) throw problem;
  }

  return {
    client,
    server,
    db,
    dir,
    settingsPath,
    embedder,
    worker,
    call,
    waitForRefresh,
    waitForEmbedding,
    cleanup,
  };
}

/**
 * The structured content of an answer, as a plain object.
 */
export function structured(result: CallToolResult): Record<string, unknown> {
  return (result.structuredContent ?? {}) as Record<string, unknown>;
}

/**
 * The text of an answer.
 */
export function textOf(result: CallToolResult): string {
  return result.content
    .map((entry) => (entry.type === 'text' ? entry.text : ''))
    .join('\n');
}
