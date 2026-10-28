/**
 * embeddings.ts - the OpenRouter client of the servers.
 *
 * The client turns texts into vectors (design: iptv-mcp-servers.md §4.3,
 * §6.2). It is shared: the Cinema server embeds its titles, the TV Guide
 * server its channel groups.
 *
 * The rules:
 * - the key comes from the environment and is never logged;
 * - the texts go in batches; the answer is sorted by `index`, so that every
 *   text keeps its vector;
 * - a request that failed is repeated with a backoff, and the `Retry-After`
 *   of the service is obeyed;
 * - a request that cannot succeed (a 4xx that is not a rate limit) fails at
 *   once: repeating it would cost money and change nothing.
 *
 * The tests do not reach the network: they use the fake embedder at the
 * bottom of this file, whose vector is a function of the text
 * (design: iptv-mcp-servers.md §10).
 */

/** The endpoint of the service. */
export const OPENROUTER_EMBEDDINGS_URL = 'https://openrouter.ai/api/v1/embeddings';

/** The number of texts in one request, when the settings say nothing. */
export const DEFAULT_BATCH_SIZE = 50;

/** The timeout of one request. */
export const DEFAULT_TIMEOUT_MS = 120_000;

/** How many times a request is repeated after a failure. */
export const DEFAULT_MAX_RETRIES = 3;

/** The first delay between two attempts. */
export const DEFAULT_RETRY_DELAY_MS = 1000;

/** The number of dimensions of the fake vectors. */
export const FAKE_DIMENSIONS = 1024;

/** The `fetch` the client uses; the tests replace it. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * A failure of the embedding service.
 *
 * The message never holds the key.
 */
export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

/** What the client needs to know about the embeddings. */
export interface EmbedderSettings {
  /** The embeddings are switched off. */
  enabled: boolean;
  /** The model the vectors are made for, e.g. `BAAI/bge-m3`. */
  model: string;
  /** The environment variable that holds the key. */
  apiKeyEnv: string;
  /** The number of texts in one request. */
  batchSize: number;
}

/** The information about a repeated request. */
export interface RetryInfo {
  /** Which attempt it was, counting from 1. */
  attempt: number;
  /** How long the client waited before the next attempt. */
  delayMs: number;
  /** The status of the answer that failed. */
  status: number;
  /** Why the request was repeated. */
  reason: string;
}

/** The options of the client. */
export interface EmbeddingOptions {
  /** The model the vectors are made for. */
  model: string;
  /** The number of texts in one request. */
  batchSize?: number;
  /** The key of the service. */
  apiKey: string;
  /** How many times a request is repeated after a failure. */
  maxRetries?: number;
  /** The first delay between two attempts. */
  retryDelayMs?: number;
  /** The timeout of one request. */
  timeoutMs?: number;
  /** The `fetch` to use; the default is the one of Node. */
  fetchImpl?: FetchLike;
  /** The wait between two attempts; the tests make it a no-op. */
  sleep?: (ms: number) => Promise<void>;
  /** Called before every repeated request. */
  onRetry?: (info: RetryInfo) => void;
  /** The endpoint; the default is the one of OpenRouter. */
  url?: string;
}

/** What a call of the client gives back. */
export interface EmbeddingOutcome {
  /** One vector per text, in the order of the texts. */
  vectors: Float32Array[];
  /** The number of dimensions of the vectors. */
  dim: number;
  /** How many requests were sent. */
  requests: number;
}

/**
 * The object the servers use to embed texts.
 *
 * It hides the key, the retries and the failures: the servers ask for a
 * vector and get one, or get nothing.
 */
export interface TextEmbedder {
  /** The model the vectors are made for. */
  readonly model: string;
  /** True when the embeddings can be used at all. */
  readonly available: boolean;
  /**
   * The reason of the last failure, or null.
   *
   * The client hides the failures from the search (the search falls back to
   * the words), but the reason has to reach the log: without it a failed
   * run only says that "the service did not answer every text".
   */
  readonly lastError?: string | null;
  /** Embed one text. Returns null when it is not possible. */
  embed(text: string): Promise<Float32Array | null>;
  /** Embed many texts. Returns null when it is not possible. */
  embedMany(texts: string[]): Promise<Float32Array[] | null>;
}

/**
 * True when a value is the name of an environment variable.
 *
 * The setting `embeddings.apiKeyEnv` holds the **name** of the variable
 * that holds the key, never the key itself. A value that is not a name is
 * a mistake (the key was pasted into the setting), and it must never reach
 * the log: it is a secret then.
 */
export function isEnvVarName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

/**
 * A value of the settings that may be a secret, ready for the log.
 *
 * A value that is the name of an environment variable is written as it is;
 * anything else is only described, never written down.
 */
