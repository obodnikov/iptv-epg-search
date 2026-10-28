/**
 * embedder.ts - the background worker that embeds the texts of the catalogue.
 *
 * The import fills the queue of the texts that have to be embedded
 * (`queue.ts`); this worker empties it. It runs in the background: a tool
 * call never waits for it (decision D15).
 *
 * The worker is a separate thing from the refresh of the catalogue:
 *
 * - the refresh downloads the catalogue and writes it; it is quick;
 * - the embedding asks the service for a vector of every text; it takes
 *   minutes and it costs money.
 *
 * The two have their own locks (`refresh.lock` and `embed.lock`), so that a
 * running embedding does not stop a refresh and the other way round.
 *
 * The rules:
 * - the vectors of two models are never compared: the queue holds the work
 *   of the active model only;
 * - a text that is shorter than `embeddings.minTextChars` is never
 *   embedded: it is only searched by words;
 * - a failure of the service stops the run; the queue keeps the texts that
 *   were not embedded, and the next run takes them again.
 */

import { join } from 'node:path';

import { type Db } from '../shared/db.ts';
import { type Logger } from '../shared/log.ts';
import { type SettingsStore } from '../shared/settings.ts';
import { type TextEmbedder } from '../shared/embeddings.ts';
import { acquireLock } from '../shared/lock.ts';
import { ensureVectorSchema, putVectors } from '../shared/vectors.ts';
import { readCinemaSettings } from './config.ts';
import {
  dropForeignQueueRows,
  dropOrphanQueueRows,
  nextQueuedTexts,
  queueMissingVectors,
  removeQueuedTexts,
} from './queue.ts';

/** The name of the lock file of the embedding run. */
export const EMBED_LOCK_FILE = 'embed.lock';

/** What the embedding run is doing. */
export type EmbedPhase = 'idle' | 'embedding' | 'done' | 'failed';

/** The state of the embedding run. */
export interface EmbedderStatus {
  /** True while the run is going on. */
  running: boolean;
  /** What the run is doing. */
  phase: EmbedPhase;
  /** The texts that were embedded in this run. */
  done: number;
  /** The texts that still have to be embedded. */
  pending: number;
  /** The model the vectors are made for. */
  model: string;
  /** The embeddings are switched on in the settings. */
  enabled: boolean;
  /** The client of the service can embed: the key is there. */
  available: boolean;
  /** The key of the service is in the environment. */
  key_present: boolean;
  /** The reason the last run failed. */
  last_error: string | null;
  /** The moment the run started, in epoch milliseconds. */
  started_at_ms: number | null;
  /** How long the run has been going on, in milliseconds. */
  elapsed_ms: number;
}

/** What the worker needs. */
export interface EmbedderContext {
  db: Db;
  /** The working folder of the server. */
  dataDir: string;
  settings: SettingsStore;
  logger: Logger;
  /** The client of the embedding service. */
  embedder: TextEmbedder;
}

/** The worker of the embeddings. */
export interface Embedder {
  /**
   * Start the run in the background.
   *
   * @returns 'started' when the run began, 'already_running' when a run is
   *   already going on, 'disabled' when the embeddings are off or the key
   *   is missing.
   */
  start(): 'started' | 'already_running' | 'disabled';
  /** The state of the run. */
  status(): EmbedderStatus;
}

/**
 * The worker of the embeddings of the cinema catalogue.
 */
