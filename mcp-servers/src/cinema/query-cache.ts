/**
 * query-cache.ts - the vectors of the queries.
 *
 * The vector of a query is asked of the service once and kept: a repeated
 * search, or the next page of the same search, costs nothing
 * (design: iptv-mcp-servers.md §7.4).
 *
 * The cache has two parts:
 *
 * - the memory of the process, which is the fast one;
 * - the table `query_vectors` of the vectors database, which survives a
 *   restart.
 *
 * The key of a query is the hash of its text **and** of the model: the
 * vectors of two models are never compared.
 */

import { type Db } from '../shared/db.ts';
import { sha256 } from '../shared/hash.ts';
import { getQueryVector, putQueryVector } from '../shared/vectors.ts';

/** How many vectors the memory of the process keeps. */
const MEMORY_LIMIT = 64;

export class QueryCache {
  private readonly db: Db;
  private readonly memory = new Map<string, Float32Array>();

  constructor(db: Db) {
    this.db = db;
  }

  /**
   * The key of a query.
   */
  static key(model: string, text: string): string {
    return sha256(`${model}\n${text}`);
  }

  /**
   * The vector of a query, or null when it is not known.
   */
  get(model: string, text: string): Float32Array | null {
    const key = QueryCache.key(model, text);

    const inMemory = this.memory.get(key);
    if (inMemory) return inMemory;

    const stored = getQueryVector(this.db, key, model);
    if (!stored) return null;

    this.remember(key, stored);
    return stored;
  }

  /**
   * Keep the vector of a query.
   */
  set(model: string, text: string, vector: Float32Array): void {
    const key = QueryCache.key(model, text);
    this.remember(key, vector);
    putQueryVector(this.db, key, model, vector, Date.now());
  }

  /**
   * Put a vector into the memory, and drop the oldest one when it is full.
   */
  private remember(key: string, vector: Float32Array): void {
    if (this.memory.has(key)) {
      this.memory.delete(key);
    }
    this.memory.set(key, vector);

    while (this.memory.size > MEMORY_LIMIT) {
      const oldest = this.memory.keys().next();
      if (oldest.done) break;
      this.memory.delete(oldest.value);
    }
  }
}
