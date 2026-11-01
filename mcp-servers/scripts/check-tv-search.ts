/**
 * check-tv-search.ts - time the words-only search of the guide over the
 * real data.
 *
 * The target of the design (iptv-mcp-servers.md §7.4) is a search call
 * under 300 ms, excluding the one call of the embedding service - and
 * phase T3 has no embedding service yet, so every number here is the
 * whole call. The numbers are recorded in
 * mcp-servers/docs/design/tv-guide-server.md §10 (phase T3). They are not
 * asserted anywhere: the files are the user's own provider data and never
 * enter the repository.
 *
 * Usage:
 *   npm run check-tv-search -- [--data-dir <dir>] [--skip-import]
 *                              [--now <ISO date>] [--past-days <n>]
 *
 * The defaults are `../tmp/playlist.m3u` and `../tmp/4a27b28d` (the June
 * 2026 snapshot), imported into a temporary folder. The searches run at
 * `--now`, or an hour before the end of the imported window, so that the
 * periods have something to find.
 */

import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { openDatabase, type Db } from '../src/shared/db.ts';
import {
  createFakeEmbedder,
  createOpenRouterEmbedder,
  type TextEmbedder,
} from '../src/shared/embeddings.ts';
import { Logger } from '../src/shared/log.ts';
import { QueryCache } from '../src/shared/query-cache.ts';
import { RefreshRunner } from '../src/shared/refresh.ts';
import { SettingsStore } from '../src/shared/settings.ts';
import {
  readTvGuideSettings,
  TV_GUIDE_SETTINGS_SPEC,
  TV_GUIDE_SETTINGS_TEMPLATE,
} from '../src/tv-guide/config.ts';
import { createEmbedder } from '../src/tv-guide/embedder.ts';
import { importTvGuideFiles } from '../src/tv-guide/import.ts';
import { importOptionsOf } from '../src/tv-guide/import-options.ts';
import { createGuideRefresh } from '../src/tv-guide/refresh.ts';
import { applyTvGuideSchema } from '../src/tv-guide/schema.ts';
import { guideWindow } from '../src/tv-guide/queries.ts';
import {
  findAiringsTool,
  getChannelScheduleTool,
  getNowAndNextTool,
  searchProgramsTool,
  type GuideToolContext,
} from '../src/tv-guide/handlers.ts';

const DEFAULT_PLAYLIST = resolve(process.cwd(), '..', 'tmp', 'playlist.m3u');
const DEFAULT_EPG = resolve(process.cwd(), '..', 'tmp', '4a27b28d');

interface Arguments {
  playlist: string;
  epg: string;
  dataDir: string | null;
  now: number | null;
  pastDays: number | null;
  skipImport: boolean;
}

function readArguments(argv: string[]): Arguments {
  const result: Arguments = {
    playlist: DEFAULT_PLAYLIST,
    epg: DEFAULT_EPG,
    dataDir: null,
    now: null,
    pastDays: null,
    skipImport: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '--skip-import') {
      result.skipImport = true;
      continue;
    }
    if (arg === '--data-dir' || arg === '--now' || arg === '--past-days') {
      const value = argv[i + 1];
      if (value !== undefined) {
        if (arg === '--data-dir') result.dataDir = value;
        if (arg === '--now') {
          const parsed = Date.parse(value);
          if (Number.isNaN(parsed)) {
            console.error(`--now: ${value} is not a date`);
            process.exit(1);
          }
          result.now = Math.floor(parsed / 1000);
        }
        if (arg === '--past-days') result.pastDays = Number(value);
        i++;
      }
      continue;
    }
  }

  return result;
}

/**
 * Time one handler call.
 */
async function timed(name: string, call: () => Promise<{ isError?: boolean; content: unknown[] }>): Promise<void> {
  const started = performance.now();
  const result = await call();
  const ms = performance.now() - started;
  const structured = (result as { structuredContent?: { total?: number } }).structuredContent;
  const total = structured?.total;
  const head =
    result.isError
      ? `ERROR: ${JSON.stringify(result.content).slice(0, 120)}`
      : `${total === undefined ? '' : `${total} result(s), `}${ms.toFixed(0)} ms`;
  console.log(`${name.padEnd(58)} ${head}`);
}

