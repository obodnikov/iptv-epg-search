/**
 * embedder.test.ts - the worker that embeds the texts of the catalogue.
 *
 * The worker runs in the background: it takes the texts of the queue, asks
 * the service for their vectors and writes them (design: cinema-server.md
 * §4 step 8).
 */

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { createFakeEmbedder } from '../../src/shared/embeddings.ts';
import { Logger } from '../../src/shared/log.ts';
import { SettingsStore } from '../../src/shared/settings.ts';
import { countVectors, ensureVectorSchema } from '../../src/shared/vectors.ts';
import { CINEMA_SETTINGS_SPEC, CINEMA_SETTINGS_TEMPLATE } from '../../src/cinema/config.ts';
import { createEmbedder, type Embedder } from '../../src/cinema/embedder.ts';
import { importCatalogText } from '../../src/cinema/import.ts';
import { applyCinemaSchema } from '../../src/cinema/schema.ts';
import { fixture } from '../fixtures/load.ts';
import { testDatabase, type TestDatabase } from '../helpers.ts';

const catalogue = fixture('import-a.m3u');

/**
 * The options of the import of the test.
 */
function importOptions(model = 'BAAI/bge-m3') {
  return {
    cinemaUrl: '',
    excludeCategories: [],
    countryAliases: {},
    trackChanges: true,
    embeddingModel: model,
    minTextChars: 0,
    now: 1_800_000_000,
  };
}

/**
 * A database with the catalogue of the fixture and the queue of the texts.
 */
function withCatalogue(minTextChars = 0): TestDatabase {
  const test = testDatabase(true);
  applyCinemaSchema(test.db);
  ensureVectorSchema(test.db);

  const outcome = importCatalogText(test.db, catalogue, {
    ...importOptions(),
    minTextChars,
  });
  if (!outcome.ok) throw new Error(`the fixture could not be imported: ${outcome.error}`);
  return test;
}

/**
 * A worker on a database.
 */
function makeWorker(
  test: TestDatabase,
  settings: Record<string, unknown> = {},
  available = true,
): Embedder {
  const path = join(test.dir, 'settings.json');
  writeFileSync(
    path,
    `${JSON.stringify({ ...CINEMA_SETTINGS_TEMPLATE, ...settings }, null, 2)}\n`,
    { mode: 0o600 },
  );

  const store = new SettingsStore(path, CINEMA_SETTINGS_SPEC);
  const logger = new Logger(join(test.dir, 'logs', 'server.log'), 'error');

  return createEmbedder({
    db: test.db,
    dataDir: test.dir,
    settings: store,
    logger,
    embedder: available
      ? createFakeEmbedder({ model: 'BAAI/bge-m3' })
      : { model: 'BAAI/bge-m3', available: false, embed: async () => null, embedMany: async () => null },
  });
}

/**
 * Wait until the embedding run is over.
 */
async function waitFor(worker: Embedder, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!worker.status().running) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`the embedding run did not finish in ${timeoutMs} ms`);
}

/**
 * The number of the texts in the queue.
 */
function queued(test: TestDatabase, model = 'BAAI/bge-m3'): number {
  return (
    test.db.get<{ found: number }>(
      'SELECT count(*) AS found FROM vector_queue WHERE model = ?',
      model,
    )?.found ?? 0
  );
}