export function safeForLog(value: string): string {
  if (isEnvVarName(value)) return value;
  return `a value that is not the name of an environment variable (${value.length} characters)`;
}

/**
 * The wait between two attempts.
 */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * The `Retry-After` of an answer, in milliseconds.
 *
 * The header holds either a number of seconds or a moment in time.
 *
 * @returns the delay, or null when the answer does not say.
 */
export function retryAfterMs(response: Response): number | null {
  const header = response.headers?.get?.('retry-after');
  if (!header) return null;

  const seconds = Number(header.trim());
  if (Number.isFinite(seconds)) {
    return seconds >= 0 ? Math.round(seconds * 1000) : null;
  }

  const moment = Date.parse(header);
  if (Number.isNaN(moment)) return null;
  return Math.max(0, moment - Date.now());
}

/**
 * The body of an answer that failed, as a short text.
 *
 * The answer of the service may hold the text of the error; it never holds
 * the key.
 */
async function errorText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 300);
  } catch {
    return '';
  }
}

/**
 * The vector of one entry of the answer.
 */
function toVector(entry: unknown, index: number): Float32Array {
  if (typeof entry !== 'object' || entry === null) {
    throw new EmbeddingError(`the answer of the embedding service has no vector at ${index}`);
  }
  const embedding = (entry as { embedding?: unknown }).embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new EmbeddingError(`the answer of the embedding service has no vector at ${index}`);
  }

  const vector = new Float32Array(embedding.length);
  for (let i = 0; i < embedding.length; i += 1) {
    const value = embedding[i];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new EmbeddingError(
        `the vector at ${index} of the answer of the embedding service holds a value that is not a number`,
      );
    }
    vector[i] = value;
  }
  return vector;}

/**
 * The index of one entry of the answer.
 */
function entryIndex(entry: unknown, fallback: number): number {
  if (typeof entry !== 'object' || entry === null) return fallback;
  const index = (entry as { index?: unknown }).index;
  return typeof index === 'number' && Number.isFinite(index) ? index : fallback;
}

/**
 * Read the vectors of an answer.
 *
 * The entries are sorted by their `index`, so that every text keeps its own
 * vector even when the service answers out of order.
 */
export function parseEmbeddings(body: unknown, expected: number): Float32Array[] {
  if (typeof body !== 'object' || body === null) {
    throw new EmbeddingError('the answer of the embedding service is not an object');
  }

  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    throw new EmbeddingError('the answer of the embedding service holds no data');
  }
  if (data.length !== expected) {
    throw new EmbeddingError(
      `the embedding service answered ${data.length} vectors for ${expected} texts`,
    );
  }

  const sorted = data
    .map((entry, position) => ({ entry, index: entryIndex(entry, position) }))
    .sort((left, right) => left.index - right.index);

  const vectors = sorted.map((item) => toVector(item.entry, item.index));

  const dim = vectors[0]?.length ?? 0;
  for (const vector of vectors) {
    if (vector.length !== dim) {
      throw new EmbeddingError(
        'the vectors of one answer of the embedding service do not have the same length',
      );
    }
  }

  return vectors;
}

/**
 * Send one request and read the vectors of its answer.
 */
