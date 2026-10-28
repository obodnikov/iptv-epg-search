/**
 * embed-real-data.ts - embed a real catalogue and print what it cost.
 *
 * The numbers are recorded in mcp-servers/docs/design/cinema-server.md §9
 * (phase C4). They are not asserted in CI: the file is the user's own
 * provider data and never enters the repository.
 *
 * The key of the embedding service comes from the environment
 * (`OPENROUTER_API_KEY`). The npm script loads it from the `.env` file of
 * the repository.
 *
 * Usage:
 *   npm run embed-real-data -- [<path to index.m3u>] [--data-dir <dir>] [--fake]
 */

import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { applyCinemaSchema } from '../src/cinema/schema.ts';
import { importCatalogFile } from '../src/cinema/import.ts';
import { nextQueuedTexts, removeQueuedTexts } from '../src/cinema/queue.ts';
import { countTitles } from '../src/cinema/store.ts';
import { type Db, openDatabase } from '../src/shared/db.ts';
import {
  createFakeEmbedder,
  createOpenRouterEmbedder,
  type TextEmbedder,
} from '../src/shared/embeddings.ts';
import { countVectors, ensureVectorSchema, putVectors } from '../src/shared/vectors.ts';

const DEFAULT_PATH = resolve(process.cwd(), '..', 'tmp', 'index.m3u');
const MODEL = 'BAAI/bge-m3';
const BATCH_SIZE = 50;
const MIN_TEXT_CHARS = 40;

interface Arguments {
  file: string | null;
  dataDir: string | null;
  fake: boolean;
}

/**
 * Read the arguments of the script.
 */
function readArguments(argv: string[]): Arguments {
  const result: Arguments = { file: null, dataDir: null, fake: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;

    if (arg === '--file') {
      result.file = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg.startsWith('--file=')) {
      result.file = arg.slice('--file='.length);
      continue;
    }
    if (arg === '--data-dir') {
      result.dataDir = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg.startsWith('--data-dir=')) {
      result.dataDir = arg.slice('--data-dir='.length);
      continue;
    }
    if (arg === '--fake') {
      result.fake = true;
      continue;
    }
    if (arg.startsWith('-')) continue;

    // The first free argument is the catalogue.
    if (!result.file) result.file = arg;
  }

  return result;
}

/**
 * The client of the service.
 *
 * With `--fake` the vectors are a function of the text: the run measures
 * the pipeline, not the service.
 */
function clientOf(fake: boolean): TextEmbedder {
  if (fake) return createFakeEmbedder({ model: MODEL });

  return createOpenRouterEmbedder(() => ({
    enabled: true,
    model: MODEL,
    apiKeyEnv: 'OPENROUTER_API_KEY',
    batchSize: BATCH_SIZE,
  }));
}

async function main(): Promise<void> {
  const args = readArguments(process.argv.slice(2));
  const path = resolve(args.file ?? DEFAULT_PATH);
  const keep = args.dataDir !== null;
  const dataDir = args.dataDir ?? mkdtempSync(join(tmpdir(), 'iptv-mcp-embed-'));

  if (!existsSync(path)) {
    console.error(`the catalogue file does not exist: ${path}`);
    process.exitCode = 1;
    if (!keep) rmSync(dataDir, { recursive: true, force: true });
    return;
  }

  console.log(`file:     ${path}`);
  console.log(`data dir: ${dataDir}`);
  console.log(`model:    ${MODEL}`);
  console.log('');

  let db: Db | null = null;
  try {
    db = openDatabase({
      path: join(dataDir, 'data.sqlite'),
      vectorsPath: join(dataDir, 'vectors.sqlite'),
    });

    applyCinemaSchema(db);
    ensureVectorSchema(db);

    const importStarted = Date.now();
    const outcome = importCatalogFile(db, path, {
      cinemaUrl: '',
      excludeCategories: [],
      countryAliases: {},
      trackChanges: true,
      embeddingModel: MODEL,
      minTextChars: MIN_TEXT_CHARS,
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
    const importMs = Date.now() - importStarted;

    if (!outcome.ok) {
      console.error(`the import failed: ${outcome.error}`);
      process.exitCode = 1;
      return;
    }

    const counts = countTitles(db);
    const queued =
      db.get<{ found: number }>('SELECT count(*) AS found FROM vector_queue')?.found ?? 0;

    console.log('--- the import ---');
    console.log(`entries read:            ${outcome.entries}`);
    console.log(`import time:             ${(importMs / 1000).toFixed(1)}s`);
    console.log(`titles:                  ${counts.titles}`);
    console.log(`texts to embed:          ${queued}`);
    console.log('');

    const client = clientOf(args.fake);
    if (!client.available) {
      console.error(
        'the key of the embedding service is not in the environment (OPENROUTER_API_KEY)',
      );
      process.exitCode = 1;
      return;
    }

    // The run itself: the same loop the worker of the server does.
    let embedded = 0;
    let requests = 0;
    const started = Date.now();

    for (;;) {
      const texts = nextQueuedTexts(db, MODEL, MIN_TEXT_CHARS, BATCH_SIZE);
      if (texts.length === 0) break;

      const vectors = await client.embedMany(texts.map((entry) => entry.text));
      if (!vectors || vectors.length !== texts.length) {
        console.error('the service did not answer every text');
        process.exitCode = 1;
        return;
      }

      putVectors(
        db,
        texts.map((entry, index) => ({
          textHash: entry.textHash,
          model: MODEL,
          embedding: vectors[index] as Float32Array,
          createdAt: Date.now(),
        })),
      );
      removeQueuedTexts(
        db,
        MODEL,
        texts.map((entry) => entry.textHash),
      );

      embedded += texts.length;
      requests += 1;

      const elapsed = (Date.now() - started) / 1000;
      console.log(
        `  ${embedded} texts, ${requests} requests, ${elapsed.toFixed(0)}s, ${(embedded / Math.max(elapsed, 0.001)).toFixed(1)} texts/s`,
      );
    }

    const elapsed = (Date.now() - started) / 1000;
    const vectorsFile = join(dataDir, 'vectors.sqlite');

    console.log('');
    console.log('--- the embedding ---');
    console.log(`texts embedded:          ${embedded}`);
    console.log(`requests:                ${requests}`);
    console.log(`time:                    ${elapsed.toFixed(1)}s`);
    console.log(`texts per second:        ${(embedded / Math.max(elapsed, 0.001)).toFixed(1)}`);
    console.log(`vectors of the model:    ${countVectors(db, MODEL)}`);
    console.log(
      `left in the queue:        ${db.get<{ found: number }>('SELECT count(*) AS found FROM vector_queue')?.found ?? 0}`,
    );
    console.log(`vectors.sqlite:          ${(statSync(vectorsFile).size / 1024 / 1024).toFixed(1)} MB`);
    console.log(`data.sqlite:             ${(statSync(join(dataDir, 'data.sqlite')).size / 1024 / 1024).toFixed(1)} MB`);
  } finally {
    db?.close();
    if (!keep) rmSync(dataDir, { recursive: true, force: true });
  }
}

await main();
