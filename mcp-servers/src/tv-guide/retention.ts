/**
 * retention.ts - the window of the guide and the texts that left.
 *
 * A refresh whose downloads did not change writes no new guide, but the
 * window of `pastDays` still moves with the day: the programmes that
 * have fallen out of it are removed, with the texts that only they
 * carried.
 */

import { type Db, withTransaction } from '../shared/db.ts';
import {
  clearVectorQueue,
  dropForeignQueueRows,
  pruneVectorQueue,
  queueMissingVectors,
  reconcileVectorQueue,
} from './queue.ts';
import { emptyWriteResult, type ImportOptions, type WriteResult } from './import-options.ts';

/**
 * Remove the texts that no programme carries any more, with their
 * keyword-index rows (the vectors stay in their own file, and the queue
 * rows are pruned by the caller).
 *
 * @returns the number of the texts that were removed.
 */
export function removeOrphanTexts(db: Db): number {
  // Both statements are set-based: a guide can leave tens of thousands of
  // orphan texts behind, and one statement per text would keep the
  // transaction open for their sake.
  db.run(
    `DELETE FROM program_texts_fts
      WHERE rowid IN (
        SELECT fts_rowid FROM program_texts
         WHERE text_hash NOT IN (SELECT DISTINCT text_hash FROM programmes)
           AND fts_rowid IS NOT NULL
      )`,
  );
  const outcome = db.run(
    `DELETE FROM program_texts
      WHERE text_hash NOT IN (SELECT DISTINCT text_hash FROM programmes)`,
  );
  return outcome.changes;
}

/**
 * Apply the retention window to the guide that is in the database.
 *
 * Everything runs in one synchronous transaction, like the write of an
 * import.
 *
 * @returns what the retention did, for the outcome of the refresh.
 */
export function applyRetention(db: Db, options: ImportOptions): WriteResult {
  const result = emptyWriteResult();

  withTransaction(db, () => {
    const retentionFloor = options.now - options.pastDays * 86_400;
    result.droppedOld = db.run(
      'DELETE FROM programmes WHERE stop_utc < ?',
      retentionFloor,
    ).changes;
    result.removedTexts = removeOrphanTexts(db);

    result.channels = db.get<{ found: number }>('SELECT count(*) AS found FROM channels')?.found ?? 0;
    result.texts = db.get<{ found: number }>('SELECT count(*) AS found FROM program_texts')?.found ?? 0;
    result.liveProgrammes =
      db.get<{ found: number }>('SELECT count(*) AS found FROM programmes')?.found ?? 0;

    const window = db.get<{ first: number | null; last: number | null }>(
      'SELECT min(start_utc) AS first, max(start_utc) AS last FROM programmes',
    );
    result.windowStart = window?.first ?? null;
    result.windowEnd = window?.last ?? null;

    if (options.embeddingsEnabled) {
      dropForeignQueueRows(db, options.embeddingModel);
      result.queuePruned += pruneVectorQueue(db);
      queueMissingVectors(db, options);
      reconcileVectorQueue(db, options.embeddingModel);
      result.queueSize =
        db.get<{ found: number }>('SELECT count(*) AS found FROM vector_queue')?.found ?? 0;
    } else {
      result.queuePruned += clearVectorQueue(db);
      result.queueSize = 0;
    }
  });

  return result;
}