async function embedBatch(
  texts: string[],
  options: EmbeddingOptions,
): Promise<{ vectors: Float32Array[]; requests: number }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = options.url ?? OPENROUTER_EMBEDDINGS_URL;

  let attempt = 0;
  let requests = 0;

  for (;;) {
    attempt += 1;
    requests += 1;

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({ model: options.model, input: texts }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // The network failed, or the request took too long. Both may work the
      // next time.
      if (attempt > maxRetries) {
        throw new EmbeddingError(
          `the embedding service could not be reached: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const delay = retryDelayMs * 2 ** (attempt - 1);
      options.onRetry?.({ attempt, delayMs: delay, status: 0, reason: 'the request failed' });
      await sleep(delay);
      continue;
    }

    if (response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        throw new EmbeddingError(
          `the answer of the embedding service is not JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return { vectors: parseEmbeddings(body, texts.length), requests };
    }

    const status = response.status;
    // A rate limit and a server error may pass. The other answers will not:
    // repeating them would cost money and change nothing.
    const retryable = status === 429 || status >= 500;

    if (!retryable || attempt > maxRetries) {
      const detail = await errorText(response);
      throw new EmbeddingError(
        `the embedding service answered with the status ${status}${detail ? `: ${detail}` : ''}`,
      );
    }

    const delay = retryAfterMs(response) ?? retryDelayMs * 2 ** (attempt - 1);
    options.onRetry?.({
      attempt,
      delayMs: delay,
      status,
      reason: `the service answered with the status ${status}`,
    });
    await sleep(delay);
  }
}

/**
 * Embed texts.
 *
 * The texts go in batches of `batchSize`; the vectors come back in the
 * order of the texts.
 *
 * @throws EmbeddingError when the service cannot answer.
 */
export async function embedTexts(
  texts: string[],
  options: EmbeddingOptions,
): Promise<EmbeddingOutcome> {
  if (texts.length === 0) return { vectors: [], dim: 0, requests: 0 };

  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
  const vectors: Float32Array[] = [];
  let dim = 0;
  let requests = 0;

  for (let start = 0; start < texts.length; start += batchSize) {
    const batch = texts.slice(start, start + batchSize);
    const outcome = await embedBatch(batch, options);
    requests += outcome.requests;
    for (const vector of outcome.vectors) {
      vectors.push(vector);
      if (dim === 0) dim = vector.length;
    }
  }

  return { vectors, dim, requests };
}

/**
 * The OpenRouter embedder of a server.
 *
 * The settings are read on every call: the model and the switch of the
 * settings file take effect without a restart. The key comes from the
 * environment, and it is never written down anywhere.
 */
export function createOpenRouterEmbedder(
  getSettings: () => EmbedderSettings,
  options: Omit<EmbeddingOptions, 'apiKey' | 'model'> = {},
): TextEmbedder {
  const keyOf = (settings: EmbedderSettings): string | null => {
    const value = process.env[settings.apiKeyEnv];
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  // The reason of the last failure. The search does not fail because of
  // it, but the log has to say what the service answered.
  let lastError: string | null = null;

  const embedder: TextEmbedder = {
    get model(): string {
      return getSettings().model;
    },
    get available(): boolean {
      const settings = getSettings();
      if (!settings.enabled) return false;
      return keyOf(settings) !== null;
    },
    get lastError(): string | null {
      return lastError;
    },
    async embed(text: string): Promise<Float32Array | null> {
      const settings = getSettings();
      if (!settings.enabled) return null;
      const key = keyOf(settings);
      if (!key) return null;
      if (!text.trim()) return null;

      try {
        const outcome = await embedTexts([text], {
          ...options,
          apiKey: key,
          model: settings.model,
          batchSize: 1,
        });
        lastError = null;
        return outcome.vectors[0] ?? null;
      } catch (error) {
        // A failure of the service must not fail the search: the search
        // falls back to the words. The reason is kept for the log.
        lastError = error instanceof Error ? error.message : String(error);
        return null;
      }
    },
    async embedMany(texts: string[]): Promise<Float32Array[] | null> {
      const settings = getSettings();
      if (!settings.enabled) return null;
      const key = keyOf(settings);
      if (!key) return null;
      if (texts.length === 0) return [];

      try {
        const outcome = await embedTexts(texts, {
          ...options,
          apiKey: key,
          model: settings.model,
          batchSize: settings.batchSize,
        });
        lastError = null;
        return outcome.vectors;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        return null;
      }
    },
  };

  return embedder;
}

/**
 * A vector that is a function of the text.
 *
 * The tests use it: the same text always gives the same vector, and two
 * different texts give two vectors that are almost at right angles to each
 * other.
 */
export function deterministicEmbedding(text: string, dim = FAKE_DIMENSIONS): Float32Array {
  // The sha256 of the text is the seed: it is stable and it is spread over
  // the whole text.
  let state = 0;
  for (let i = 0; i < text.length; i += 1) {
    state = (state * 31 + text.charCodeAt(i)) >>> 0;
  }
  if (state === 0) state = 0x9e3779b9;

  const vector = new Float32Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i += 1) {
    // xorshift32
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    const value = (state / 4294967296) * 2 - 1;
    vector[i] = value;
    norm += value * value;
  }

  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i += 1) vector[i] = (vector[i] ?? 0) / norm;
  }
  return vector;
}

/**
 * The fake embedder of the tests and of the local scripts.
 *
 * @param options The model, the number of dimensions and the function that
 *   makes the vector of a text. Without one, the vector is a function of
 *   the text itself.
 */
export function createFakeEmbedder(
  options: {
    model?: string;
    dim?: number;
    embed?: (text: string) => Float32Array;
  } = {},
): TextEmbedder {
  const model = options.model ?? 'fake/model';
  const dim = options.dim ?? FAKE_DIMENSIONS;
  const make = options.embed ?? ((text: string) => deterministicEmbedding(text, dim));

  return {
    model,
    available: true,
    lastError: null,
    async embed(text: string): Promise<Float32Array | null> {
      if (!text.trim()) return null;
      return make(text);
    },
    async embedMany(texts: string[]): Promise<Float32Array[] | null> {
      return texts.map((text) => make(text));
    },
  };
}
