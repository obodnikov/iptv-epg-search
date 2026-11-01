/**
 * measure-tv-meaning.ts - embed the real guide and measure what the
 * meaning costs.
 *
 * The numbers are recorded in mcp-servers/docs/design/tv-guide-server.md
 * §10 (phase T4). They are not asserted anywhere: the files are the user's
 * own provider data and never enter the repository.
 *
 * Usage:
 *   npm run measure-tv-meaning -- [--data-dir <dir>] [--now <ISO date>]
 *                                [--past-days <n>] [--skip-import]
 *
 * The defaults are `../tmp/playlist.m3u` and `../tmp/4a27b28d` (the June
 * 2026 snapshot), imported into a temporary folder. The key of the
 * embedding service comes from the environment (`OPENROUTER_API_KEY`); the
 * npm script loads it from the `.env` file of the repository. Without the
 * key the script stops: the measurement is about the vectors.
 *
 * The script measures:
 * - the embedding run over the whole guide (time, vectors, file size);
 * - `vec_distance_cosine` over the largest candidate sets, through the
 *   search of the server (cold, with the one call that embeds the query,
 *   and warm, from the cache) and as raw SQL scans;
 * - the threshold of the kind by meaning, against the texts the provider
 *   named itself (the markers are the ground truth).
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { openDatabase, type Db } from '../src/shared/db.ts';
import { createOpenRouterEmbedder } from '../src/shared/embeddings.ts';
import { Logger } from '../src/shared/log.ts';
import { RefreshRunner } from '../src/shared/refresh.ts';
import { mergeSettings, SettingsStore } from '../src/shared/settings.ts';
import { countVectors, ensureVectorSchema, fromBlob } from '../src/shared/vectors.ts';
import { readTvGuideSettings, TV_GUIDE_SETTINGS_SPEC, TV_GUIDE_SETTINGS_TEMPLATE } from '../src/tv-guide/config.ts';
import { createEmbedder } from '../src/tv-guide/embedder.ts';
import { importTvGuideFiles } from '../src/tv-guide/import.ts';
import { importOptionsOf } from '../src/tv-guide/import-options.ts';
import { cosineDistance, MEANING_KIND_LABELS } from '../src/tv-guide/meaning.ts';
import { applyTvGuideSchema } from '../src/tv-guide/schema.ts';
import { candidateSql, collapseOverUnion } from '../src/tv-guide/candidates.ts';
import type { SearchRequest } from '../src/tv-guide/search-types.ts';
import { searchProgramsTool } from '../src/tv-guide/handler-search.ts';
import type { GuideToolContext } from '../src/tv-guide/tool-context.ts';

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
    if (['--data-dir', '--now', '--past-days'].includes(arg)) {
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

function dirSize(path: string): number {
  let total = 0;
  for (const entry of readdirSync(path)) {
    total += statSync(join(path, entry)).size;
  }
  return total;
}

function mb(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function ms(value: number): string {
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(1)} s`;
}

/**
 * The settings of the working folder, when it holds one.
 */
