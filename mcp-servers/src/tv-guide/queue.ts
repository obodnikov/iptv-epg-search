/**
 * queue.ts - the queue of the texts that have to be embedded.
 *
 * One row per text and per model. The shape and the rules are the ones of
 * the cinema server (src/cinema/queue.ts, phase C2/C4); the tables differ:
 * the guide looks its texts up in `program_texts`, and a text is "live"
 * while at least one programme in the guide carries it.
 *
 * The queue holds the work of the **active** model only: the vectors of
 * two models are never compared (design: iptv-mcp-servers.md §6.2). It is
 * filled by the import (tv-guide-server.md §5 step 8), it is pruned when
 * the texts leave the guide, and it is built again when the model of the
 * settings changes. The worker that takes the texts out arrives with T4.
 */

import { type Db } from '../shared/db.ts';
import { charLength } from '../shared/text.ts';
import type { WriteOptions } from './import-options.ts';

/**
 * One text of the queue.
 */
export interface QueuedText {
  /** The hash of the source pair (title, description). */
  textHash: string;
  /** The text that has to be embedded. */
  text: string;
}

/**
 * The next texts of the queue of a model.
 *
 * The text comes from `program_texts`: the queue holds the hash of the
 * text, not the text itself. The join with `programmes` skips the texts
 * that no programme carries any more, and two programmes that share a
 * text are one row.
 *
 * @param model The model the texts have to be embedded for.
 * @param minTextChars Texts shorter than this are only searched by words.
 * @param limit How many texts to take at most.
 */
export function nextQueuedTexts(
  db: Db,
  model: string,
  minTextChars: number,
  limit: number,
): QueuedText[] {
  const rows = db.all<{ text_hash: string; text: string }>(
    `SELECT DISTINCT q.text_hash AS text_hash, t.embed_text AS text
       FROM vector_queue q
       JOIN program_texts t ON t.text_hash = q.text_hash
       JOIN programmes p ON p.text_hash = q.text_hash
      WHERE q.model = ?
        AND t.embed_text != ''
        AND length(t.embed_text) >= ?
      LIMIT ?`,
    model,
    minTextChars,
    limit,
  );

  return rows.map((row) => ({ textHash: row.text_hash, text: row.text }));
}

/**
 * Remove the texts of the queue that were embedded.
 *
 * @returns the number of the rows that were removed.
 */
export function removeQueuedTexts(db: Db, model: string, hashes: string[]): number {
  if (hashes.length === 0) return 0;
  const marks = hashes.map(() => '?').join(', ');
  return db.run(
    `DELETE FROM vector_queue WHERE model = ? AND text_hash IN (${marks})`,
    model,
    ...hashes,
  ).changes;
}

/**
 * Remove the queue rows of the models that are not the active one.
 */
export function dropForeignQueueRows(db: Db, model: string): number {
  return db.run('DELETE FROM vector_queue WHERE model != ?', model).changes;
}

/**
 * Put one text into the queue.
 *
 * A text that is shorter than `embeddings.minTextChars` is only searched by
 * words, so it is never queued.
 *
 * @returns true when a row was added.
 */
export function queueText(db: Db, textHash: string, embedText: string, options: WriteOptions): boolean {
  if (!options.embeddingsEnabled) return false;
  if (!textHash) return false;
  if (charLength(embedText) < options.minTextChars) return false;

  const outcome = db.run(
    'INSERT OR IGNORE INTO vector_queue (text_hash, model, queued_at) VALUES (?, ?, ?)',
    textHash,
    options.embeddingModel,
    options.now,
  );
  return outcome.changes > 0;
}

/**
 * Empty the queue.
 *
 * With the embeddings switched off there is no worker: the rows would
 * promise work that never runs.
 */
export function clearVectorQueue(db: Db): number {
  return db.run('DELETE FROM vector_queue').changes;
}

/**
 * Remove the queue rows of texts that no programme carries any more.
 */
export function pruneVectorQueue(db: Db): number {
  const outcome = db.run(
    `DELETE FROM vector_queue
      WHERE text_hash NOT IN (SELECT DISTINCT text_hash FROM programmes)`,
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
 * Nothing happens when the vectors are not attached yet.
 */
export function queueMissingVectors(
  db: Db,
  options: Pick<WriteOptions, 'embeddingModel' | 'minTextChars' | 'embeddingsEnabled' | 'now'>,
): number {
  if (!options.embeddingsEnabled) return 0;
  if (!db.hasVectors) return 0;

  const table = db.get<{ found: number }>(
    "SELECT count(*) AS found FROM vec.sqlite_master WHERE type = 'table' AND name = 'vectors'",
  );
  if ((table?.found ?? 0) === 0) return 0;

  const outcome = db.run(
    `INSERT OR IGNORE INTO vector_queue (text_hash, model, queued_at)
     SELECT DISTINCT t.text_hash, ?, ?
       FROM program_texts t
       JOIN programmes p ON p.text_hash = t.text_hash
      WHERE t.embed_text != ''
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
 * Put every live text into the queue of a model.
 *
 * This is what happens when the model of the settings changes: the vectors
 * of the old model are never compared with the new ones, so the texts have
 * to be embedded again. The queue holds the work of the active model only,
 * so the rows of the old model are dropped.
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
     SELECT DISTINCT t.text_hash, ?, ?
       FROM program_texts t
       JOIN programmes p ON p.text_hash = t.text_hash
      WHERE t.embed_text != ''
        AND length(t.embed_text) >= ?`,
    model,
    now,
    minTextChars,
  );
  return outcome.changes;
}

/**
 * Remove the queue rows of texts that have a vector already.
 *
 * The queue and the vectors are two files; this keeps them in step. It
 * does nothing when the vectors are not attached yet.
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