export function createEmbedder(ctx: EmbedderContext): Embedder {
  let running = false;
  let phase: EmbedPhase = 'idle';
  let done = 0;
  let lastError: string | null = null;
  let startedAt: number | null = null;

  /**
   * The settings of the embeddings, as they are now.
   */
  function embeddingSettings() {
    return readCinemaSettings(ctx.settings.settings()).embeddings;
  }

  /**
   * The number of the texts that still have to be embedded.
   */
  function pendingTexts(model: string): number {
    return (
      ctx.db.get<{ found: number }>(
        'SELECT count(*) AS found FROM vector_queue WHERE model = ?',
        model,
      )?.found ?? 0
    );
  }

  /**
   * The run itself.
   */
  async function run(): Promise<void> {
    const lock = acquireLock(join(ctx.dataDir, EMBED_LOCK_FILE));
    if (!lock) {
      // Another process embeds the texts: there is nothing to do here.
      ctx.logger.info('another process embeds the texts');
      running = false;
      phase = 'idle';
      startedAt = null;
      return;
    }

    try {
      // The tables of the vectors may not be there yet: the first run
      // creates them.
      ensureVectorSchema(ctx.db);

      const settings = embeddingSettings();
      const model = settings.model;
      // The queue holds the work of one model: the rows of another model
      // would never be taken.
      dropForeignQueueRows(ctx.db, model);
      // The texts that have no title any more.
      dropOrphanQueueRows(ctx.db, model);
      // The texts that have no vector for the active model. This is what
      // fills the queue again after a change of the model.
      queueMissingVectors(ctx.db, {
        embeddingModel: model,
        minTextChars: settings.minTextChars,
        now: Math.floor(Date.now() / 1000),
      });

      for (;;) {
        // The settings are read again on every round: a change of the model
        // in the file ends the run, because the queue of the new model is
        // empty.
        const current = embeddingSettings();
        const texts = nextQueuedTexts(
          ctx.db,
          current.model,
          current.minTextChars,
          current.batchSize,
        );
        if (texts.length === 0) break;

        const vectors = await ctx.embedder.embedMany(texts.map((entry) => entry.text));
        if (!vectors || vectors.length !== texts.length) {
          throw new Error('the embedding service did not answer every text');
        }

        const now = Date.now();
        putVectors(
          ctx.db,
          texts.map((entry, index) => ({
            textHash: entry.textHash,
            model: current.model,
            embedding: vectors[index] as Float32Array,
            createdAt: now,
          })),
        );
        removeQueuedTexts(
          ctx.db,
          current.model,
          texts.map((entry) => entry.textHash),
        );

        done += texts.length;
        ctx.logger.info('the texts were embedded', {
          done,
          pending: pendingTexts(current.model),
        });
      }

      phase = 'done';
      ctx.logger.info('the embedding run is over', { done });
    } catch (error) {
      phase = 'failed';
      lastError = error instanceof Error ? error.message : String(error);
      ctx.logger.error('the embedding run failed', { error: lastError });
    } finally {
      lock.release();
      running = false;
      startedAt = null;
    }
  }

  return {
    start(): 'started' | 'already_running' | 'disabled' {
      if (running) return 'already_running';

      const settings = embeddingSettings();
      if (!settings.enabled) {
        ctx.logger.info('the embeddings are switched off');
        return 'disabled';
      }
      if (!ctx.embedder.available) {
        // The key is missing: the search falls back to the words.
        ctx.logger.warn('the key of the embedding service is not in the environment', {
          variable: settings.apiKeyEnv,
        });
        return 'disabled';
      }

      running = true;
      phase = 'embedding';
      done = 0;
      lastError = null;
      startedAt = Date.now();

      // The run is not awaited: the tool call returns at once.
      void run();

      return 'started';
    },

    status(): EmbedderStatus {
      const settings = embeddingSettings();
      const key = process.env[settings.apiKeyEnv];
      const keyPresent = typeof key === 'string' && key.trim().length > 0;
      return {
        running,
        phase,
        done,
        pending: pendingTexts(settings.model),
        model: settings.model,
        enabled: settings.enabled,
        available: ctx.embedder.available,
        key_present: keyPresent,
        last_error: lastError,
        started_at_ms: startedAt,
        elapsed_ms: startedAt === null ? 0 : Math.max(0, Date.now() - startedAt),
      };
    },
  };
}
