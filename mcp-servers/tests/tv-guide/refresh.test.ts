/**
 * The refresh of the guide: downloads, the unchanged skip, the EPG URL of
 * the playlist header, the lock and the failure paths.
 *
 * The downloads run against a local HTTP server, the way the download
 * tests do. The provider is never contacted.
 */

import { strict as assert } from 'node:assert';
import { gzipSync } from 'node:zlib';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { after, before, describe, it } from 'node:test';

import { fixture } from '../fixtures/load.ts';
import { openDatabase, type Db } from '../../src/shared/db.ts';
import { ensureVectorSchema } from '../../src/shared/vectors.ts';
import { applyTvGuideSchema } from '../../src/tv-guide/schema.ts';
import { refreshTvGuide } from '../../src/tv-guide/import.ts';
import { acquireLock } from '../../src/shared/lock.ts';
import { writeRawMeta } from '../../src/shared/download.ts';
import { sha256 } from '../../src/shared/hash.ts';
import type { ImportOptions } from '../../src/tv-guide/import-options.ts';

const EPG = fixture('tv-guide-epg.xml');
const PLAYLIST = fixture('tv-guide-playlist.m3u');
/** The playlist without its header line. */
const PLAYLIST_BODY = PLAYLIST.split('\n').slice(1).join('\n');

/** 2026-06-14 12:00 UTC, inside the window of the fixture guide. */
const NOW = Math.floor(Date.parse('2026-06-14T12:00:00Z') / 1000);

const dirs: string[] = [];
let server: Server;
let origin = '';

before(async () => {
  server = createServer((request, response) => {
    const path = request.url ?? '/';
    if (path === '/playlist') {
      response.writeHead(200, { 'Content-Type': 'audio/x-mpegurl' });
      response.end(PLAYLIST);
      return;
    }
    if (path === '/playlist-local') {
      // The same playlist, but its url-tvg points at this server, so that
      // the header resolution of the refresh can be tested.
      response.writeHead(200, { 'Content-Type': 'audio/x-mpegurl' });
      response.end(`#EXTM3U url-tvg="${origin}/epg" catchup-type="shift"\n${PLAYLIST_BODY}`);
      return;
    }
    if (path === '/epg') {
      response.writeHead(200, { 'Content-Type': 'application/xml' });
      response.end(EPG);
      return;
    }
    if (path === '/epg.gz') {
      response.writeHead(200, { 'Content-Type': 'application/gzip' });
      response.end(gzipSync(Buffer.from(EPG, 'utf8')));
      return;
    }
    if (path === '/login') {
      // A login page instead of the guide: the download check refuses it.
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<html><body>please log in</body></html>');
      return;
    }
    if (path === '/epg-truncated') {
      response.writeHead(200, { 'Content-Type': 'application/xml' });
      response.end(fixture('tv-guide-epg-broken.xml'));
      return;
    }
    response.writeHead(404);
    response.end('no');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address && typeof address === 'object') {
    origin = `http://127.0.0.1:${address.port}`;
  }
});

after(() => {
  server.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function dataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'iptv-tv-guide-refresh-'));
  dirs.push(dir);
  return dir;
}

function options(overrides: Partial<ImportOptions> & { dataDir: string }): ImportOptions {
  return {
    epgUrl: `${origin}/epg`,
    liveUrl: '',
    excludeGroups: [],
    epgDefaultOffset: '+0000',
    pastDays: 7,
    embeddingModel: 'BAAI/bge-m3',
    minTextChars: 0,
    embeddingsEnabled: true,
    now: NOW,
    ...overrides,
  };
}

function database(dir: string, vectors = false): Db {
  const db = openDatabase({
    path: join(dir, 'data.sqlite'),
    vectorsPath: vectors ? join(dir, 'vectors.sqlite') : null,
  });
  applyTvGuideSchema(db);
  if (vectors) ensureVectorSchema(db);
  return db;
}

function programmeCount(db: Db): number {
  return db.get<{ found: number }>('SELECT count(*) AS found FROM programmes')?.found ?? 0;
}

function fileExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

