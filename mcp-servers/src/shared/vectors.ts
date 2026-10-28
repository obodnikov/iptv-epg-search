/**
 * vectors.ts - the vectors of the servers.
 *
 * The vectors live in their own file (`vectors.sqlite`), so that deleting
 * the catalogue does not throw away the vectors that were paid for
 * (design: iptv-mcp-servers.md §5.1, §6.2). The file is attached to the
 * database of the catalogue under the name `vec`.
 *
 * Two tables live there:
 *
 * - `vectors`: one vector per text and per model. The key of a text is the
 *   hash of its embedding text, so a text that comes back next week costs
 *   nothing.
 * - `query_vectors`: the vectors of the queries. They are kept apart from
 *   the vectors of the titles, so that the number of the vectors of a model
 *   is the number of the titles that were embedded.
 *
 * The vectors of two models are never compared: the model is part of the
 * key of every row.
 */

import { type Db } from './db.ts';

/** The name the vectors database is attached under. */
export const VECTORS_SCHEMA = 'vec';

/**
 * The table of the vectors.
 */
export const VECTORS_TABLE = `${VECTORS_SCHEMA}.vectors`;

/**
 * The table of the vectors of the queries.
 */
export const QUERY_VECTORS_TABLE = `${VECTORS_SCHEMA}.query_vectors`;

/**
 * The tables of the vectors database.
 */
export const VECTOR_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ${VECTORS_TABLE} (
  text_hash   TEXT NOT NULL,      -- sha256 of the normalised embedding text
  model       TEXT NOT NULL,      -- e.g. BAAI/bge-m3
  dim         INTEGER NOT NULL,   -- 1024 for bge-m3
  embedding   BLOB NOT NULL,      -- float32 little-endian, length = dim * 4
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (text_hash, model)
);

CREATE TABLE IF NOT EXISTS ${QUERY_VECTORS_TABLE} (
  text_hash   TEXT NOT NULL,
  model       TEXT NOT NULL,
  dim         INTEGER NOT NULL,
  embedding   BLOB NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (text_hash, model)
);
`;

/**
 * A vector as it is written in the database.
 */
export interface StoredVector {
  /** The hash of the text the vector was made of. */
  textHash: string;
  /** The model the vector was made for. */
  model: string;
  /** The vector itself. */
  embedding: Float32Array;
  /** The moment it was written, in epoch milliseconds. */
  createdAt: number;
}

/**
 * The bytes of a vector: float32, little-endian.
 */
export function toBlob(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
}

/**
 * The vector of some bytes.
 */
export function fromBlob(blob: Uint8Array): Float32Array {
  // The bytes may not start at the beginning of their buffer: the copy
  // makes a vector that is aligned for the float32 view.
  const copy = new Uint8Array(blob.byteLength);
  copy.set(blob);
  return new Float32Array(copy.buffer);
}

/**
 * Create the tables of the vectors database.
 *
 * It does nothing when no vectors database is attached: the server works
 * without vectors, on words alone.
 */
export function ensureVectorSchema(db: Db): void {
  if (!db.hasVectors) return;
  db.exec(VECTOR_SCHEMA_SQL);
}

/**
 * Write a vector.
 *
 * A vector of another model never overwrites a vector of this one: the
 * model is part of the key.
 */
export function putVector(db: Db, vector: StoredVector): void {
  if (!db.hasVectors) return;
  db.run(
    `INSERT OR REPLACE INTO ${VECTORS_TABLE}
       (text_hash, model, dim, embedding, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    vector.textHash,
    vector.model,
    vector.embedding.length,
    toBlob(vector.embedding),
    vector.createdAt,
  );
}

/**
 * Write many vectors in one transaction.
 */
export function putVectors(db: Db, vectors: StoredVector[]): number {
  if (!db.hasVectors || vectors.length === 0) return 0;
  let written = 0;
  for (const vector of vectors) {
    putVector(db, vector);
    written += 1;
  }
  return written;
}

/**
 * True when the table of the vectors is there.
 *
 * The table is created by the first embedding run: before that the server
 * works on the words alone.
 */
export function vectorsTableExists(db: Db): boolean {
  if (!db.hasVectors) return false;
  const table = db.get<{ found: number }>(
    "SELECT count(*) AS found FROM vec.sqlite_master WHERE type = 'table' AND name = 'vectors'",
  );
  return (table?.found ?? 0) > 0;
}

/**
 * The number of the vectors of a model.
 */
export function countVectors(db: Db, model: string): number {
  if (!db.hasVectors) return 0;
  if (!vectorsTableExists(db)) return 0;

  return (
    db.get<{ found: number }>(
      `SELECT count(*) AS found FROM ${VECTORS_TABLE} WHERE model = ?`,
      model,
    )?.found ?? 0
  );
}

/**
 * The vector of a text, or null when there is none.
 *
 * The model is part of the key: the vector of another model is never
 * returned.
 */
export function getVector(
  db: Db,
  textHash: string,
  model: string,
): Float32Array | null {
  if (!db.hasVectors) return null;
  const row = db.get<{ embedding: Uint8Array; dim: number }>(
    `SELECT embedding, dim FROM ${VECTORS_TABLE} WHERE text_hash = ? AND model = ?`,
    textHash,
    model,
  );
  if (!row) return null;

  const vector = fromBlob(row.embedding);
  if (vector.length !== row.dim) return null;
  return vector;
}

/**
 * Read the vector of a query.
 */
export function getQueryVector(
  db: Db,
  textHash: string,
  model: string,
): Float32Array | null {
  if (!db.hasVectors) return null;
  const row = db.get<{ embedding: Uint8Array; dim: number }>(
    `SELECT embedding, dim FROM ${QUERY_VECTORS_TABLE} WHERE text_hash = ? AND model = ?`,
    textHash,
    model,
  );
  if (!row) return null;

  const vector = fromBlob(row.embedding);
  if (vector.length !== row.dim) return null;
  return vector;
}

/**
 * Write the vector of a query.
 */
export function putQueryVector(
  db: Db,
  textHash: string,
  model: string,
  embedding: Float32Array,
  createdAt: number,
): void {
  if (!db.hasVectors) return;
  db.run(
    `INSERT OR REPLACE INTO ${QUERY_VECTORS_TABLE}
       (text_hash, model, dim, embedding, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    textHash,
    model,
    embedding.length,
    toBlob(embedding),
    createdAt,
  );
}

/**
 * Remove the vectors of a model that are not in the list of the hashes.
 *
 * The texts that left the catalogue do not need their vector any more.
 *
 * @returns the number of the rows that were removed.
 */
export function pruneVectors(
  db: Db,
  model: string,
  keep: Iterable<string>,
): number {
  if (!db.hasVectors) return 0;
  const table = db.get<{ found: number }>(
    "SELECT count(*) AS found FROM vec.sqlite_master WHERE type = 'table' AND name = 'vectors'",
  );
  if ((table?.found ?? 0) === 0) return 0;

  const hashes = [...keep];
  if (hashes.length === 0) {
    return db.run(`DELETE FROM ${VECTORS_TABLE} WHERE model = ?`, model).changes;
  }

  const marks = hashes.map(() => '?').join(', ');
  return db.run(
    `DELETE FROM ${VECTORS_TABLE} WHERE model = ? AND text_hash NOT IN (${marks})`,
    model,
    ...hashes,
  ).changes;
}
