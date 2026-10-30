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
import { KIND_MARKERS, OTHER_MARKERS } from '../src/tv-guide/kind.ts';
import { readTvGuideSettings, TV_GUIDE_SETTINGS_SPEC } from '../src/tv-guide/config.ts';
import { mergeSettings } from '../src/shared/settings.ts';
import { importOptionsOf, type ImportOptions } from '../src/tv-guide/import-options.ts';

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

/**
 * The wildcards of LIKE are not wildcards here.
 */
function escapeLike(text: string): string {
  return text.replace(/[%_\\]/g, (char) => `\\${char}`);
}

/**
 * Print what the derived fields of the guide hold.
 *
 * The numbers are the ones the design asks for (tv-guide-server.md §10,
 * phase T2): the distribution of the kinds, the share of the texts with
 * the countries and the year of the film ending, and the venues that were
 * found.
 */
function printCoverage(db: Db): void {
  console.log('');
  console.log('--- the derived fields ---');

  const kinds = db.all<{ kind: string; source: string; found: number }>(
    `SELECT kind, kind_source AS source, count(*) AS found
       FROM program_texts
      GROUP BY kind, kind_source
      ORDER BY found DESC`,
  );
  console.log('kinds:');
  for (const row of kinds) {
    console.log(`  ${row.kind.padEnd(16)} ${String(row.found).padStart(7)}  (${row.source})`);
  }

  const markers = [...Object.keys(KIND_MARKERS), ...OTHER_MARKERS];
  // The markers are bound, not pasted into the SQL: the table is data.
  const markerRows = db.all<{ marker: string; found: number }>(
    `SELECT
        CASE
          ${markers.map(() => 'WHEN title LIKE ? ESCAPE \'\\\' THEN ?').join('\n          ')}
          ELSE '(none)'
        END AS marker,
        count(*) AS found
       FROM program_texts
      GROUP BY marker
      ORDER BY found DESC`,
    ...markers.flatMap((marker) => [`${escapeLike(marker)}%`, marker]),
  );
  console.log('markers left in the title:');
  for (const row of markerRows) {
    console.log(`  ${row.marker.padEnd(16)} ${String(row.found).padStart(7)}`);
  }

  const withYear = db.get<{ found: number }>(
    'SELECT count(*) AS found FROM program_texts WHERE year IS NOT NULL',
  );
  const withDirector = db.get<{ found: number }>(
    'SELECT count(*) AS found FROM program_texts WHERE directors IS NOT NULL',
  );
  const withCast = db.get<{ found: number }>(
    'SELECT count(*) AS found FROM program_texts WHERE cast_names IS NOT NULL',
  );
  const withGenres = db.get<{ found: number }>(
    'SELECT count(*) AS found FROM program_texts WHERE genres IS NOT NULL',
  );
  const withCountries = db.get<{ found: number }>(
    `SELECT count(DISTINCT text_hash) AS found
       FROM text_countries
      WHERE code IS NOT NULL`,
  );
  const total = db.get<{ found: number }>('SELECT count(*) AS found FROM program_texts')?.found ?? 0;
  console.log(`texts:                ${total}`);
  console.log(`  with a year:        ${withYear?.found ?? 0}`);
  console.log(`  with a director:    ${withDirector?.found ?? 0}`);
  console.log(`  with a cast:        ${withCast?.found ?? 0}`);
  console.log(`  with genres:        ${withGenres?.found ?? 0}`);
  console.log(`  with countries:     ${withCountries?.found ?? 0}`);

  const countries = db.all<{ raw: string; found: number }>(
    `SELECT raw, count(*) AS found
       FROM text_countries
      GROUP BY raw
      ORDER BY found DESC
      LIMIT 12`,
  );
  console.log('countries:');
  for (const row of countries) {
    console.log(`  ${row.raw.padEnd(24)} ${String(row.found).padStart(7)}`);
  }

  const venues = db.all<{ venue: string; found: number }>(
    `SELECT venue, count(*) AS found
       FROM program_texts
      WHERE venue IS NOT NULL
      GROUP BY venue
      ORDER BY found DESC
      LIMIT 12`,
  );
  console.log('venues:');
  for (const row of venues) {
    console.log(`  ${row.venue.padEnd(30)} ${String(row.found).padStart(7)}`);
  }

  const themes = db.all<{ theme: string; region: string; found: number }>(
    `SELECT COALESCE(theme, '(none)') AS theme, COALESCE(region, '(none)') AS region,
            count(*) AS found
       FROM channels
      GROUP BY theme, region
      ORDER BY found DESC`,
  );
  console.log('channels by theme and region:');
  for (const row of themes) {
    console.log(`  ${row.theme.padEnd(14)} ${row.region.padEnd(8)} ${String(row.found).padStart(6)}`);
  }

  const shifts = db.all<{ timeshift_h: number; found: number }>(
    `SELECT timeshift_h, count(*) AS found
       FROM channels
      GROUP BY timeshift_h
      ORDER BY timeshift_h`,
  );
  console.log('channels by time shift:');
  for (const row of shifts) {
    console.log(`  ${String(row.timeshift_h).padStart(2)} h  ${String(row.found).padStart(6)}`);
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

/**
 * The settings of the working folder, when it holds one.
 *
 * The overrides of the groups are part of them, and the import needs
 * them: the theme and the region of a group may be set by hand.
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

  // The merge with the template happens always: a file that is not there
  // means the defaults, not nothing.
  return mergeSettings(raw, TV_GUIDE_SETTINGS_SPEC).settings;
}

const settings = readTvGuideSettings(settingsOf(dataDir));

const options: ImportOptions = {
  ...importOptionsOf(settings, args.now ?? Math.floor(Date.now() / 1000), {
    // The working folder: the import takes the lock of it, so that two
    // runs of the script never write at once.
    dataDir,
  }),
  // The option of the script wins over the setting of the file.
  ...(args.pastDays === null ? {} : { pastDays: args.pastDays }),
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
  printCoverage(db);
}

db.close();
if (ownDataDir) rmSync(dataDir, { recursive: true, force: true });
if (!outcome.ok) process.exit(1);
