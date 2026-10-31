/**
 * harness.ts - the TV Guide server in the tests.
 *
 * The tools are called through the SDK's in-memory transport, the way a
 * client calls them: the contract of the tools is tested, not their
 * internals (design: iptv-mcp-servers.md §10). The guide is imported from
 * the hand-made fixtures before the tools are called.
 */

import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import {
  InMemoryTransport,
  type CallToolResult,
  type McpServer,
} from '@modelcontextprotocol/server';

import { openDatabase, type Db } from '../../src/shared/db.ts';
import { Logger } from '../../src/shared/log.ts';
import { RefreshRunner } from '../../src/shared/refresh.ts';
import { SettingsStore } from '../../src/shared/settings.ts';
import { ensureVectorSchema } from '../../src/shared/vectors.ts';
import { TV_GUIDE_SETTINGS_SPEC, TV_GUIDE_SETTINGS_TEMPLATE } from '../../src/tv-guide/config.ts';
import { importTvGuideTexts } from '../../src/tv-guide/import.ts';
import type { ImportOptions } from '../../src/tv-guide/import-options.ts';
import { createGuideRefresh } from '../../src/tv-guide/refresh.ts';
import { applyTvGuideSchema } from '../../src/tv-guide/schema.ts';
import { createTvGuideServer } from '../../src/tv-guide/server.ts';
import { fixture } from '../fixtures/load.ts';
import { tempDir } from '../helpers.ts';

const EPG = fixture('tv-guide-tools-epg.xml');
const PLAYLIST = fixture('tv-guide-tools-playlist.m3u');

/** 2026-06-14 09:00 UTC — 12:00 in the +03:00 zone of the fixtures. */
export const NOW = Math.floor(Date.parse('2026-06-14T09:00:00Z') / 1000);

export interface GuideHarness {
  client: Client;
  server: McpServer;
  db: Db;
  /** The working folder of the test. */
  dir: string;
  /** The path of the settings file. */
  settingsPath: string;
  /** Call a tool of the server. */
  call(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
  /** Wait until the background refresh is over. */
  waitForRefresh(timeoutMs?: number): Promise<void>;
  /** Close everything and remove the folder. */
  cleanup(): Promise<void>;
}

export interface HarnessOptions {
  /** The values of the settings file. */
  settings?: Record<string, unknown>;
  /** Import the fixtures of the guide before the tools are called. */
  guide?: boolean;
  /** The moment the fixtures are imported with. */
  now?: number;
}

/**
 * The options of the import of the test.
 */
function importOptions(now: number): ImportOptions {
  return {
    epgUrl: '',
    liveUrl: '',
    excludeGroups: [],
    epgDefaultOffset: '+0000',
    pastDays: 10,
    embeddingModel: 'BAAI/bge-m3',
    minTextChars: 0,
    embeddingsEnabled: true,
    now,
  };
}

/**
 * A TV Guide server with a client, in a temporary folder.
 */
export async function guideHarness(
  options: HarnessOptions = {},
): Promise<GuideHarness> {
  const dir = tempDir('iptv-mcp-tv-guide-');
  const settingsPath = join(dir, 'settings.json');

  // The settings file is written before the store reads it: the store only
  // writes the template when the file does not exist.
  writeFileSync(
    settingsPath,
    `${JSON.stringify({ ...TV_GUIDE_SETTINGS_TEMPLATE, ...options.settings }, null, 2)}\n`,
    { mode: 0o600 },
  );

  const db = openDatabase({
    path: join(dir, 'data.sqlite'),
    vectorsPath: join(dir, 'vectors.sqlite'),
  });
  applyTvGuideSchema(db);
  ensureVectorSchema(db);

  if (options.guide !== false) {
    const outcome = await importTvGuideTexts(
      db,
      { playlistText: PLAYLIST, epgText: EPG },
      importOptions(options.now ?? NOW),
    );
    if (!outcome.ok) throw new Error(`the fixture could not be imported: ${outcome.error}`);
  }

  const settings = new SettingsStore(settingsPath, TV_GUIDE_SETTINGS_SPEC);
  const logger = new Logger(join(dir, 'logs', 'server.log'), 'error');
  const runner = new RefreshRunner();

  const refresh = createGuideRefresh({
    db,
    dataDir: dir,
    settings,
    logger,
    runner,
  });

  const server = createTvGuideServer({
    db,
    dataDir: dir,
    settings,
    logger,
    runner,
    refresh,
    // The tests hold the moment still: the fixtures live in June 2026,
    // and the statuses and the catch-up window move with the moment.
    now: () => options.now ?? NOW,
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'tv-guide-test', version: '1.0.0' });
  await client.connect(clientTransport);

  // The tools are listed once, so that the client knows the output
  // schemas: every answer of `call` is validated against the schema the
  // tool declared, the way a real client validates it.
  await client.listTools();

  /**
   * Wait until the background refresh is over.
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
    call,
    waitForRefresh,
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
