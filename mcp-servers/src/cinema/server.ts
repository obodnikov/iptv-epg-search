/**
 * server.ts - the entry point of the cinema MCP server.
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
import { CINEMA_SETTINGS_SPEC, readCinemaSettings } from './config.ts';
import { createCinemaRefresh, shouldRefreshAtStart, type RefreshStart } from './refresh.ts';
import { applyCinemaSchema } from './schema.ts';
import { registerCinemaTools } from './tools.ts';

/** The name of the server; it is the prefix of the tool names in Pilot. */
export const SERVER_NAME = 'cinema';

/** The version of the server. */
export const SERVER_VERSION = '0.1.0';

/**
 * The description of the server, as Pilot shows it in its list.
 *
 * It is at most 200 characters long (design: iptv-mcp-servers.md §5.3).
 */
export const PILOT_DESCRIPTION =
  "Online cinema of the user's IPTV provider: find films and series by genre, country, year, rating or meaning; similar titles; new arrivals; play links.";

/**
 * The instructions of the server.
 *
 * Pilot does not read them today (design: iptv-mcp-servers.md §2.3), but
 * the clients that do read them get the rules that span the tools.
 */
export const INSTRUCTIONS = [
  "Cinema is the user's on-demand catalogue of films and series from their IPTV provider.",
  'Data is mostly in Russian; foreign films appear under their Russian titles.',
  '- Start with `search_titles`. Put a natural description in `query` and exact names (titles, directors, places) in `keywords`. Take category and genre values from `list_facets`.',
  '- `countries` means the country where the film was made.',
  '- "New" or "recently added": `sort="added"` with `added_within_days`.',
  '- "Something like X": find X with `search_titles`, then call `find_similar_titles` with its `title_id`. That tool arrives with the search by meaning; until then, search with the genres, the country and the director of X.',
  '- Lists contain no play links. Call `get_title` (film) or `list_episodes` (series) when the user wants to watch.',
  '- `rating` is the provider\'s 0-10 score. When judging whether a title is worth watching, say which part comes from the provider and which from your own knowledge.',
  '- If a TV Guide server is also connected, it covers broadcast TV. For "where can I watch X", ask both.',
].join('\n');

/** Everything the server of the cinema catalogue is built of. */
export interface CinemaServerContext {
  db: Db;
  /** The working folder of the server. */
  dataDir: string;
  settings: SettingsStore;
  logger: Logger;
  runner: RefreshRunner;
  /** Starts a refresh in the background. */
  refresh: (force: boolean) => RefreshStart;
}

/**
 * Build the MCP server of the cinema catalogue.
 *
 * The tools are registered on it; the caller decides how it is served.
 */
export function createCinemaServer(ctx: CinemaServerContext): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION, description: PILOT_DESCRIPTION },
    { instructions: INSTRUCTIONS },
  );

  registerCinemaTools(server, ctx);

  return server;
}

/**
 * The text of `--help`. It goes to stderr: stdout carries the protocol.
 */
const USAGE = [
  'Usage: node src/cinema/server.ts [--data-dir <folder>]',
  '',
  '  --data-dir <folder>  the working folder of the server',
  `                       (default: ${DEFAULT_DATA_DIRS.cinema})`,
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

  const dataDir = ensureDataDir(args.dataDir || DEFAULT_DATA_DIRS.cinema);

  const logger = new Logger(join(dataDir, 'logs', 'server.log'));
  logger.info('the cinema server starts', { data_dir: dataDir });

  const settings = new SettingsStore(
    join(dataDir, 'settings.json'),
    CINEMA_SETTINGS_SPEC,
  );

  const current = settings.current();
  logger.setLevel(readCinemaSettings(current.settings).logLevel);
  for (const issue of current.issues) {
    logger.warn('the settings file has a problem', { issue });
  }

  const db = openDatabase({
    path: join(dataDir, 'data.sqlite'),
    vectorsPath: join(dataDir, 'vectors.sqlite'),
  });

  try {
    applyCinemaSchema(db);
  } catch (error) {
    logger.error('the schema of the catalogue could not be prepared', {
      error: error instanceof Error ? error.message : String(error),
    });
    db.close();
    throw error;
  }

  const runner = new RefreshRunner();
  const refresh = createCinemaRefresh({
    db,
    dataDir,
    settings,
    logger,
    runner,
  });

  const ctx: CinemaServerContext = {
    db,
    dataDir,
    settings,
    logger,
    runner,
    refresh,
  };

  // The refresh at the start runs in the background: the tools answer from
  // whatever is in the database (design: iptv-mcp-servers.md §4.2 step 4).
  const startSettings = readCinemaSettings(settings.settings());
  const decision = shouldRefreshAtStart(db, startSettings);
  if (decision.refresh) {
    logger.info('a refresh starts', { reason: decision.reason });
    refresh(false);
  } else {
    logger.info('no refresh at the start', { reason: decision.reason });
  }

  serveStdio(() => createCinemaServer(ctx), {
    onerror: (error) => logger.error('the connection failed', { error: error.message }),
  });

  logger.info('the cinema server waits for the client', { data_dir: dataDir });
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
