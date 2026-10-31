/**
 * server.ts - the entry point of the TV Guide MCP server.
 *
 * The steps (design: iptv-mcp-servers.md §4.2):
 *
 * 1. the working folder is created and the settings are read;
 * 2. the databases are opened and the schema is brought up to date;
 * 3. the tools are registered and the connection is served over stdio;
 * 4. a refresh starts in the background when the data is too old.
 *
 * stdout carries the MCP protocol and nothing else: the logs go to
 * `<data-dir>/logs/server.log`.
 */

import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { DEFAULT_DATA_DIRS, ensureDataDir, parseArgs } from '../shared/args.ts';
import { openDatabase, type Db } from '../shared/db.ts';
import { Logger } from '../shared/log.ts';
import { RefreshRunner } from '../shared/refresh.ts';
import { SettingsStore } from '../shared/settings.ts';
import { ensureVectorSchema } from '../shared/vectors.ts';
import { TV_GUIDE_SETTINGS_SPEC, readTvGuideSettings } from './config.ts';
import { createGuideRefresh, shouldRefreshAtStart, type RefreshStart } from './refresh.ts';
import { applyTvGuideSchema } from './schema.ts';
import { registerGuideTools } from './tools.ts';

/** The name of the server; it is the prefix of the tool names in Pilot. */
export const SERVER_NAME = 'tv-guide';

/** The version of the server. */
export const SERVER_VERSION = '0.1.0';

/**
 * The description of the server, as Pilot shows it in its list.
 *
 * It is at most 200 characters long (design: iptv-mcp-servers.md §5.3).
 */
export const PILOT_DESCRIPTION =
  "Broadcast TV guide of the user's IPTV provider: what is on now, tonight or in the archive by kind, channel, country or meaning; when a title airs; live and catch-up links.";

/**
 * The instructions of the server.
 *
 * Pilot does not read them today (design: iptv-mcp-servers.md §2.3), but
 * the clients that do read them get the rules that span the tools. The
 * draft is the one of the design (tv-guide-server.md §8).
 */
export const INSTRUCTIONS = [
  "TV Guide is the user's broadcast TV: the programme guide of their IPTV provider, with live and catch-up links. Data is mostly in Russian; foreign channels use their own languages.",
  '- Start with `search_programs`. Put a natural description in `query` and exact names (teams, places, venues, people) in `keywords`. If you know where an event takes place (a biathlon stage in Östersund), add the place to `keywords`.',
  '- Decide what a country in the request means: `production_countries` is where a film was made; `channel_regions` is the country of the channel; the place of an event and a participating team go into `keywords`.',
  '- `kinds` says what a programme is. Take channel themes and regions from `list_channels`.',
  "- Times are in the user's time zone. Use `period` for common windows and `from`/`to` for exact ones.",
  '- "When will X be on": `find_airings`. "What is on now": `get_now_and_next`. One channel: `get_channel_schedule`.',
  '- Lists contain no links. `get_program` returns the Watch Live and Catch-up links. Fetch them right before the user wants to watch: a catch-up link depends on the current time.',
  "- If a Cinema server is also connected, it holds on-demand films. For \"where can I watch X\", ask both.",
].join('\n');

/** Everything the server of the TV Guide is built of. */
export interface TvGuideServerContext {
  db: Db;
  /** The working folder of the server. */
  dataDir: string;
  settings: SettingsStore;
  logger: Logger;
  runner: RefreshRunner;
  /** Starts a refresh in the background. */
  refresh: (force: boolean) => RefreshStart;
  /** The moment the tools answer at: the wall clock. */
  now: () => number;
}

/**
 * Build the MCP server of the TV Guide.
 *
 * The tools are registered on it; the caller decides how it is served.
 */
export function createTvGuideServer(ctx: TvGuideServerContext): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION, description: PILOT_DESCRIPTION },
    { instructions: INSTRUCTIONS },
  );

  registerGuideTools(server, ctx);

  return server;
}

/**
 * The text of `--help`. It goes to stderr: stdout carries the protocol.
 */
const USAGE = [
  'Usage: node src/tv-guide/server.ts [--data-dir <folder>]',
  '',
  '  --data-dir <folder>  the working folder of the server',
  `                       (default: ${DEFAULT_DATA_DIRS['tv-guide']})`,
].join('\n');

/**
 * Start the server.
 *
 * @param argv The arguments of the program, without the name of the
 *   program.
 */
export function main(argv: string[]): void {
  const args = parseArgs(argv);

  if (args.help) {
    process.stderr.write(`${USAGE}\n`);
    return;
  }

  const dataDir = ensureDataDir(args.dataDir || DEFAULT_DATA_DIRS['tv-guide']);

  const logger = new Logger(join(dataDir, 'logs', 'server.log'));
  logger.info('the tv guide server starts', { data_dir: dataDir });

  const settings = new SettingsStore(
    join(dataDir, 'settings.json'),
    TV_GUIDE_SETTINGS_SPEC,
  );

  const current = settings.current();
  logger.setLevel(readTvGuideSettings(current.settings).logLevel);
  for (const issue of current.issues) {
    logger.warn('the settings file has a problem', { issue });
  }

  const db = openDatabase({
    path: join(dataDir, 'data.sqlite'),
    vectorsPath: join(dataDir, 'vectors.sqlite'),
  });

  try {
    applyTvGuideSchema(db);
    // The tables of the vectors: the search by meaning of phase T4 needs
    // them, and get_status counts what is already there.
    ensureVectorSchema(db);
  } catch (error) {
    logger.error('the schema of the guide could not be prepared', {
      error: error instanceof Error ? error.message : String(error),
    });
    db.close();
    throw error;
  }

  const runner = new RefreshRunner();

  const refresh = createGuideRefresh({
    db,
    dataDir,
    settings,
    logger,
    runner,
  });

  const ctx: TvGuideServerContext = {
    db,
    dataDir,
    settings,
    logger,
    runner,
    refresh,
    now: () => Math.floor(Date.now() / 1000),
  };

  // The refresh at the start runs in the background: the tools answer from
  // whatever is in the database (design: iptv-mcp-servers.md §4.2 step 4).
  const startSettings = readTvGuideSettings(settings.settings());
  const decision = shouldRefreshAtStart(db, startSettings);
  if (decision.refresh) {
    logger.info('a refresh starts', { reason: decision.reason });
    refresh(false);
  } else {
    logger.info('no refresh at the start', { reason: decision.reason });
  }

  serveStdio(() => createTvGuideServer(ctx), {
    onerror: (error) => logger.error('the connection failed', { error: error.message }),
  });

  logger.info('the tv guide server waits for the client', { data_dir: dataDir });
}

// The server is started when the file is run directly.
const entry = process.argv[1];
if (entry) {
  try {
    if (fileURLToPath(import.meta.url) === realpathSync(entry)) {
      main(process.argv.slice(2));
    }
  } catch {
    // The path cannot be read: the file was not started as a program.
  }
}