function settingsOf(dataDir: string): Record<string, unknown> {
  const path = join(dataDir, 'settings.json');

  let raw: unknown = {};
  if (existsSync(path)) {
    try {
      raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch {
      raw = {};
    }
  }
  return mergeSettings(raw, TV_GUIDE_SETTINGS_SPEC).settings;
}

async function main(): Promise<void> {
  const args = readArguments(process.argv.slice(2));
  const dataDir = args.dataDir ?? mkdtempSync(join(tmpdir(), 'iptv-tv-meaning-'));
  const ownDataDir = args.dataDir === null;

  if (!args.skipImport && (!existsSync(args.playlist) || !existsSync(args.epg))) {
    console.error(`files not found: ${args.playlist} and/or ${args.epg}`);
    process.exit(1);
  }

  console.log(`data dir: ${dataDir}`);

  // The settings file of the folder: the file of the owner when there is
  // one, otherwise the template. The embeddings are on and the texts are
  // not cut short — that is what the measurement is about. The store
  // re-reads the file, so the tools see the same values.
  const fileSettings = settingsOf(dataDir);
  const merged = mergeSettings(
    { ...structuredClone(TV_GUIDE_SETTINGS_TEMPLATE), ...fileSettings },
    TV_GUIDE_SETTINGS_SPEC,
  ).settings as Record<string, unknown>;
  (merged['embeddings'] as Record<string, unknown>)['enabled'] = true;
  ((merged['embeddings'] as Record<string, unknown>)['minTextChars']) = 0;
  const settingsPath = join(dataDir, 'settings.json');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  writeFileSync(settingsPath, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
  const store = new SettingsStore(settingsPath, TV_GUIDE_SETTINGS_SPEC);
  const settings = readTvGuideSettings(store.settings());

  const db: Db = openDatabase({
    path: join(dataDir, 'data.sqlite'),
    vectorsPath: join(dataDir, 'vectors.sqlite'),
  });
  applyTvGuideSchema(db);
  ensureVectorSchema(db);

  if (!args.skipImport) {
    const now = args.now ?? Math.floor(Date.parse('2026-06-19T12:00:00Z') / 1000);
    console.log(`importing ${args.playlist} and ${args.epg} (now ${new Date(now * 1000).toISOString()}) …`);
    const importSettings = { ...settings, pastDays: args.pastDays ?? settings.pastDays };
    const options = importOptionsOf(importSettings, now, { dataDir });
    const started = Date.now();
    const outcome = await importTvGuideFiles(
      db,
      { playlistPath: args.playlist, epgPath: args.epg },
      options,
    );
    if (!outcome.ok) {
      console.error(`the import failed: ${outcome.error}`);
      process.exit(1);
    }
    console.log(
      `imported ${outcome.write?.liveProgrammes ?? 0} programmes, ${outcome.write?.texts ?? 0} texts ` +
        `in ${ms(Date.now() - started)}; queue: ${outcome.write?.queueSize ?? 0}`,
    );
  }

  // The worker: the real service, and the script waits for the run.
  const client = createOpenRouterEmbedder(() => readTvGuideSettings(store.settings()).embeddings);
  if (!client.available) {
    console.error('OPENROUTER_API_KEY is not in the environment; the measurement needs it.');
    process.exit(1);
  }

  const logger = new Logger(join(dataDir, 'logs', 'server.log'), 'warn');
  const runner = new RefreshRunner();
  const worker = createEmbedder({
    db,
    dataDir,
    settings: store,
    logger,
    embedder: client,
  });

  const model = readTvGuideSettings(store.settings()).embeddings.model;
  const already = countVectors(db, model);
  if (already > 0) {
    console.log(`\nthe vectors of ${model} are there already: ${already}`);
  } else {
    console.log(`\nembedding the guide for ${model} …`);
  }
  const embedStarted = Date.now();
  const start = worker.start();
  if (start === 'disabled') {
    console.error('the worker refused to start (the embeddings are off?).');
    process.exit(1);
  }
  while (worker.status().running) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const status = worker.status();
    const all = status.done + status.pending;
    if (all > 0 && status.running) {
      process.stdout.write(
        `\r  embedded ${status.done} of ${all} (${Math.round((status.done / all) * 100)} %)   `,
      );
    }
  }
  process.stdout.write('\n');
  const embedStatus = worker.status();
  if (embedStatus.phase !== 'done') {
    console.error(`the embedding run failed: ${embedStatus.last_error}`);
    process.exit(1);
  }
  console.log(
    `embedded: ${countVectors(db, model)} vectors in ${ms(Date.now() - embedStarted)}; ` +
      `pending left: ${embedStatus.pending}`,
  );
  console.log(`vectors.sqlite: ${mb(statSync(join(dataDir, 'vectors.sqlite')).size)}`);

  // The tool context of the searches: the wall clock is the moment of the
  // run, the guide window of the snapshot decides what the periods find.
  const windowRow = db.get<{ from: number | null; to: number | null }>(
    'SELECT min(start_utc) AS "from", max(start_utc) AS "to" FROM programmes',
  );
  const now =
    args.now ??
    (windowRow?.from !== null && windowRow?.from !== undefined && windowRow?.to != null
      ? windowRow.from + Math.floor((windowRow.to - windowRow.from) / 2)
      : Math.floor(Date.now() / 1000));
  console.log(`the searches run at ${new Date(now * 1000).toISOString()}`);

  const ctx: GuideToolContext = {
    db,
    dataDir,
    settings: store,
    logger,
    runner,
    refresh: () => 'not_configured',
    client,
    queryCache: new (await import('../src/shared/query-cache.ts')).QueryCache(db),
    worker,
    now: () => now,
  };

  await measureSearches(ctx, now);
  measureRawScans(ctx, now);
  await measureThreshold(db, model);

  db.close();
  if (ownDataDir) {
    console.log(`\nthe data of the run: ${dataDir} (${mb(dirSize(dataDir))})`);
  }
}

/** The searches of the measurement, cold and warm. */
interface SearchCase {
  name: string;
  args: Record<string, unknown>;
}

/**
 * The searches through the tool of the server.
 *
 * Every search runs twice: the first call embeds the query (the one call
 * the target of the design counts apart), the second reads the vector
 * from the cache — the second time is the honest one for the target of
 * 300 ms.
 */
async function measureSearches(ctx: GuideToolContext, now: number): Promise<void> {
  const cases: SearchCase[] = [
    { name: 'query=биатлон keywords=[Эстерсунд,Швеция] kinds=[sport]',
      args: { query: 'биатлон в Швеции', keywords: ['Эстерсунд', 'Швеция'], kinds: ['sport'] } },
    { name: 'query=космос kinds=[film] period=next_7d',
      args: { query: 'фильмы про космос и одиночество', kinds: ['film'], period: 'next_7d' } },
    { name: 'query=французские фильмы production_countries=[FR]',
      args: { query: 'французские фильмы', production_countries: ['FR'] } },
    { name: 'query=новости спорта (wide, no filters)',
      args: { query: 'новости спорта за неделю' } },
    // The worst case: no word matches, so the candidates are the whole
    // guide with a vector, and the meaning answers alone.
    { name: 'query=<no word matches> (meaning alone, whole guide)',
      args: { query: 'ыыы пррр' } },
  ];

  console.log('\n--- the searches (cold = with the query embedding, warm = cached) ---');
  for (const testCase of cases) {
    const coldStarted = Date.now();
    const cold = await searchProgramsTool(ctx, testCase.args);
    const coldMs = Date.now() - coldStarted;

    const warmStarted = Date.now();
    const warm = await searchProgramsTool(ctx, testCase.args);
    const warmMs = Date.now() - warmStarted;

    const data = (warm.structuredContent ?? {}) as Record<string, unknown>;
    const coldData = (cold.structuredContent ?? {}) as Record<string, unknown>;
    console.log(
      `${testCase.name}\n` +
        `    cold ${ms(coldMs)}, warm ${ms(warmMs)}; mode ${data['search_mode']}, ` +
        `total ${data['total']} (cold total ${coldData['total']})`,
    );
  }
  console.log(`(the moment of the searches: ${new Date(now * 1000).toISOString()})`);
}

/**
 * The raw scans of the distance, without the tool.
 *
 * Three shapes bracket the pipeline: the plain distance over every text
 * with a vector; the same with the collapse of the repeats; the same with
 * a 24-hour window. The candidate SQL of the search itself is run as a
 * subquery, and the outer count forces the distance to be computed for
 * every row (`score < 2` is always true, but the engine cannot know
 * that).
 */
function measureRawScans(ctx: GuideToolContext, now: number): void {
  console.log('\n--- the raw scans of vec_distance_cosine ---');

  const model = readTvGuideSettings(ctx.settings.settings()).embeddings.model;
  const queryText = 'ыыы пррр';
  const vector = ctx.queryCache.get(model, queryText);
  if (!vector) {
    console.log('the vector of the query is not in the cache; the scans are skipped.');
    return;
  }

  const base: SearchRequest = {
    query: queryText,
    keywords: [],
    person: '',
    kinds: [],
    window: { field: 'start' as const, from: null, to: null, onAir: false, onAirFrom: null },
    themes: [],
    regions: [],
    channelIds: [],
    productionCountries: { codes: [], raws: [] },
    yearFrom: null,
    yearTo: null,
    onlyCatchup: false,
    hideRepeats: false,
    preferHd: false,
    sort: 'relevance' as const,
  };
  const options = {
    now,
    timezone: 'UTC',
    snippetChars: 200,
    includeAdult: true,
    meaning: { vector, model },
    meaningWeight: 0.7,
  };

  const shapes: { name: string; request: typeof base }[] = [
    { name: 'plain (no filters, no collapse)', request: base },
    { name: 'with the collapse (no filters)', request: { ...base, hideRepeats: true, preferHd: true } },
    { name: 'with the collapse (24 h window)', request: {
        ...base,
        hideRepeats: true,
        preferHd: true,
        window: { field: 'start' as const, from: now as number, to: (now + 86400) as number, onAir: false, onAirFrom: null },
      } },
  ];

  for (const shape of shapes) {
    const started = Date.now();

    // The plain shape: the flat query, counted by the engine, with the
    // distance forced by the comparison in the outer WHERE.
    if (shape.request === base) {
      const { sql, params } = candidateSql(
        shape.request,
        options,
        { kind: 'vectors', meaning: { vector, model } },
      );
      const row = ctx.db.get<{ n: number; best: number | null }>(
        `SELECT count(*) AS n, min(distance) AS best FROM (${sql}) WHERE distance IS NOT NULL AND distance < 2.0`,
        ...params,
      );
      console.log(
        `${shape.name.padEnd(38)} ${String(row?.n ?? 0).padStart(7)} programmes in ${ms(Date.now() - started)}` +
          `${row?.best === null ? '' : ` (best ${(row?.best ?? 0).toFixed(4)})`}`,
      );
      continue;
    }

    // The collapse shapes: the same query the meaning search runs — the
    // sides without the collapse, the collapse over the union — with the
    // rows counted in JavaScript (a WITH does not sit in a subquery of
    // node:sqlite comfortably).
    const sourceRequest = { ...shape.request, hideRepeats: false, preferHd: false };
    const { sql: sideSql, params: sideParams } = candidateSql(
      sourceRequest,
      options,
      { kind: 'vectors', meaning: { vector, model } },
    );
    const collapsed = collapseOverUnion(shape.request, options, [
      { sql: sideSql, params: sideParams },
    ]);
    const rows = ctx.db.all<{ distance: number | null }>(collapsed.sql, ...collapsed.params);
    const best = rows.reduce(
      (m, row) => (row.distance === null ? m : Math.min(m, row.distance)),
      Number.POSITIVE_INFINITY,
    );
    console.log(
      `${shape.name.padEnd(38)} ${String(rows.length).padStart(7)} programmes in ${ms(Date.now() - started)}` +
        `${Number.isFinite(best) ? ` (best ${best.toFixed(4)})` : ''}`,
    );
  }
}

/** A quantile of a sorted list. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[index] as number;
}

/** The candidate thresholds the accuracy is printed for. */
const THRESHOLDS = [0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5];

/**
 * The threshold of the kind by meaning, against the markers.
 *
 * The texts the provider named itself (х/ф, т/с, …) are the ground truth:
 * for each of them the script computes the distance to the label of its
 * own kind and to the best wrong label, and prints the distribution. A
 * threshold keeps the kinds of the markers when it sits between the two.
 */
async function measureThreshold(db: Db, model: string): Promise<void> {
  console.log('\n--- the threshold of the kind by meaning, against the markers ---');

  const labels: { kind: string; vector: Float32Array }[] = [];
  const { sha256 } = await import('../src/shared/hash.ts');
  for (const [kind, texts] of Object.entries(MEANING_KIND_LABELS)) {
    for (const text of texts) {
      // The key of a query vector is the hash of the model and the text
      // (shared/query-cache.ts). The worker's kind pass put the vectors of
      // the labels there.
      const key = sha256(`${model}\n${text}`);
      const row = db.get<{ embedding: Uint8Array }>(
        'SELECT embedding FROM vec.query_vectors WHERE model = ? AND text_hash = ?',
        model,
        key,
      );
      if (row) labels.push({ kind, vector: fromBlob(row.embedding) });
    }
  }
  if (labels.length === 0) {
    console.log('the vectors of the labels are not in the database; the tuning is skipped.');
    return;
  }

  // The distances of the marker texts: the truth of the provider. One
  // record per text: the kind it truly has, the distance to the label of
  // that kind, and the distance to the best wrong label.
  const records: { kind: string; own: number; wrong: number }[] = [];
  let cursor = '';
  let walked = 0;
  for (;;) {
    const rows = db.all<{ text_hash: string; kind: string; embedding: Uint8Array }>(
      `SELECT t.text_hash AS text_hash, t.kind AS kind, v.embedding AS embedding
         FROM program_texts t
         JOIN vec.vectors v ON v.text_hash = t.embed_hash AND v.model = ?
        WHERE t.kind_source = 'marker' AND t.text_hash > ?
        ORDER BY t.text_hash LIMIT ?`,
      model,
      cursor,
      500,
    );
    if (rows.length === 0) break;
    for (const row of rows) {
      cursor = row.text_hash;
      walked += 1;
      const vector = fromBlob(row.embedding);
      let bestOwn = Number.NaN;
      let bestWrong = Number.POSITIVE_INFINITY;
      for (const label of labels) {
        const distance = cosineDistance(vector, label.vector);
        if (label.kind === row.kind) {
          if (Number.isNaN(bestOwn) || distance < bestOwn) bestOwn = distance;
        } else if (distance < bestWrong) {
          bestWrong = distance;
        }
      }
      if (!Number.isNaN(bestOwn)) records.push({ kind: row.kind, own: bestOwn, wrong: bestWrong });
    }
  }

  if (walked === 0) {
    console.log('no marker text has a vector; the tuning is skipped.');
    return;
  }

  console.log(`marker texts with a vector: ${walked}`);
  const ownAll = records.map((record) => record.own).sort((a, b) => a - b);
  const wrongAll = records.map((record) => record.wrong).sort((a, b) => a - b);
  console.log(
    `distance to the label of the own kind: ` +
      `min ${ownAll[0]?.toFixed(4)}, p50 ${quantile(ownAll, 0.5).toFixed(4)}, ` +
      `p90 ${quantile(ownAll, 0.9).toFixed(4)}, p99 ${quantile(ownAll, 0.99).toFixed(4)}, ` +
      `max ${ownAll[ownAll.length - 1]?.toFixed(4)}`,
  );
  console.log(
    `distance to the best wrong label:      ` +
      `min ${wrongAll[0]?.toFixed(4)}, p10 ${quantile(wrongAll, 0.1).toFixed(4)}, ` +
      `p50 ${quantile(wrongAll, 0.5).toFixed(4)}`,
  );

  const byKind = new Map<string, number[]>();
  for (const record of records) {
    const list = byKind.get(record.kind) ?? [];
    list.push(record.own);
    byKind.set(record.kind, list);
  }
  for (const kind of [...byKind.keys()].sort()) {
    const list = (byKind.get(kind) ?? []).sort((a, b) => a - b);
    console.log(
      `  ${kind.padEnd(16)} n=${String(list.length).padStart(5)}  ` +
        `p50 ${quantile(list, 0.5).toFixed(4)}  p90 ${quantile(list, 0.9).toFixed(4)}  ` +
        `p99 ${quantile(list, 0.99).toFixed(4)}`,
    );
  }

  // At a threshold the pass assigns the kind of the nearest label within
  // it. The assignment is right when the own label is the nearest one;
  // wrong when a wrong label is nearer and still within the threshold; a
  // miss when no label is within it.
  console.log('the kinds of the marker texts at a threshold:');
  for (const threshold of THRESHOLDS) {
    let right = 0;
    let misassigned = 0;
    let missed = 0;
    for (const record of records) {
      const nearestIsOwn = record.own <= record.wrong;
      if (nearestIsOwn && record.own <= threshold) right += 1;
      else if (!nearestIsOwn && record.wrong <= threshold) misassigned += 1;
      else missed += 1;
    }
    const total = Math.max(1, records.length);
    console.log(
      `  ${threshold.toFixed(2)}: right ${(right / total).toFixed(3)}, ` +
        `wrong kind ${(misassigned / total).toFixed(3)}, no kind ${(missed / total).toFixed(3)}`,
    );
  }
}

const isDirect = process.argv[1] !== undefined && process.argv[1].endsWith('measure-tv-meaning.ts');
if (isDirect) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exit(1);
  });
}
