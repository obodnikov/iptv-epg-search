/**
 * queue.ts - the queue of the texts that have to be embedded.
 *
 * One row per text and per model (design: cinema-server.md §3.1.1). The
 * queue holds the work of the **active** model only: the vectors of two
 * models are never compared (design: iptv-mcp-servers.md §6.2), so a model
 * that is not the active one has nothing to do with the queue.
 *
 * The queue is filled by the import, it is pruned when the texts leave the
 * catalogue, and it is built again when the model of the settings changes.
 */

import { type Db } from '../shared/db.ts';
import type { PreparedTitle, WriteOptions } from './store.ts';

/**
 * The number of characters of a text.
 *
 * SQLite counts the characters of a text, not the units of UTF-16: a text
 * with a character outside the basic plane is shorter in JavaScript than in
 * SQLite. The two have to be the same, so that a title is queued on one path
 * and skipped on the other.
 */
export function charLength(text: string): number {
  let count = 0;
  for (const _character of text) count += 1;
  return count;
}

/**
 * Put one text into the queue.
 *
 * A text that is shorter than `embeddings.minTextChars` is only searched by
 * words, so it is never queued.
 *
 * @returns true when a row was added.
 */
export function queueText(
  db: Db,
  title: PreparedTitle,
  options: WriteOptions,
): boolean {
  if (!title.textHash) return false;
  if (charLength(title.embedText) < options.minTextChars) return false;

  const outcome = db.run(
    'INSERT OR IGNORE INTO vector_queue (text_hash, model, queued_at) VALUES (?, ?, ?)',
    title.textHash,
    options.embeddingModel,
    options.now,
  );
  return outcome.changes > 0;
}

/**
 * Remove the queue rows of texts that are not in the catalogue any more.
 */
export function pruneVectorQueue(db: Db): number {
  const outcome = db.run(
    `DELETE FROM vector_queue
      WHERE text_hash NOT IN (
        SELECT DISTINCT text_hash FROM titles
         WHERE removed_at IS NULL AND text_hash IS NOT NULL AND text_hash != ''
      )`,
  );
  return outcome.changes;
}

/**
 * Put the texts that have no vector for the active model into the queue.
 *
 * A text that comes back next week costs nothing: it has a vector already
 * and stays out of the queue (design: iptv-mcp-servers.md §6.2). A text
 * whose vector is gone — because the vectors file was deleted — is queued
 * again.
 *
 * Nothing happens when the vectors are not there yet.
 */
export function queueMissingVectors(db: Db, options: WriteOptions): number {
  if (!db.hasVectors) return 0;

  const table = db.get<{ found: number }>(
    "SELECT count(*) AS found FROM vec.sqlite_master WHERE type = 'table' AND name = 'vectors'",
  );
  if ((table?.found ?? 0) === 0) return 0;

  const outcome = db.run(
    `INSERT OR IGNORE INTO vector_queue (text_hash, model, queued_at)
     SELECT DISTINCT t.text_hash, ?, ?
       FROM titles t
      WHERE t.removed_at IS NULL
        AND t.text_hash IS NOT NULL
        AND t.text_hash != ''
        AND t.embed_text IS NOT NULL
        AND length(t.embed_text) >= ?
        AND NOT EXISTS (
          SELECT 1 FROM vec.vectors v
           WHERE v.text_hash = t.text_hash AND v.model = ?
        )`,
    options.embeddingModel,
    options.now,
    options.minTextChars,
    options.embeddingModel,
  );
  return outcome.changes;
}

/**
 * Put every live title into the queue of a model.
 *
 * This is what happens when the model of the settings changes: the vectors
 * of the old model are never compared with the new ones, so the texts have
 * to be embedded again (design: iptv-mcp-servers.md §6.2). The queue holds
 * the work of the active model only, so the rows of the old model are
 * dropped.
 */
export function rebuildVectorQueue(
  db: Db,
  model: string,
  minTextChars: number,
  now: number,
): number {
  db.run('DELETE FROM vector_queue');
  const outcome = db.run(
    `INSERT OR IGNORE INTO vector_queue (text_hash, model, queued_at)
     SELECT DISTINCT text_hash, ?, ?
       FROM titles
      WHERE removed_at IS NULL
        AND text_hash IS NOT NULL
        AND text_hash != ''
        AND embed_text IS NOT NULL
        AND length(embed_text) >= ?`,
    model,
    now,
    minTextChars,
  );
  return outcome.changes;
}

/**
 * Remove the queue rows of texts that have a vector already.
 *
 * The queue and the vectors are two files; this keeps them in step. It does
 * nothing when the vectors are not there yet.
 */
export function reconcileVectorQueue(db: Db, model: string): number {
  if (!db.hasVectors) return 0;

  const table = db.get<{ found: number }>(
    "SELECT count(*) AS found FROM vec.sqlite_master WHERE type = 'table' AND name = 'vectors'",
  );
  if ((table?.found ?? 0) === 0) return 0;

  const outcome = db.run(
    `DELETE FROM vector_queue
      WHERE model = ?
        AND text_hash IN (SELECT text_hash FROM vec.vectors WHERE model = ?)`,
    model,
    model,
  );
  return outcome.changes;
}