describe('the worker of the embeddings', () => {
  it('empties the queue and writes the vectors', async () => {
    const test = withCatalogue();
    try {
      assert.ok(queued(test) > 0, 'the import did not fill the queue');

      const worker = makeWorker(test);
      assert.equal(worker.start(), 'started');

      await waitFor(worker);

      assert.equal(queued(test), 0);
      assert.equal(countVectors(test.db, 'BAAI/bge-m3'), 3);
      assert.equal(worker.status().phase, 'done');
      assert.equal(worker.status().done, 3);
    } finally {
      test.cleanup();
    }
  });

  it('does nothing when the key is missing', async () => {
    const test = withCatalogue();
    try {
      const worker = makeWorker(test, {}, false);
      assert.equal(worker.start(), 'disabled');

      // The queue is untouched: the texts are embedded when the key is
      // there.
      assert.ok(queued(test) > 0);
      assert.equal(countVectors(test.db, 'BAAI/bge-m3'), 0);
    } finally {
      test.cleanup();
    }
  });

  it('does nothing when the embeddings are switched off', async () => {
    const test = withCatalogue();
    try {
      const worker = makeWorker(test, {
        embeddings: { ...(CINEMA_SETTINGS_TEMPLATE['embeddings'] as object), enabled: false },
      });

      assert.equal(worker.start(), 'disabled');
      assert.equal(countVectors(test.db, 'BAAI/bge-m3'), 0);
    } finally {
      test.cleanup();
    }
  });

  it('leaves the short texts alone', async () => {
    const test = withCatalogue(10_000);
    try {
      // Every text of the fixture is shorter than the limit, so nothing is
      // queued at all.
      assert.equal(queued(test), 0);

      const worker = makeWorker(test, {
        embeddings: {
          ...(CINEMA_SETTINGS_TEMPLATE['embeddings'] as object),
          minTextChars: 10_000,
        },
      });
      assert.equal(worker.start(), 'started');
      await waitFor(worker);

      assert.equal(countVectors(test.db, 'BAAI/bge-m3'), 0);
    } finally {
      test.cleanup();
    }
  });

  it('runs only once at a time', async () => {
    const test = withCatalogue();
    try {
      const worker = makeWorker(test);
      assert.equal(worker.start(), 'started');
      assert.equal(worker.start(), 'already_running');

      await waitFor(worker);
    } finally {
      test.cleanup();
    }
  });

  it('reports the state of the run', async () => {
    const test = withCatalogue();
    try {
      const worker = makeWorker(test);
      const before = worker.status();

      assert.equal(before.running, false);
      assert.equal(before.phase, 'idle');
      assert.equal(before.model, 'BAAI/bge-m3');
      assert.ok(before.pending > 0);

      worker.start();
      await waitFor(worker);

      const after = worker.status();
      assert.equal(after.running, false);
      assert.equal(after.phase, 'done');
      assert.equal(after.pending, 0);
      assert.equal(after.last_error, null);
    } finally {
      test.cleanup();
    }
  });

  it('keeps the failure of the service in the state', async () => {
    const test = withCatalogue();
    try {
      const path = join(test.dir, 'settings.json');
      writeFileSync(
        path,
        `${JSON.stringify({ ...CINEMA_SETTINGS_TEMPLATE }, null, 2)}\n`,
        { mode: 0o600 },
      );

      const store = new SettingsStore(path, CINEMA_SETTINGS_SPEC);
      const logger = new Logger(join(test.dir, 'logs', 'server.log'), 'error');
      const worker = createEmbedder({
        db: test.db,
        dataDir: test.dir,
        settings: store,
        logger,
        // One attempt: the test does not wait for the retries.
        batchAttempts: 1,
        embedder: {
          model: 'BAAI/bge-m3',
          available: true,
          embed: async () => null,
          embedMany: async () => null,
        },
      });

      worker.start();
      await waitFor(worker);

      const status = worker.status();
      assert.equal(status.phase, 'failed');
      assert.ok(status.last_error);
      // The texts are still in the queue: the next run takes them again.
      assert.ok(queued(test) > 0);
    } finally {
      test.cleanup();
    }
  });

  it('names the reason of the failure of the service', async () => {
    const test = withCatalogue();
    try {
      const path = join(test.dir, 'settings.json');
      writeFileSync(
        path,
        `${JSON.stringify({ ...CINEMA_SETTINGS_TEMPLATE }, null, 2)}\n`,
        { mode: 0o600 },
      );

      const store = new SettingsStore(path, CINEMA_SETTINGS_SPEC);
      const logger = new Logger(join(test.dir, 'logs', 'server.log'), 'error');
      const worker = createEmbedder({
        db: test.db,
        dataDir: test.dir,
        settings: store,
        logger,
        batchAttempts: 1,
        embedder: {
          model: 'BAAI/bge-m3',
          available: true,
          embed: async () => null,
          embedMany: async () => null,
          // The reason of the service: without it the run only says that
          // "the service did not answer every text".
          lastError: 'the embedding service answered with the status 429',
        },
      });

      worker.start();
      await waitFor(worker);

      const status = worker.status();
      assert.equal(status.phase, 'failed');
      assert.match(String(status.last_error), /did not answer every text/);
      assert.match(String(status.last_error), /429/);
    } finally {
      test.cleanup();
    }
  });

  it('asks for a batch again when the service does not answer it', async () => {
    const test = withCatalogue();
    try {
      const path = join(test.dir, 'settings.json');
      writeFileSync(
        path,
        `${JSON.stringify({ ...CINEMA_SETTINGS_TEMPLATE }, null, 2)}\n`,
        { mode: 0o600 },
      );

      const store = new SettingsStore(path, CINEMA_SETTINGS_SPEC);
      const logger = new Logger(join(test.dir, 'logs', 'server.log'), 'error');

      let calls = 0;
      const worker = createEmbedder({
        db: test.db,
        dataDir: test.dir,
        settings: store,
        logger,
        batchAttempts: 3,
        batchDelaysMs: [1, 1],
        embedder: {
          model: 'BAAI/bge-m3',
          available: true,
          embed: async () => null,
          embedMany: async (texts: string[]) => {
            calls += 1;
            // The first two answers are empty: the third one works.
            if (calls < 3) return null;
            return texts.map(() => new Float32Array(4));
          },
        },
      });

      worker.start();
      await waitFor(worker);

      const status = worker.status();
      assert.equal(status.phase, 'done');
      assert.equal(calls, 3);
      // The texts are out of the queue: they were embedded.
      assert.equal(queued(test), 0);
    } finally {
      test.cleanup();
    }
  });
});
