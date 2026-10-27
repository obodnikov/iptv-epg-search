import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { applyCinemaSchema } from '../../src/cinema/schema.ts';
import { refreshCatalog, type ImportOptions } from '../../src/cinema/import.ts';
import { acquireLock } from '../../src/shared/lock.ts';
import { fixture } from '../fixtures/load.ts';
import { testDatabase } from '../helpers.ts';

const catalogue = fixture('import-a.m3u');
const broken = fixture('cinema-broken.m3u');

let server: Server;
let origin = '';

before(async () => {
  server = createServer((request, response) => {
    const path = request.url ?? '/';
    if (path === '/catalogue.m3u') {
      response.writeHead(200, { 'Content-Type': 'audio/x-mpegurl' });
      response.end(catalogue);
      return;
    }
    if (path === '/broken.m3u') {
      response.writeHead(200, { 'Content-Type': 'audio/x-mpegurl' });
      response.end(broken);
      return;
    }
    if (path === '/login') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<html><body>please log in</body></html>');
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the server has no address');
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

function options(url: string, overrides: Partial<ImportOptions> = {}): ImportOptions {
  return {
    cinemaUrl: url,
    excludeCategories: [],
    countryAliases: {},
    trackChanges: true,
    embeddingModel: 'BAAI/bge-m3',
    minTextChars: 0,
    now: 1_800_000_000,
    ...overrides,
  };
}

describe('refreshCatalog', () => {
  it('downloads the catalogue and imports it', async () => {
    const test = testDatabase();
    try {
      applyCinemaSchema(test.db);

      const outcome = await refreshCatalog(
        test.db,
        test.dir,
        options(`${origin}/catalogue.m3u`),
      );

      assert.equal(outcome.ok, true);
      assert.equal(outcome.downloaded, true);
      assert.equal(outcome.titles, 3);
      assert.ok(existsSync(join(test.dir, 'raw', 'catalog.m3u')));
      assert.equal(
        test.db.get<{ found: number }>('SELECT count(*) AS found FROM titles')?.found,
        3,
      );
    } finally {
      test.cleanup();
    }
  });

  it('creates the folder of the download itself', async () => {
    const test = testDatabase();
    try {
      applyCinemaSchema(test.db);

      // The folder of the download is not there yet.
      assert.equal(existsSync(join(test.dir, 'raw')), false);

      const outcome = await refreshCatalog(
        test.db,
        test.dir,
        options(`${origin}/catalogue.m3u`),
      );

      assert.equal(outcome.ok, true);
      assert.ok(existsSync(join(test.dir, 'raw', 'catalog.m3u')));
    } finally {
      test.cleanup();
    }
  });

  it('gives the lock back when it is over', async () => {
    const test = testDatabase();
    try {
      applyCinemaSchema(test.db);

      await refreshCatalog(test.db, test.dir, options(`${origin}/catalogue.m3u`));
      assert.equal(existsSync(join(test.dir, 'refresh.lock')), false);
    } finally {
      test.cleanup();
    }
  });

  it('does nothing when the URL is not set', async () => {
    const test = testDatabase();
    try {
      applyCinemaSchema(test.db);
      const outcome = await refreshCatalog(test.db, test.dir, options(''));
      assert.equal(outcome.ok, false);
      assert.match(outcome.error ?? '', /not set/);
    } finally {
      test.cleanup();
    }
  });

  it('does nothing when another refresh holds the lock', async () => {
    const test = testDatabase();
    try {
      applyCinemaSchema(test.db);
      const lock = acquireLock(join(test.dir, 'refresh.lock'));
      assert.ok(lock);

      const outcome = await refreshCatalog(
        test.db,
        test.dir,
        options(`${origin}/catalogue.m3u`),
      );
      assert.equal(outcome.ok, false);
      assert.match(outcome.error ?? '', /already running/);
    } finally {
      test.cleanup();
    }
  });

  it('keeps the old data when the provider sends a login page', async () => {
    const test = testDatabase();
    try {
      applyCinemaSchema(test.db);

      await refreshCatalog(test.db, test.dir, options(`${origin}/catalogue.m3u`));
      const before = test.db.get<{ found: number }>('SELECT count(*) AS found FROM titles');

      const outcome = await refreshCatalog(test.db, test.dir, options(`${origin}/login`));
      assert.equal(outcome.ok, false);
      assert.match(outcome.error ?? '', /refused|EXTM3U/);

      const after = test.db.get<{ found: number }>('SELECT count(*) AS found FROM titles');
      assert.equal(after?.found, before?.found);
    } finally {
      test.cleanup();
    }
  });

  it('writes nothing when the file of the provider did not change', async () => {
    const test = testDatabase();
    try {
      applyCinemaSchema(test.db);

      const first = await refreshCatalog(test.db, test.dir, options(`${origin}/catalogue.m3u`));
      assert.equal(first.ok, true);
      assert.equal(first.unchanged, false);
      assert.equal(first.titles, 3);

      const second = await refreshCatalog(test.db, test.dir, options(`${origin}/catalogue.m3u`));
      assert.equal(second.ok, true);
      assert.equal(second.unchanged, true);
      assert.equal(second.titles, 0);
    } finally {
      test.cleanup();
    }
  });

  it('writes the catalogue anyway when the caller insists', async () => {
    const test = testDatabase();
    try {
      applyCinemaSchema(test.db);

      await refreshCatalog(test.db, test.dir, options(`${origin}/catalogue.m3u`));
      const second = await refreshCatalog(
        test.db,
        test.dir,
        options(`${origin}/catalogue.m3u`, { force: true }),
      );

      assert.equal(second.ok, true);
      assert.equal(second.unchanged, false);
      assert.equal(second.titles, 3);
    } finally {
      test.cleanup();
    }
  });

  it('reports the phase of the refresh', async () => {
    const test = testDatabase();
    const phases: string[] = [];
    try {
      applyCinemaSchema(test.db);

      await refreshCatalog(
        test.db,
        test.dir,
        options(`${origin}/catalogue.m3u`, {
          onPhase: (phase) => phases.push(phase),
        }),
      );

      assert.deepEqual(phases, ['downloading', 'importing']);
    } finally {
      test.cleanup();
    }
  });

  it('imports the catalogue when the database holds none', async () => {
    const test = testDatabase();
    try {
      applyCinemaSchema(test.db);

      // The first refresh fills the database and writes the metadata of
      // the download.
      await refreshCatalog(test.db, test.dir, options(`${origin}/catalogue.m3u`));
      assert.equal(
        test.db.get<{ found: number }>('SELECT count(*) AS found FROM titles')?.found,
        3,
      );

      // The database is wiped, the metadata of the download stays: the
      // file of the provider did not change, but the catalogue has to be
      // written again.
      test.db.run('DELETE FROM titles');
      test.db.run('DELETE FROM titles_fts');

      const outcome = await refreshCatalog(test.db, test.dir, options(`${origin}/catalogue.m3u`));
      assert.equal(outcome.ok, true);
      assert.equal(outcome.unchanged, false);
      assert.equal(outcome.titles, 3);
      assert.equal(
        test.db.get<{ found: number }>('SELECT count(*) AS found FROM titles')?.found,
        3,
      );
    } finally {
      test.cleanup();
    }
  });

  it('imports the catalogue again when the settings changed', async () => {
    const test = testDatabase();
    try {
      applyCinemaSchema(test.db);

      const first = await refreshCatalog(test.db, test.dir, options(`${origin}/catalogue.m3u`));
      assert.equal(first.titles, 3);

      // The file of the provider did not change, but the settings say that
      // a category is not loaded any more: the catalogue has to be written
      // again.
      const second = await refreshCatalog(
        test.db,
        test.dir,
        options(`${origin}/catalogue.m3u`, { excludeCategories: ['Наши фильмы'] }),
      );
      assert.equal(second.ok, true);
      assert.equal(second.unchanged, false);
      assert.equal(second.titles, 2);

      // The same settings again: nothing changes now.
      const third = await refreshCatalog(
        test.db,
        test.dir,
        options(`${origin}/catalogue.m3u`, { excludeCategories: ['Наши фильмы'] }),
      );
      assert.equal(third.ok, true);
      assert.equal(third.unchanged, true);
      assert.equal(third.titles, 0);
    } finally {
      test.cleanup();
    }
  });

  it('does not remember a catalogue that could not be imported', async () => {
    const test = testDatabase();
    try {
      applyCinemaSchema(test.db);

      // The file of the provider is a catalogue, but it holds no title:
      // the import fails after the download worked.
      const first = await refreshCatalog(test.db, test.dir, options(`${origin}/broken.m3u`));
      assert.equal(first.ok, false);
      assert.match(first.error ?? '', /no title/);

      // The hash of the file is not written down: the next refresh must
      // try again instead of believing that the catalogue is already in
      // the database.
      const second = await refreshCatalog(test.db, test.dir, options(`${origin}/broken.m3u`));
      assert.equal(second.ok, false);
      assert.equal(second.unchanged, false);

      // The good catalogue is imported after all.
      const third = await refreshCatalog(test.db, test.dir, options(`${origin}/catalogue.m3u`));
      assert.equal(third.ok, true);
      assert.equal(third.titles, 3);
    } finally {
      test.cleanup();
    }
  });
});
