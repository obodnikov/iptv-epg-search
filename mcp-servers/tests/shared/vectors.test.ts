/**
 * vectors.test.ts - the store of the vectors.
 *
 * The vectors live in their own file, so that deleting the catalogue does
 * not throw them away (design: iptv-mcp-servers.md §6.2).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  countVectors,
  ensureVectorSchema,
  fromBlob,
  getQueryVector,
  getVector,
  pruneVectors,
  putQueryVector,
  putVector,
  toBlob,
  vectorsTableExists,
} from '../../src/shared/vectors.ts';
import { testDatabase } from '../helpers.ts';

describe('the store of the vectors', () => {
  it('creates its tables', () => {
    const test = testDatabase(true);
    try {
      ensureVectorSchema(test.db);
      assert.equal(vectorsTableExists(test.db), true);
    } finally {
      test.cleanup();
    }
  });

  it('does nothing when no vectors database is attached', () => {
    const test = testDatabase(false);
    try {
      ensureVectorSchema(test.db);
      assert.equal(vectorsTableExists(test.db), false);
      assert.equal(countVectors(test.db, 'BAAI/bge-m3'), 0);
    } finally {
      test.cleanup();
    }
  });

  it('writes a vector and reads it back', () => {
    const test = testDatabase(true);
    try {
      ensureVectorSchema(test.db);

      const vector = new Float32Array([0.5, -0.25, 1]);
      putVector(test.db, {
        textHash: 'hash1',
        model: 'BAAI/bge-m3',
        embedding: vector,
        createdAt: 1_700_000_000_000,
      });

      const read = getVector(test.db, 'hash1', 'BAAI/bge-m3');
      assert.ok(read);
      assert.deepEqual([...read], [0.5, -0.25, 1]);
    } finally {
      test.cleanup();
    }
  });

  it('never gives the vector of another model', () => {
    const test = testDatabase(true);
    try {
      ensureVectorSchema(test.db);

      putVector(test.db, {
        textHash: 'hash1',
        model: 'BAAI/bge-m3',
        embedding: new Float32Array([1, 2]),
        createdAt: 1,
      });

      assert.equal(getVector(test.db, 'hash1', 'other/model'), null);
      assert.equal(countVectors(test.db, 'other/model'), 0);
      assert.equal(countVectors(test.db, 'BAAI/bge-m3'), 1);
    } finally {
      test.cleanup();
    }
  });

  it('keeps the vectors of the queries apart', () => {
    const test = testDatabase(true);
    try {
      ensureVectorSchema(test.db);

      putVector(test.db, {
        textHash: 'hash1',
        model: 'm',
        embedding: new Float32Array([1, 2]),
        createdAt: 1,
      });
      putQueryVector(test.db, 'query1', 'm', new Float32Array([3, 4]), 2);

      assert.equal(getVector(test.db, 'query1', 'm'), null);
      const query = getQueryVector(test.db, 'query1', 'm');
      assert.ok(query);
      assert.deepEqual([...query], [3, 4]);

      // The number of the vectors counts the titles, not the queries.
      assert.equal(countVectors(test.db, 'm'), 1);
    } finally {
      test.cleanup();
    }
  });

  it('removes the vectors of the texts that left', () => {
    const test = testDatabase(true);
    try {
      ensureVectorSchema(test.db);

      putVector(test.db, {
        textHash: 'hash1',
        model: 'm',
        embedding: new Float32Array([1]),
        createdAt: 1,
      });
      putVector(test.db, {
        textHash: 'hash2',
        model: 'm',
        embedding: new Float32Array([2]),
        createdAt: 1,
      });

      const removed = pruneVectors(test.db, 'm', ['hash1']);
      assert.equal(removed, 1);
      assert.equal(countVectors(test.db, 'm'), 1);
      assert.ok(getVector(test.db, 'hash1', 'm'));
    } finally {
      test.cleanup();
    }
  });
});

describe('the bytes of a vector', () => {
  it('keeps the values', () => {
    const vector = new Float32Array([1, -2.5, 0]);
    const read = fromBlob(toBlob(vector));

    assert.deepEqual([...read], [1, -2.5, 0]);
  });

  it('reads a vector that does not start at the beginning of its buffer', () => {
    const vector = new Float32Array([1, 2, 3, 4]);
    const part = vector.subarray(1, 3);
    const read = fromBlob(toBlob(part));

    assert.deepEqual([...read], [2, 3]);
  });
});
