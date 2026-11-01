/**
 * embedder.test.ts - the worker that embeds the texts of the guide.
 *
 * The worker runs in the background: it takes the texts of the queue, asks
 * the service for their vectors and writes them (design:
 * tv-guide-server.md §10 T4). After every batch it gives the fresh texts
 * their meaning kind, and once per run it applies the kind to the texts
 * whose vector was already there.
 */

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { createFakeEmbedder, type TextEmbedder } from '../../src/shared/embeddings.ts';
import { Logger } from '../../src/shared/log.ts';
import { SettingsStore } from '../../src/shared/settings.ts';
import { countVectors, ensureVectorSchema } from '../../src/shared/vectors.ts';
import {
  TV_GUIDE_SETTINGS_SPEC,
  TV_GUIDE_SETTINGS_TEMPLATE,
} from '../../src/tv-guide/config.ts';
import { createEmbedder, type Embedder } from '../../src/tv-guide/embedder.ts';
import { importTvGuideTexts } from '../../src/tv-guide/import.ts';
import { MEANING_KIND_LABELS } from '../../src/tv-guide/meaning.ts';
import { applyTvGuideSchema } from '../../src/tv-guide/schema.ts';
import { testDatabase, type TestDatabase } from '../helpers.ts';

const EPG = `<?xml version="1.0" encoding="UTF-8"?>
<tv generator-info-name="example EPG">
<channel id="ch1"><display-name lang="ru">Канал</display-name></channel>
<programme start="20260614120000 +0300" stop="20260614130000 +0300" channel="ch1">
  <title lang="ru">х/ф Названный фильм</title>
  <desc lang="ru">Драма. Россия, 2019, драма</desc>
</programme>
<programme start="20260614140000 +0300" stop="20260614150000 +0300" channel="ch1">
  <title lang="ru">Футбол. Игра</title>
  <desc lang="ru">Прямая трансляция из США.</desc>
</programme>
<programme start="20260614160000 +0300" stop="20260614170000 +0300" channel="ch1">
  <title lang="ru">Просто передача</title>
  <desc lang="ru">Разговор о жизни в студии.</desc>
</programme>
</tv>
`;

const PLAYLIST = `#EXTM3U catchup-type="shift"
#EXTINF:0 group-title="Общероссийские" tvg-id="ch1" tvg-rec="7",Канал
http://example.invalid/s/KEY/ch1.m3u8
`;

const MODEL = 'BAAI/bge-m3';

/** The texts of the labels of the kinds. */
const LABEL_TEXTS = new Set(Object.values(MEANING_KIND_LABELS).flat());

/** The unit vector of the film axis. */
function filmVector(dim = 8): Float32Array {
  const vector = new Float32Array(dim);
  vector[0] = 1;
  return vector;
}

/** The unit vector of the sport axis. */
function sportVector(dim = 8): Float32Array {
  const vector = new Float32Array(dim);
  vector[1] = 1;
  return vector;
}

/**
 * The fake embedder of the test: every label gets its own axis, and every
 * text of the guide leans towards the film axis.
 */
function mappedEmbedder(options: { delayMs?: number } = {}): TextEmbedder {
  return createFakeEmbedder({
    model: MODEL,
    embed: (text) => {
      const lower = text.toLowerCase();
      if (LABEL_TEXTS.has(text)) {
        if (text === MEANING_KIND_LABELS.film[0]) return filmVector();
        if (text === MEANING_KIND_LABELS.sport[0]) return sportVector();
        // The other labels sit far from both axes.
        const vector = new Float32Array(8);
        vector[7] = 1;
        return vector;
      }
      if (lower.includes('футбол')) return sportVector();
      // The query and the texts of the guide: close to the film label.
      const vector = new Float32Array(8);
      vector[0] = 6;
      vector[1] = 1;
      const norm = Math.hypot(...vector);
      for (let i = 0; i < vector.length; i += 1) vector[i] = (vector[i] as number) / norm;

      if (options.delayMs) {
        // The tests that need a slow run get one.
        const start = Date.now();
        while (Date.now() - start < options.delayMs) {
          /* the run has to take its time */
        }
      }
      return vector;
    },
  });
}

/**
 * The options of the import of the test.
 */
function importOptions() {
  return {
    epgUrl: '',
    liveUrl: '',
    excludeGroups: [],
    epgDefaultOffset: '+0000',
    pastDays: 10,
    embeddingModel: MODEL,
    minTextChars: 0,
    embeddingsEnabled: true,
    now: Math.floor(Date.parse('2026-06-14T09:00:00Z') / 1000),
  };
}

/**
 * A database with the guide of the test and the queue of the texts.
 */
