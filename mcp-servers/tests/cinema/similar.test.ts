/**
 * similar.test.ts - the titles that are like a given one.
 *
 * The tool `find_similar_titles` (design: cinema-server.md §6.4) answers
 * "something like X".
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { emptyFilters } from '../../src/cinema/filters.ts';
import { importCatalogText } from '../../src/cinema/import.ts';
import { findSimilarTitles } from '../../src/cinema/similar.ts';
import { applyCinemaSchema } from '../../src/cinema/schema.ts';
import { ensureVectorSchema, putVector } from '../../src/shared/vectors.ts';
import { fixture } from '../fixtures/load.ts';
import { testDatabase, type TestDatabase } from '../helpers.ts';

const catalogue = fixture('import-a.m3u');

const options = {
  aliases: {},
  snippetChars: 200,
  now: 1_800_000_000,
  timezone: 'auto',
};

/**
 * A database with the catalogue of the fixture.
 */
function withCatalogue(): TestDatabase {
  const test = testDatabase(true);
  applyCinemaSchema(test.db);
  ensureVectorSchema(test.db);

  const outcome = importCatalogText(test.db, catalogue, {
    cinemaUrl: '',
    excludeCategories: [],
    countryAliases: {},
    trackChanges: true,
    embeddingModel: 'BAAI/bge-m3',
    minTextChars: 0,
    now: 1_800_000_000,
  });
  if (!outcome.ok) throw new Error(`the fixture could not be imported: ${outcome.error}`);
  return test;
}

/**
 * The id of a title of the fixture.
 */
function idOf(test: TestDatabase, title: string): string {
  const row = test.db.get<{ title_id: string }>(
    'SELECT title_id FROM titles WHERE title = ?',
    title,
  );
  if (!row) throw new Error(`the fixture has no title '${title}'`);
  return row.title_id;
}

/**
 * Give the titles of the fixture their vectors.
 *
 * Кали and Бабье царство are near each other, Список is far away.
 */
function writeVectors(test: TestDatabase): void {
  const vectors: Record<string, number[]> = {
    Кали: [1, 0],
    'Бабье царство': [0.8, 0.6],
    Список: [0, 1],
  };

  for (const [title, values] of Object.entries(vectors)) {
    const row = test.db.get<{ text_hash: string }>(
      'SELECT text_hash FROM titles WHERE title = ?',
      title,
    );
    if (!row) continue;
    putVector(test.db, {
      textHash: row.text_hash,
      model: 'BAAI/bge-m3',
      embedding: new Float32Array(values),
      createdAt: 1_800_000_000_000,
    });
  }
}

describe('findSimilarTitles', () => {
  it('finds the titles that are near the given one', () => {
    const test = withCatalogue();
    try {
      writeVectors(test);
      const source = idOf(test, 'Кали');

      const outcome = findSimilarTitles(
        test.db,
        {
          titleId: source,
          vector: new Float32Array([1, 0]),
          model: 'BAAI/bge-m3',
          filters: { ...emptyFilters(), includeAdult: true },
          limit: 10,
          offset: 0,
        },
        options,
      );

      assert.equal(outcome.mode, 'words+meaning');
      assert.equal(outcome.total, 2);
      // The title itself is never in the answer.
      assert.equal(outcome.items[0]?.title, 'Бабье царство');
      assert.equal(outcome.items.some((item) => item.title_id === source), false);
    } finally {
      test.cleanup();
    }
  });

  it('falls back to the genres when there are no vectors', () => {
    const test = withCatalogue();
    try {
      const source = idOf(test, 'Кали');

      const outcome = findSimilarTitles(
        test.db,
        {
          titleId: source,
          vector: null,
          model: 'BAAI/bge-m3',
          filters: { ...emptyFilters(), includeAdult: true },
          limit: 10,
          offset: 0,
        },
        options,
      );

      assert.equal(outcome.mode, 'words');
      // Only the series shares a genre with "Кали".
      assert.equal(outcome.total, 1);
      assert.equal(outcome.items[0]?.title, 'Бабье царство');
    } finally {
      test.cleanup();
    }
  });

  it('obeys the filters', () => {
    const test = withCatalogue();
    try {
      writeVectors(test);
      const source = idOf(test, 'Кали');

      const outcome = findSimilarTitles(
        test.db,
        {
          titleId: source,
          vector: new Float32Array([1, 0]),
          model: 'BAAI/bge-m3',
          filters: { ...emptyFilters(), type: 'film', includeAdult: true },
          limit: 10,
          offset: 0,
        },
        options,
      );

      assert.equal(outcome.total, 1);
      assert.equal(outcome.items[0]?.title, 'Список');
    } finally {
      test.cleanup();
    }
  });

  it('never compares the vectors of another model', () => {
    const test = withCatalogue();
    try {
      writeVectors(test);
      const source = idOf(test, 'Кали');

      const outcome = findSimilarTitles(
        test.db,
        {
          titleId: source,
          vector: new Float32Array([1, 0]),
          // The vectors of the catalogue are made for another model.
          model: 'other/model',
          filters: { ...emptyFilters(), includeAdult: true },
          limit: 10,
          offset: 0,
        },
        options,
      );

      assert.equal(outcome.total, 0);
      assert.equal(outcome.mode, 'words+meaning');
    } finally {
      test.cleanup();
    }
  });

  it('has nothing to compare a description with when there are no vectors', () => {
    const test = withCatalogue();
    try {
      const outcome = findSimilarTitles(
        test.db,
        {
          titleId: null,
          vector: null,
          model: 'BAAI/bge-m3',
          filters: { ...emptyFilters(), includeAdult: true },
          limit: 10,
          offset: 0,
        },
        options,
      );

      assert.equal(outcome.total, 0);
      assert.equal(outcome.items.length, 0);
      assert.equal(outcome.source, null);
    } finally {
      test.cleanup();
    }
  });
});
