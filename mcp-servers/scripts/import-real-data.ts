/**
 * import-real-data.ts - import a real catalogue into a database and print
 * what it cost.
 *
 * The numbers are recorded in mcp-servers/docs/design/cinema-server.md §9
 * (phase C2). They are not asserted in CI: the file is the user's own
 * provider data and never enters the repository.
 *
 * Usage:
 *   npm run import-real-data -- [<path to index.m3u>] [--data-dir <dir>]
 */

import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { applyCinemaSchema } from '../src/cinema/schema.ts';
import { importCatalogFile } from '../src/cinema/import.ts';
import { countTitles } from '../src/cinema/store.ts';
import { type Db, openDatabase } from '../src/shared/db.ts';

const DEFAULT_PATH = resolve(process.cwd(), '..', 'tmp', 'index.m3u');

interface Arguments {
  file: string | null;
  dataDir: string | null;
}

/**
 * Read the arguments of the script.
 *
 * `npm run import-real-data -- <path>` puts the path into the arguments, so
 * the first argument that is not an option is the file. `--file` and
 * `--data-dir` name them explicitly.
 */
function readArguments(argv: string[]): Arguments {
  const result: Arguments = { file: null, dataDir: null };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;

    if (arg === '--file') {
      result.file = argv[i + 1] ?? null;
      i++;
      continue;
    }
    if (arg.startsWith('--file=')) {
      result.file = arg.slice('--file='.length);
      continue;
    }
    if (arg === '--data-dir') {
      result.dataDir = argv[i + 1] ?? null;
      i++;
      continue;
    }
    if (arg.startsWith('--data-dir=')) {
      result.dataDir = arg.slice('--data-dir='.length);
      continue;
    }
    if (arg.startsWith('-')) continue;

    // The first free argument is the catalogue.
    if (!result.file) result.file = arg;
  }

  return result;
}

function main(): void {
  const args = readArguments(process.argv.slice(2));
  const path = resolve(args.file ?? DEFAULT_PATH);
  const keep = args.dataDir !== null;
  const dataDir = args.dataDir ?? mkdtempSync(join(tmpdir(), 'iptv-mcp-real-'));

  if (!existsSync(path)) {
    console.error(`the catalogue file does not exist: ${path}`);
    process.exitCode = 1;
    if (!keep) rmSync(dataDir, { recursive: true, force: true });
    return;
  }

  console.log(`file:     ${path}`);
  console.log(`data dir: ${dataDir}`);
  console.log('');

  let db: Db | null = null;
  try {
    db = openDatabase({
      path: join(dataDir, 'data.sqlite'),
      vectorsPath: join(dataDir, 'vectors.sqlite'),
    });

    applyCinemaSchema(db);

    const started = Date.now();
    const outcome = importCatalogFile(db, path, {
      cinemaUrl: '',
      excludeCategories: [],
      countryAliases: {},
      trackChanges: true,
      embeddingModel: 'BAAI/bge-m3',
      minTextChars: 40,
      now: Math.floor(Date.now() / 1000),
      dataDir,
      log: {
        warn: (message, fields) => {
          console.warn(`WARN  ${message} ${JSON.stringify(fields ?? {})}`);
        },
        error: (message, fields) => {
          console.error(`ERROR ${message} ${JSON.stringify(fields ?? {})}`);
        },
      },
    });
    const elapsed = Date.now() - started;

    if (!outcome.ok) {
      console.error(`the import failed: ${outcome.error}`);
      process.exitCode = 1;
      return;
    }

    const counts = countTitles(db);
    const queued = db.get<{ found: number }>('SELECT count(*) AS found FROM vector_queue');
    const genres = db.get<{ found: number }>('SELECT count(*) AS found FROM title_genres');
    const countries = db.get<{ found: number }>('SELECT count(*) AS found FROM title_countries');
    const fts = db.get<{ found: number }>('SELECT count(*) AS found FROM titles_fts');

    console.log('--- the import ---');
    console.log(`entries read:            ${outcome.entries}`);
    console.log(`  rejected (bad URL):    ${outcome.rejected}`);
    console.log(`  without a stream line: ${outcome.incomplete}`);
    console.log(`import time:             ${(elapsed / 1000).toFixed(1)}s`);
    console.log('');
    console.log('--- the database ---');
    console.log(`titles:                  ${counts.titles}`);
    console.log(`  films:                 ${counts.films}`);
    console.log(`  series:                ${counts.series}`);
    console.log(`  removed:               ${counts.removed}`);
    console.log(`variants:                ${counts.variants}`);
    console.log(`episodes:                ${counts.episodes}`);
    console.log(`genre rows:              ${genres?.found ?? 0}`);
    console.log(`country rows:            ${countries?.found ?? 0}`);
    console.log(`keyword index rows:      ${fts?.found ?? 0}`);
    console.log(`texts to embed:          ${queued?.found ?? 0}`);
    console.log(`data.sqlite:             ${(statSync(join(dataDir, 'data.sqlite')).size / 1024 / 1024).toFixed(1)} MB`);

    // The collisions change the id of a title that was in the database
    // before: they have to be seen.
    const collisions = outcome.write?.collisions ?? [];
    console.log(`id collisions:            ${collisions.length}`);
    for (const collision of collisions) {
      console.log(`  ${collision.baseId}: ${collision.existingLookupKey} and ${collision.incomingLookupKey}`);
    }
  } finally {
    db?.close();
    // The temporary folder is removed, unless the caller wanted to keep it.
    if (!keep) rmSync(dataDir, { recursive: true, force: true });
  }
}

main();
