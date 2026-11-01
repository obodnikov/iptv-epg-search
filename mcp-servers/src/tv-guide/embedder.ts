/**
 * embedder.ts - the background worker that embeds the texts of the guide.
 *
 * The import fills the queue of the texts that have to be embedded
 * (`queue.ts`); this worker empties it. It runs in the background: a tool
 * call never waits for it (decision D15).
 *
 * The worker is a separate thing from the refresh of the guide:
 *
 * - the refresh downloads the guide and writes it; it takes tens of
 *   seconds;
 * - the embedding asks the service for a vector of every distinct text;
 *   on the real guide it takes about an hour and it costs money.
 *
 * The two have their own locks (`refresh.lock` and `embed.lock`), so that
 * a running embedding does not stop a refresh and the other way round.
 *
 * The rules (the cinema worker works the same way, `src/cinema/embedder.ts`):
 * - the vectors of two models are never compared: the queue holds the work
 *   of the active model only;
 * - a text that is shorter than `embeddings.minTextChars` is never
 *   embedded: it is only searched by words;
 * - a failure of the service stops the run; the queue keeps the texts that
 *   were not embedded, and the next run takes them again.
 *
 * After every batch of fresh vectors the worker gives the texts their
 * meaning kind (`meaning.ts`, §4.3 step 4), and once per run it applies
 * the kind to the texts whose vector was already there but whose source
 * the last import reset.
 */

import { join } from 'node:path';

import { type Db } from '../shared/db.ts';
import { type Logger } from '../shared/log.ts';
import { type SettingsStore } from '../shared/settings.ts';
import { type TextEmbedder } from '../shared/embeddings.ts';
import { acquireLock } from '../shared/lock.ts';
import { safeForLog } from '../shared/embeddings.ts';
import { ensureVectorSchema, putVectors } from '../shared/vectors.ts';
import { QueryCache } from '../shared/query-cache.ts';
import { readTvGuideSettings } from './config.ts';
import {
  dropForeignQueueRows,
  nextQueuedTexts,
  pruneVectorQueue,
  queueMissingVectors,
  removeQueuedTexts,
} from './queue.ts';
import {
  applyMeaningKinds,
  applyMeaningKindsCatchUp,
  labelVectors,
} from './meaning.ts';

/** The name of the lock file of the embedding run. */
export const EMBED_LOCK_FILE = 'embed.lock';

/**
 * How many times a batch is asked for again when the service fails.
 *
 * The client repeats a failed request by itself; this is the second try of
 * the whole batch, for the failures that pass a batch but not a single
 * request (a rate limit that lasts longer than the backoff, for example).
 */
export const BATCH_ATTEMPTS = 3;

/**
 * The wait before the second attempt of a batch, and before the third.
 */
export const BATCH_DELAYS_MS = [5_000, 20_000];

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
  /** How many times a batch is asked for again; the tests make it short. */
  batchAttempts?: number;
  /** The wait between two attempts of a batch; the tests make it short. */
  batchDelaysMs?: number[];
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
 * Ask the service for the vectors of a batch.
 *
 * A batch that is not answered is asked for again: the client repeats a
 * failed request by itself, but a failure that lasts longer than the
 * backoff of the client needs a second try of the whole batch. The reason
 * of the last failure is in the message, so that the log says what the
 * service answered.
 *
 * @throws Error when the service does not answer the batch.
 */
async function embedBatch(
  ctx: EmbedderContext,
  texts: string[],
): Promise<Float32Array[]> {
  const attempts = Math.max(1, ctx.batchAttempts ?? BATCH_ATTEMPTS);
  const delays = ctx.batchDelaysMs ?? BATCH_DELAYS_MS;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const vectors = await ctx.embedder.embedMany(texts);
    if (vectors && vectors.length === texts.length) return vectors;

    const reason = ctx.embedder.lastError ?? 'the service did not answer every text';
    if (attempt === attempts) {
      throw new Error(`the embedding service did not answer every text: ${reason}`);
    }

    const delay = delays[attempt - 1] ?? delays[delays.length - 1] ?? 20_000;
    ctx.logger.warn('the embedding service did not answer a batch', {
      attempt,
      texts: texts.length,
      reason,
      delay_ms: delay,
    });
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  // The loop always returns or throws.
  throw new Error('the embedding service did not answer every text');
}

/**
 * The worker of the embeddings of the TV guide.
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
    return readTvGuideSettings(ctx.settings.settings()).embeddings;
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
   * The vectors of the label texts of the kinds, out of the cache.
   *
   * The labels are query-side texts: they ride in the cache of the query
   * vectors and cost nothing after the first run.
   */
  async function labelsOf(model: string) {
    const cache = new QueryCache(ctx.db);
    return labelVectors(
      ctx.embedder,
      (text) => cache.get(model, text),
      (text, vector) => cache.set(model, text, vector),
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
      // The texts that no programme carries any more.
      pruneVectorQueue(ctx.db);
      // The texts that have no vector for the active model. This is what
      // fills the queue again after a change of the model.
      queueMissingVectors(ctx.db, {
        embeddingModel: model,
        minTextChars: settings.minTextChars,
        embeddingsEnabled: settings.enabled,
        now: Math.floor(Date.now() / 1000),
      });

      // The kind of the texts whose vector is already there, but whose
      // source the last import reset. The labels may not be readable (the
      // service is down): the pass then waits for the next run.
      const labels = await labelsOf(model);
      if (labels) {
        const rekindled = applyMeaningKindsCatchUp(ctx.db, model, labels);
        if (rekindled > 0) {
          ctx.logger.info('the meaning kind was applied', { texts: rekindled });
        }
      } else {
        ctx.logger.warn('the labels of the kinds could not be embedded');
      }

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

        const vectors = await embedBatch(ctx, texts.map((entry) => entry.text));

        const now = Date.now();
        putVectors(
          ctx.db,
          texts.map((entry, index) => ({
            textHash: entry.embedHash,
            model: current.model,
            embedding: vectors[index] as Float32Array,
            createdAt: now,
          })),
        );
        removeQueuedTexts(
          ctx.db,
          current.model,
          texts.map((entry) => entry.embedHash),
        );

        // The fresh vectors give their texts the meaning kind at once, so
        // that the search sees the kinds as the vectors arrive.
        if (labels) {
          applyMeaningKinds(
            ctx.db,
            texts.map((entry, index) => ({
              embedHash: entry.embedHash,
              vector: vectors[index] as Float32Array,
            })),
            labels,
          );
        }

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
        // The key is missing: the search falls back to the words. The name
        // of the variable is written down, but only when it is a name: a
        // setting that holds the key itself must never reach the log.
        ctx.logger.warn('the key of the embedding service is not in the environment', {
          variable: safeForLog(settings.apiKeyEnv),
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