async function main(): Promise<void> {
  const args = readArguments(process.argv.slice(2));

  const ownedDir = args.dataDir === null;
  const dataDir = args.dataDir ?? mkdtempSync(join(tmpdir(), 'iptv-tv-search-'));
  const settingsPath = join(dataDir, 'settings.json');

  if (!existsSync(settingsPath)) {
    writeSettings(settingsPath, {
      ...TV_GUIDE_SETTINGS_TEMPLATE,
      // The tools refuse to run without source URLs; the measurement runs
      // off the imported database, and no download happens.
      epgUrl: 'http://example.invalid/xml/guide.gz',
      liveUrl: 'http://example.invalid/playlist.m3u',
      logLevel: 'error',
    });
  }

  const settings = new SettingsStore(settingsPath, TV_GUIDE_SETTINGS_SPEC);
  const settingsNow = args.now ?? Math.floor(Date.now() / 1000);

  if (!args.skipImport) {
    const imported = Date.now();

    // The retention window runs from `now`: a now outside the window of
    // the guide leaves the database empty. The default of `--now` is read
    // out of the head of the EPG: the first programme start, plus five
    // days - the middle of a ten-day window.
    const now = args.now ?? nowFromEpgHead(args.epg);
    console.log(
      `importing ${args.playlist} and ${args.epg} (now ${new Date(now * 1000).toISOString()}) …`,
    );

    const importSettings = {
      ...readTvGuideSettings(settings.settings()),
      pastDays: args.pastDays ?? 10,
    };
    const dbForImport: Db = openDatabaseForImport(dataDir);
    const outcome = await importTvGuideFiles(
      dbForImport,
      { playlistPath: args.playlist, epgPath: args.epg },
      importOptionsOf(importSettings, now, { dataDir }),
    );
    dbForImport.close();
    if (!outcome.ok) {
      console.error(`the import failed: ${outcome.error}`);
      process.exit(1);
    }
    console.log(
      `imported ${outcome.write?.liveProgrammes ?? 0} programmes, ` +
        `${outcome.write?.texts ?? 0} texts in ${((Date.now() - imported) / 1000).toFixed(1)} s`,
    );
  }

  // The database is opened fresh, the way the server opens it.
  const db = openDatabase({
    path: join(dataDir, 'data.sqlite'),
    vectorsPath: join(dataDir, 'vectors.sqlite'),
  });
  applyTvGuideSchema(db);

  // The moment of the searches: the middle of the window of the guide,
  // so that the periods have something to find on both sides.
  const window = guideWindow(db);
  const now =
    args.now ??
    (window.from === null || window.to === null
      ? settingsNow
      : window.from + Math.floor((window.to - window.from) / 2));
  console.log(
    `the searches run at ${new Date(now * 1000).toISOString()} ` +
      `(guide window ${window.from === null ? 'never' : new Date(window.from * 1000).toISOString()} … ${
        window.to === null ? 'never' : new Date(window.to * 1000).toISOString()
      })`,
  );

  const logger = new Logger(join(dataDir, 'logs', 'server.log'), 'error');
  const runner = new RefreshRunner();
  const embedder = embedderForScript(settings);
  const worker = createEmbedder({
    db,
    dataDir,
    settings,
    logger,
    embedder,
  });
  const ctx: GuideToolContext = {
    db,
    dataDir,
    settings,
    logger,
    runner,
    refresh: createGuideRefresh({ db, dataDir, settings, logger, runner, worker }),
    client: embedder,
    queryCache: new QueryCache(db),
    worker,
    now: () => now,
  };

  console.log('');
  await timed('search kinds=[film] period=tonight', () =>
    searchProgramsTool(ctx, { kinds: ['film'], period: 'tonight' }),
  );
  await timed('search kinds=[film] countries=[FR] period=next_7d', () =>
    searchProgramsTool(ctx, { kinds: ['film'], production_countries: ['FR'], period: 'next_7d' }),
  );
  await timed('search query=биатлон keywords=[Эстерсунд,Швеция]', () =>
    searchProgramsTool(ctx, {
      kinds: ['sport'],
      query: 'биатлон',
      keywords: ['Эстерсунд', 'Швеция'],
    }),
  );
  await timed('search keywords=[Швеция] kinds=[sport]', () =>
    searchProgramsTool(ctx, { kinds: ['sport'], keywords: ['Швеция'] }),
  );
  await timed('search regions=[DE] period=tonight', () =>
    searchProgramsTool(ctx, { channel_regions: ['DE'], period: 'tonight' }),
  );
  await timed('search query=космос (words, wide)', () =>
    searchProgramsTool(ctx, { query: 'космос', period: 'next_7d' }),
  );
  await timed('search themes=[film] period=next_7d (no collapse)', () =>
    searchProgramsTool(ctx, {
      channel_themes: ['film'],
      period: 'next_7d',
      hide_repeats: false,
      prefer_hd: false,
    }),
  );
  await timed('search no filters (every upcoming programme)', () =>
    searchProgramsTool(ctx, {}),
  );
  await timed('search query=фильм no filters (every word match)', () =>
    searchProgramsTool(ctx, { query: 'фильм' }),
  );
  await timed('find_airings title=Бык', () => findAiringsTool(ctx, { title: 'Бык' }));
  await timed('get_channel_schedule channel=Матч ТВ HD', () =>
    getChannelScheduleTool(ctx, { channel: 'Матч ТВ HD' }),
  );
  await timed('get_now_and_next themes=[sport]', () =>
    getNowAndNextTool(ctx, { channel_themes: ['sport'] }),
  );
  await timed('get_now_and_next (every channel)', () => getNowAndNextTool(ctx, {}));

  db.close();
  if (ownedDir) {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

/**
 * The database of the import, closed again before the searches open it.
 */
function openDatabaseForImport(dataDir: string): Db {
  const db = openDatabase({
    path: join(dataDir, 'data.sqlite'),
    vectorsPath: join(dataDir, 'vectors.sqlite'),
  });
  applyTvGuideSchema(db);
  return db;
}

/**
 * A moment inside the window of an EPG file, read out of its head.
 *
 * The head of the file carries the first programmes; five days after the
 * first start is the middle of a ten-day window. The file is read in
 * blocks until a start is found. A gzipped file shows no start in its
 * head: the caller is asked for `--now`.
 */
function nowFromEpgHead(epgPath: string): number {
  const block = Buffer.alloc(1024 * 1024);
  const handle = openSync(epgPath, 'r');
  try {
    for (let read = 0; read < 8; read++) {
      const bytes = readSync(handle, block, 0, block.length, read * block.length);
      if (bytes <= 0) break;
      const match = /start="(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(
        block.toString('utf8', 0, bytes),
      );
      if (match) {
        const first = Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
        );
        return Math.floor(first / 1000) + 5 * 86400;
      }
    }
  } finally {
    closeSync(handle);
  }
  console.error(
    'the first programme start is not in the head of the EPG (is it gzipped?). Pass --now <ISO date>.',
  );
  process.exit(1);
}

/**
 * Write a settings file for the run.
 */
function writeSettings(path: string, template: Record<string, unknown>): void {
  writeFileSync(path, `${JSON.stringify(template, null, 2)}\n`);
}

/**
 * The client of the embedding service for this run.
 *
 * The real service when the key is in the environment, so that the search
 * by meaning runs; a fake otherwise, so that the timings of the words stay
 * honest.
 */
function embedderForScript(settings: SettingsStore): TextEmbedder {
  const real = createOpenRouterEmbedder(
    () => readTvGuideSettings(settings.settings()).embeddings,
  );
  if (real.available) return real;
  return createFakeEmbedder({ model: 'fake/model' });
}

const isDirect = process.argv[1] !== undefined && process.argv[1].endsWith('check-tv-search.ts');
if (isDirect) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exit(1);
  });
}