describe('the refresh of the guide', () => {
  it('answers "not configured" when neither URL is set', async () => {
    const dir = dataDir();
    const db = database(dir);
    try {
      const outcome = await refreshTvGuide(db, dir, options({ epgUrl: '', liveUrl: '', dataDir: dir }));
      assert.equal(outcome.ok, false);
      assert.match(outcome.error ?? '', /not configured/);
      assert.equal(programmeCount(db), 0);
    } finally {
      db.close();
    }
  });

  it('imports a plain guide from the settings URL', async () => {
    const dir = dataDir();
    const db = database(dir);
    try {
      const outcome = await refreshTvGuide(db, dir, options({ dataDir: dir }));
      assert.equal(outcome.ok, true);
      assert.equal(outcome.error, undefined);
      assert.equal(outcome.epgUrlSource, 'settings');
      assert.equal(outcome.unchanged, false);
      assert.equal(outcome.write?.programmes, 6);
      assert.equal(programmeCount(db), 6);
    } finally {
      db.close();
    }
  });

  it('imports a gzipped guide', async () => {
    const dir = dataDir();
    const db = database(dir);
    try {
      const outcome = await refreshTvGuide(db, dir, options({ epgUrl: `${origin}/epg.gz`, dataDir: dir }));
      assert.equal(outcome.ok, true);
      assert.equal(outcome.error, undefined);
      assert.equal(outcome.write?.programmes, 6);
    } finally {
      db.close();
    }
  });

  it('takes the EPG URL from the playlist header when the setting is empty', async () => {
    const dir = dataDir();
    const db = database(dir);
    try {
      const outcome = await refreshTvGuide(
        db,
        dir,
        options({ epgUrl: '', liveUrl: `${origin}/playlist-local`, dataDir: dir }),
      );
      assert.equal(outcome.ok, true);
      assert.equal(outcome.error, undefined);
      assert.equal(outcome.epgUrlSource, 'playlist-header');
      assert.equal(outcome.write?.channels, 5);
      assert.equal(outcome.write?.programmes, 6);
      // The catch-up type of the header reached the channels.
      const catchup = db.get<{ found: number }>(
        "SELECT count(*) AS found FROM channels WHERE catchup_type = 'shift'",
      );
      assert.equal(catchup?.found, 4);
    } finally {
      db.close();
    }
  });

  it('refuses a download that is not a guide, and keeps the old data', async () => {
    const dir = dataDir();
    const db = database(dir);
    try {
      const good = await refreshTvGuide(db, dir, options({ dataDir: dir }));
      assert.equal(good.ok, true);
      assert.equal(good.error, undefined);
      const before = programmeCount(db);

      const outcome = await refreshTvGuide(
        db,
        dir,
        options({ epgUrl: `${origin}/login`, force: true, dataDir: dir }),
      );
      assert.equal(outcome.ok, false);
      assert.match(outcome.error ?? '', /was refused/);
      assert.equal(programmeCount(db), before);
    } finally {
      db.close();
    }
  });

  it('a guide that breaks mid-parse leaves the old data', async () => {
    const dir = dataDir();
    const db = database(dir);
    try {
      const good = await refreshTvGuide(db, dir, options({ dataDir: dir }));
      assert.equal(good.ok, true);
      assert.equal(good.error, undefined);
      const before = programmeCount(db);

      const outcome = await refreshTvGuide(
        db,
        dir,
        options({ epgUrl: `${origin}/epg-truncated`, force: true, dataDir: dir }),
      );
      assert.equal(outcome.ok, false);
      assert.match(outcome.error ?? '', /could not be read/);
      assert.equal(programmeCount(db), before);
    } finally {
      db.close();
    }
  });

  it('skips the import when both downloads did not change', async () => {
    const dir = dataDir();
    const db = database(dir);
    try {
      const first = await refreshTvGuide(db, dir, options({ dataDir: dir }));
      assert.equal(first.ok, true);
      assert.equal(first.error, undefined);

      const second = await refreshTvGuide(db, dir, options({ dataDir: dir }));
      assert.equal(second.ok, true);
      assert.equal(second.unchanged, true);
      // The import was skipped; the write result only carries the queue
      // bookkeeping of the unchanged run.
      assert.equal(second.write?.droppedOld, 0);
      assert.equal(second.write?.programmes, 0);

      // The metadata of both sources is there.
      assert.equal(fileExists(join(dir, 'raw', 'meta-playlist.json')), false);
      assert.equal(fileExists(join(dir, 'raw', 'meta-epg.json')), true);
    } finally {
      db.close();
    }
  });

  it('a change of the settings forces the import of an unchanged download', async () => {
    const dir = dataDir();
    const db = database(dir);
    try {
      const first = await refreshTvGuide(db, dir, options({ dataDir: dir }));
      assert.equal(first.ok, true);
      assert.equal(first.error, undefined);

      const second = await refreshTvGuide(db, dir, options({ pastDays: 3, dataDir: dir }));
      assert.equal(second.ok, true);
      assert.equal(second.error, undefined);
      assert.equal(second.unchanged, false);
      assert.notEqual(second.write, null);
    } finally {
      db.close();
    }
  });

  it('imports again when the database holds no guide, even when the files did not change', async () => {
    const dir = dataDir();
    const db = database(dir);
    try {
      const first = await refreshTvGuide(db, dir, options({ dataDir: dir }));
      assert.equal(first.ok, true);
      assert.equal(first.error, undefined);

      // Somebody wiped the guide: an unchanged download must still be
      // imported (the database has to hold the guide, iptv-mcp-servers.md
      // §6.4).
      db.run('DELETE FROM programmes');

      const second = await refreshTvGuide(db, dir, options({ dataDir: dir }));
      assert.equal(second.ok, true);
      assert.equal(second.error, undefined);
      assert.equal(second.unchanged, false);
      assert.equal(programmeCount(db), 6);
    } finally {
      db.close();
    }
  });

  it('the metadata of a refused import is not written', async () => {
    const dir = dataDir();
    const db = database(dir);
    try {
      const outcome = await refreshTvGuide(
        db,
        dir,
        options({ epgUrl: `${origin}/login`, dataDir: dir }),
      );
      assert.equal(outcome.ok, false);

      // The EPG metadata is missing; nothing claims the file is in the
      // database.
      assert.equal(fileExists(join(dir, 'raw', 'meta-epg.json')), false);
    } finally {
      db.close();
    }
  });

  it('answers "already running" when another process holds the lock', async () => {
    const dir = dataDir();
    const db = database(dir);
    try {
      // The raw metadata of a finished import: without the lock the refresh
      // would find the same download and answer "unchanged"; the lock
      // stops it before that.
      mkdirSync(join(dir, 'raw'), { recursive: true });
      await writeRawMeta(join(dir, 'raw', 'meta-epg.json'), {
        fetched_at: NOW,
        sha256: sha256(EPG),
        bytes: EPG.length,
        url_hash: sha256(`${origin}/epg`),
        settings_hash: sha256(
          JSON.stringify({
            epgUrl: `${origin}/epg`,
            liveUrl: '',
            excludeGroups: [],
            epgDefaultOffset: '+0000',
            pastDays: 7,
            embeddingModel: 'BAAI/bge-m3',
            minTextChars: 0,
          }),
        ),
      });

      const lock = acquireLock(join(dir, 'refresh.lock'));
      assert.notEqual(lock, null);
      try {
        const outcome = await refreshTvGuide(db, dir, options({ dataDir: dir }));
        assert.equal(outcome.ok, false);
        assert.match(outcome.error ?? '', /already running/);
      } finally {
        lock?.release();
      }
    } finally {
      db.close();
    }
  });

  it('applies the retention window when the download did not change', async () => {
    const dir = dataDir();
    const db = database(dir);
    try {
      // The first import: all six programmes are inside the window of
      // seven days.
      const first = await refreshTvGuide(db, dir, options({ dataDir: dir }));
      assert.equal(first.ok, true);
      assert.equal(first.error, undefined);
      assert.equal(programmeCount(db), 6);

      // One week later, the same files: the import is skipped, but the
      // retention window has moved, and five of the programmes have
      // fallen out of it.
      const second = await refreshTvGuide(
        db,
        dir,
        options({ now: Math.floor(Date.parse('2026-06-21T12:00:00Z') / 1000), dataDir: dir }),
      );
      assert.equal(second.ok, true);
      assert.equal(second.error, undefined);
      assert.equal(second.unchanged, true);
      assert.equal(second.write?.droppedOld, 5);
      assert.equal(second.write?.removedTexts, 4);
      assert.equal(programmeCount(db), 1);
    } finally {
      db.close();
    }
  });

  it('switching the embeddings on rebuilds the queue of an unchanged download', async () => {
    const dir = dataDir();
    // The vectors are attached: a text without a vector goes into the
    // queue when the embeddings are on.
    const db = database(dir, true);
    try {
      const first = await refreshTvGuide(db, dir, options({ embeddingsEnabled: false, dataDir: dir }));
      assert.equal(first.ok, true);
      assert.equal(first.error, undefined);
      assert.equal(first.write?.queueSize, 0);

      // The same files, but the embeddings are on now: the settings
      // signature changed, the import runs, and the queue is filled.
      const second = await refreshTvGuide(db, dir, options({ dataDir: dir }));
      assert.equal(second.ok, true);
      assert.equal(second.error, undefined);
      assert.equal(second.unchanged, false);
      // The five distinct texts have no vectors for the active model yet.
      assert.equal(second.write?.queueSize, 5);
    } finally {
      db.close();
    }
  });

  it('a changed embedding model leaves only the rows of the active model', async () => {
    const dir = dataDir();
    const db = database(dir, true);
    try {
      const first = await refreshTvGuide(
        db,
        dir,
        options({ embeddingModel: 'model-a', dataDir: dir }),
      );
      assert.equal(first.ok, true);
      assert.equal(first.error, undefined);
      assert.equal(first.write?.queueSize, 5);

      const second = await refreshTvGuide(
        db,
        dir,
        options({ embeddingModel: 'model-b', dataDir: dir }),
      );
      assert.equal(second.ok, true);
      assert.equal(second.error, undefined);
      assert.equal(second.unchanged, false);

      const rows = db.all<{ model: string }>('SELECT DISTINCT model FROM vector_queue');
      assert.deepEqual(rows.map((row) => row.model), ['model-b']);
      assert.equal(second.write?.queueSize, 5);
    } finally {
      db.close();
    }
  });

  it('the raw files of the download are kept in the working folder', async () => {
    const dir = dataDir();
    const db = database(dir);
    try {
      const outcome = await refreshTvGuide(
        db,
        dir,
        options({ epgUrl: '', liveUrl: `${origin}/playlist-local`, dataDir: dir }),
      );
      assert.equal(outcome.ok, true);
      assert.equal(outcome.error, undefined);
      assert.equal(readFileSync(join(dir, 'raw', 'playlist.m3u'), 'utf8'),
        `#EXTM3U url-tvg="${origin}/epg" catchup-type="shift"\n${PLAYLIST_BODY}`);
    } finally {
      db.close();
    }
  });
});