async function withGuide(settings: Record<string, unknown> = {}): Promise<TestDatabase & {
  worker: Embedder;
}> {
  const test = testDatabase(true);
  applyTvGuideSchema(test.db);
  ensureVectorSchema(test.db);

  const outcome = await importTvGuideTexts(
    test.db,
    { playlistText: PLAYLIST, epgText: EPG },
    importOptions(),
  );
  if (!outcome.ok) {
    throw new Error(
      `the fixture could not be imported: ${outcome.error} / ${JSON.stringify(outcome)}`,
    );
  }

  const path = join(test.dir, 'settings.json');
  writeFileSync(
    path,
    `${JSON.stringify({ ...TV_GUIDE_SETTINGS_TEMPLATE, ...settings }, null, 2)}\n`,
    { mode: 0o600 },
  );
  const store = new SettingsStore(path, TV_GUIDE_SETTINGS_SPEC);
  const logger = new Logger(join(test.dir, 'logs', 'server.log'), 'error');

  const embedder = mappedEmbedder();
  const worker = createEmbedder({
    db: test.db,
    dataDir: test.dir,
    settings: store,
    logger,
    embedder,
    batchAttempts: 1,
    batchDelaysMs: [1],
  });

  return Object.assign(test, { worker });
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
 * The kind of a text of the guide.
 */
function kindOf(test: TestDatabase, title: string): { kind: string; source: string } | null {
  const row = test.db.get<{ kind: string; kind_source: string }>(
    'SELECT kind, kind_source FROM program_texts WHERE title = ?',
    title,
  );
  return row ? { kind: row.kind, source: row.kind_source } : null;
}

describe('the worker of the guide', () => {
  it('empties the queue and gives the texts their meaning kind', async () => {
    const test = await withGuide();
    try {
      assert.ok(countVectors(test.db, MODEL) === 0);
      assert.equal(test.worker.status().pending, 3);

      assert.equal(test.worker.start(), 'started');
      await waitFor(test.worker);

      const status = test.worker.status();
      assert.equal(status.phase, 'done');
      assert.equal(status.pending, 0);
      assert.equal(status.done, 3);
      assert.equal(countVectors(test.db, MODEL), 3);

      // The weak text took the kind of its meaning; the words of the
      // provider were never touched. The marker comes off the stored
      // title: the import cleans it.
      assert.deepEqual(kindOf(test, 'Просто передача'), { kind: 'film', source: 'meaning' });
      assert.deepEqual(kindOf(test, 'Названный фильм'), { kind: 'film', source: 'marker' });
      assert.deepEqual(kindOf(test, 'Футбол. Игра'), { kind: 'sport', source: 'pattern' });
    } finally {
      test.cleanup();
    }
  });

  it('runs only once at a time', async () => {
    // A guide with texts: the run has real work, and the delay of the
    // embedder keeps it going until the second start is asked for. (An
    // empty queue would let the run finish before it — flaky.)
    const test = testDatabase(true);
    applyTvGuideSchema(test.db);
    ensureVectorSchema(test.db);
    const outcome = await importTvGuideTexts(
      test.db,
      { playlistText: PLAYLIST, epgText: EPG },
      importOptions(),
    );
    if (!outcome.ok) {
      throw new Error(`the fixture could not be imported: ${outcome.error}`);
    }

    const path = join(test.dir, 'settings.json');
    writeFileSync(
      path,
      `${JSON.stringify(TV_GUIDE_SETTINGS_TEMPLATE, null, 2)}\n`,
      { mode: 0o600 },
    );
    const store = new SettingsStore(path, TV_GUIDE_SETTINGS_SPEC);
    const logger = new Logger(join(test.dir, 'logs', 'server.log'), 'error');

    // A slow embedder: the first run is still going when the second is
    // asked for.
    const slow = mappedEmbedder({ delayMs: 120 });
    const worker = createEmbedder({
      db: test.db,
      dataDir: test.dir,
      settings: store,
      logger,
      embedder: slow,
    });

    try {
      assert.equal(worker.start(), 'started');
      assert.equal(worker.start(), 'already_running');
      await waitFor(worker);
    } finally {
      test.cleanup();
    }
  });

  it('is disabled without the key of the service', () => {
    const test = testDatabase(true);
    applyTvGuideSchema(test.db);

    const path = join(test.dir, 'settings.json');
    writeFileSync(
      path,
      `${JSON.stringify(TV_GUIDE_SETTINGS_TEMPLATE, null, 2)}\n`,
      { mode: 0o600 },
    );
    const store = new SettingsStore(path, TV_GUIDE_SETTINGS_SPEC);
    const logger = new Logger(join(test.dir, 'logs', 'server.log'), 'error');

    const worker = createEmbedder({
      db: test.db,
      dataDir: test.dir,
      settings: store,
      logger,
      embedder: {
        model: MODEL,
        available: false,
        embed: async () => null,
        embedMany: async () => null,
      },
    });

    try {
      assert.equal(worker.start(), 'disabled');
      assert.equal(worker.status().running, false);
      assert.equal(worker.status().key_present, false);
    } finally {
      test.cleanup();
    }
  });

  it('is disabled when the settings switch the embeddings off', async () => {
    const test = await withGuide({
      embeddings: {
        enabled: false,
        model: MODEL,
        apiKeyEnv: 'OPENROUTER_API_KEY',
        batchSize: 50,
        minTextChars: 0,
        groups: 'all',
      },
    });
    try {
      assert.equal(test.worker.start(), 'disabled');
      assert.equal(countVectors(test.db, MODEL), 0);
    } finally {
      test.cleanup();
    }
  });

  it('keeps the queue and the reason when the service does not answer', async () => {
    const test = testDatabase(true);
    applyTvGuideSchema(test.db);
    ensureVectorSchema(test.db);

    const outcome = await importTvGuideTexts(
      test.db,
      { playlistText: PLAYLIST, epgText: EPG },
      importOptions(),
    );
    if (!outcome.ok) {
      throw new Error(
        `the fixture could not be imported: ${outcome.error} / ${JSON.stringify(outcome)}`,
      );
    }

    const path = join(test.dir, 'settings.json');
    writeFileSync(
      path,
      `${JSON.stringify(TV_GUIDE_SETTINGS_TEMPLATE, null, 2)}\n`,
      { mode: 0o600 },
    );
    const store = new SettingsStore(path, TV_GUIDE_SETTINGS_SPEC);
    const logger = new Logger(join(test.dir, 'logs', 'server.log'), 'error');

    const failing: TextEmbedder = {
      model: MODEL,
      available: true,
      lastError: 'the service said no',
      embed: async () => null,
      embedMany: async () => null,
    };
    const worker = createEmbedder({
      db: test.db,
      dataDir: test.dir,
      settings: store,
      logger,
      embedder: failing,
      batchAttempts: 1,
    });

    try {
      assert.equal(worker.start(), 'started');
      await waitFor(worker);

      const status = worker.status();
      assert.equal(status.phase, 'failed');
      assert.ok(status.last_error?.includes('the service said no'));
      assert.equal(status.pending, 3);
      assert.equal(countVectors(test.db, MODEL), 0);
    } finally {
      test.cleanup();
    }
  });

  it('re-queues the texts when the model changes', async () => {
    const test = await withGuide({
      embeddings: {
        enabled: true,
        model: 'other/model',
        apiKeyEnv: 'OPENROUTER_API_KEY',
        batchSize: 50,
        minTextChars: 0,
        groups: 'all',
      },
    });
    try {
      // The import queued the texts for BAAI/bge-m3; the worker works for
      // other/model now.
      assert.equal(test.worker.status().model, 'other/model');
      assert.equal(test.worker.start(), 'started');
      await waitFor(test.worker);

      assert.equal(test.worker.status().phase, 'done');
      assert.equal(countVectors(test.db, 'other/model'), 3);
      assert.equal(countVectors(test.db, MODEL), 0);
      assert.equal(test.worker.status().pending, 0);
    } finally {
      test.cleanup();
    }
  });

  it('applies the meaning kind to the texts whose source the import reset', async () => {
    const test = await withGuide();
    try {
      assert.equal(test.worker.start(), 'started');
      await waitFor(test.worker);

      // The import runs again (a refresh writes the guide again): the
      // derivation of the import is the baseline, and the meaning kind is
      // reset to it — the pass re-applies on the next run.
      const outcome = await importTvGuideTexts(
        test.db,
        { playlistText: PLAYLIST, epgText: EPG },
        importOptions(),
      );
      if (!outcome.ok) throw new Error(`the refresh failed: ${outcome.error}`);

      const row = test.db.get<{ kind_source: string }>(
        "SELECT kind_source FROM program_texts WHERE title = 'Просто передача'",
      );
      assert.equal(row?.kind_source, 'none');

      assert.equal(test.worker.start(), 'started');
      await waitFor(test.worker);
      assert.equal(test.worker.status().phase, 'done');

      // The vectors were not asked for again: the texts of the queue were
      // embedded once, and the run only re-applied the kind.
      assert.equal(test.worker.status().done, 0);
      assert.equal(countVectors(test.db, MODEL), 3);
      assert.deepEqual(kindOf(test, 'Просто передача'), { kind: 'film', source: 'meaning' });
    } finally {
      test.cleanup();
    }
  });
});
