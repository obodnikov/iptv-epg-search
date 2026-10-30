/**
 * import-tv-real-data.ts - import a real playlist and a real guide and
 * print what they cost.
 *
 * The numbers are recorded in mcp-servers/docs/design/tv-guide-server.md
 * §10 (phase T1). They are not asserted anywhere: the files are the
 * user's own provider data and never enter the repository.
 *
 * Usage:
 *   npm run import-tv-real-data -- [<playlist>] [<epg>] [--data-dir <dir>]
 *                                   [--now <ISO date>] [--past-days <n>]
 *
 * The defaults are `../tmp/playlist.m3u` and `../tmp/4a27b28d` (the June
 * 2026 snapshot). The database lives in a temporary folder unless
 * `--data-dir` names one.
 *
 * The retention window runs from `now`: the snapshot of June 2026 needs
 * `--now` inside its window, otherwise every programme is too old and the
 * database stays empty. That is the honest behaviour of a refresh; the
 * option is for the measurement only.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { openDatabase, type Db } from '../src/shared/db.ts';
import { applyTvGuideSchema } from '../src/tv-guide/schema.ts';
import { importTvGuideFiles } from '../src/tv-guide/import.ts';
import { parsePlaylist } from '../src/tv-guide/playlist.ts';
import type { ImportOptions } from '../src/tv-guide/import-options.ts';

const DEFAULT_PLAYLIST = resolve(process.cwd(), '..', 'tmp', 'playlist.m3u');
const DEFAULT_EPG = resolve(process.cwd(), '..', 'tmp', '4a27b28d');

interface Arguments {
  playlist: string;
  epg: string;
  dataDir: string | null;
  now: number | null;
  pastDays: number | null;
}

function readArguments(argv: string[]): Arguments {
  const result: Arguments = {
    playlist: DEFAULT_PLAYLIST,
    epg: DEFAULT_EPG,
    dataDir: null,
    now: null,
    pastDays: null,
  };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
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
    if (arg.startsWith('--')) continue;
    positional.push(arg);
  }

  if (positional[0] !== undefined) result.playlist = resolve(positional[0]);
  if (positional[1] !== undefined) result.epg = resolve(positional[1]);
  return result;
}

/** Sample the resident set size while the import runs. */
function startRssSampler(): { stop(): number } {
  let peak = process.memoryUsage().rss;
  const timer = setInterval(() => {
    const rss = process.memoryUsage().rss;
    if (rss > peak) peak = rss;
  }, 50);
  timer.unref();
  return {
    stop(): number {
      clearInterval(timer);
      const rss = process.memoryUsage().rss;
      if (rss > peak) peak = rss;
      return peak;
    },
  };
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

function printPlaylistVariants(): void {
  for (const name of ['list.m3u', 'playlist_mpegts.m3u']) {
    const path = resolve(process.cwd(), '..', 'tmp', name);
    if (!existsSync(path)) continue;
    const parsed = parsePlaylist(readFileSyncOf(path));
    console.log(
      `${name}: channels=${parsed.channels.length} skippedNoTvgId=${parsed.skippedNoTvgId} ` +
        `duplicates=${parsed.duplicates} incomplete=${parsed.incomplete} ` +
        `bareHeader=${Object.keys(parsed.header).length === 0}`,
    );
  }
}

function readFileSyncOf(path: string): string {
  return readFileSync(path, 'utf8');
}

const args = readArguments(process.argv.slice(2));

if (!existsSync(args.playlist) || !existsSync(args.epg)) {
  console.error(`files not found: ${args.playlist} and/or ${args.epg}`);
  process.exit(1);
}

const dataDir = args.dataDir ?? mkdtempSync(join(tmpdir(), 'iptv-tv-guide-real-'));
const ownDataDir = args.dataDir === null;

const db: Db = openDatabase({ path: join(dataDir, 'data.sqlite') });
applyTvGuideSchema(db);

const options: ImportOptions = {
  epgUrl: '',
  liveUrl: '',
  excludeGroups: ['XXX (18+)'],
  epgDefaultOffset: '+0000',
  pastDays: args.pastDays ?? 7,
  embeddingModel: 'BAAI/bge-m3',
  minTextChars: 40,
  embeddingsEnabled: true,
  now: args.now ?? Math.floor(Date.now() / 1000),
  // The working folder: the import takes the lock of it, so that two
  // runs of the script never write at once.
  dataDir,
};

console.log(`playlist: ${args.playlist}`);
console.log(`epg:      ${args.epg}`);
console.log(`data dir: ${dataDir}`);

printPlaylistVariants();

const sampler = startRssSampler();
const started = Date.now();

const outcome = await importTvGuideFiles(db, { playlistPath: args.playlist, epgPath: args.epg }, options);

const durationMs = Date.now() - started;
const peakRss = sampler.stop();

console.log('');
console.log(`ok:        ${outcome.ok}${outcome.ok ? '' : ` — ${outcome.error}`}`);
if (outcome.ok) {
  const write = outcome.write;
  console.log(`channels:  ${write?.channels} (dropped by group: ${write?.droppedGroupChannels})`);
  console.log(`programmes:${write?.programmes} (dropped by group: ${write?.droppedGroupProgrammes}, too old: ${write?.droppedOld})`);
  console.log(`texts:     ${write?.texts} (new: ${write?.newTexts}, fts rows: ${write?.ftsRows})`);
  console.log(`bad times: ${write?.badTimes}, default offsets: ${write?.defaultOffsetTimes}, unknown channel: ${write?.unknownChannel}, duplicates: ${write?.duplicates}`);
  console.log(`queue:     ${write?.queueSize}`);
  const first = write?.windowStart === null || write?.windowStart === undefined ? '?' : new Date(write.windowStart * 1000).toISOString();
  const last = write?.windowEnd === null || write?.windowEnd === undefined ? '?' : new Date(write.windowEnd * 1000).toISOString();
  console.log(`window:    ${first} … ${last}`);
  console.log(`import:    ${(durationMs / 1000).toFixed(1)} s`);
  console.log(`peak RSS:  ${mb(peakRss)}`);
  console.log(`data size: ${mb(dirSize(dataDir))}`);
}

db.close();
if (ownDataDir) rmSync(dataDir, { recursive: true, force: true });
if (!outcome.ok) process.exit(1);
