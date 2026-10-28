/**
 * embeddings.test.ts - the OpenRouter client of the servers.
 *
 * The client is tested with a fake `fetch`: the tests never reach the
 * network (design: iptv-mcp-servers.md §10).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EmbeddingError,
  createFakeEmbedder,
  deterministicEmbedding,
  embedTexts,
  parseEmbeddings,
  retryAfterMs,
  type FetchLike,
} from '../../src/shared/embeddings.ts';

/**
 * An answer of the service: one vector per text.
 */
function answer(vectors: number[][], status = 200, headers: Record<string, string> = {}): Response {
  return new Response(
    JSON.stringify({
      object: 'list',
      data: vectors.map((embedding, index) => ({ object: 'embedding', embedding, index })),
    }),
    { status, headers: { 'Content-Type': 'application/json', ...headers } },
  );
}

/**
 * A `fetch` that answers with the given answers, one after the other.
 */
function fakeFetch(answers: Response[]): { fetch: FetchLike; calls: number[] } {
  const calls: number[] = [];
  let index = 0;

  const fetchImpl: FetchLike = async (_url, init) => {
    calls.push(JSON.parse(String(init?.body ?? '{}')).input.length);
    const response = answers[index] ?? answers[answers.length - 1];
    index += 1;
    if (!response) throw new Error('the fake fetch has no answer left');
    return response;
  };

  return { fetch: fetchImpl, calls };
}

/**
 * The wait between two attempts, without the waiting.
 */
function noSleep(): { sleep: (ms: number) => Promise<void>; delays: number[] } {
  const delays: number[] = [];
  return {
    sleep: async (ms: number) => {
      delays.push(ms);
    },
    delays,
  };
}

describe('embedTexts', () => {
  it('sends the texts in batches', async () => {
    const { fetch: fetchImpl, calls } = fakeFetch([
      answer([[1, 0], [0, 1], [1, 1]]),
      answer([[0, 1], [1, 0]]),
    ]);

    const outcome = await embedTexts(['a', 'b', 'c', 'd', 'e'], {
      model: 'BAAI/bge-m3',
      apiKey: 'KEY',
      batchSize: 3,
      fetchImpl,
      sleep: async () => {},
    });

    assert.equal(outcome.vectors.length, 5);
    assert.equal(outcome.dim, 2);
    assert.equal(outcome.requests, 2);
    assert.deepEqual(calls, [3, 2]);
  });

  it('keeps the order of the texts', async () => {
    // The service answers out of order: the second vector comes first.
    const outOfOrder = new Response(
      JSON.stringify({
        data: [
          { embedding: [0, 1], index: 1 },
          { embedding: [1, 0], index: 0 },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

    const outcome = await embedTexts(['a', 'b'], {
      model: 'm',
      apiKey: 'KEY',
      fetchImpl: async () => outOfOrder,
      sleep: async () => {},
    });

    assert.deepEqual([...outcome.vectors[0] as Float32Array], [1, 0]);
    assert.deepEqual([...outcome.vectors[1] as Float32Array], [0, 1]);
  });

  it('repeats a request that the service could not answer', async () => {
    const { fetch: fetchImpl, calls } = fakeFetch([
      new Response('too much', { status: 500 }),
      answer([[1, 2]]),
    ]);
    const { sleep, delays } = noSleep();

    const outcome = await embedTexts(['a'], {
      model: 'm',
      apiKey: 'KEY',
      fetchImpl,
      sleep,
    });

    assert.equal(outcome.vectors.length, 1);
    assert.equal(calls.length, 2);
    // The delay grows: the first one is a second.
    assert.deepEqual(delays, [1000]);
  });

  it('obeys the Retry-After of the service', async () => {
    const { fetch: fetchImpl } = fakeFetch([
      new Response('slow down', { status: 429, headers: { 'Retry-After': '7' } }),
      answer([[1, 2]]),
    ]);
    const { sleep, delays } = noSleep();

    await embedTexts(['a'], { model: 'm', apiKey: 'KEY', fetchImpl, sleep });

    assert.deepEqual(delays, [7000]);
  });

  it('does not repeat a request that cannot work', async () => {
    const { fetch: fetchImpl, calls } = fakeFetch([
      new Response('no such model', { status: 400 }),
    ]);

    await assert.rejects(
      () =>
        embedTexts(['a'], {
          model: 'm',
          apiKey: 'KEY',
          fetchImpl,
          sleep: async () => {},
        }),
      (error: unknown) => {
        assert.ok(error instanceof EmbeddingError);
        assert.match(error.message, /400/);
        return true;
      },
    );

    assert.equal(calls.length, 1);
  });

  it('gives up after the last try', async () => {
    const { fetch: fetchImpl, calls } = fakeFetch([
      new Response('down', { status: 503 }),
    ]);

    await assert.rejects(
      () =>
        embedTexts(['a'], {
          model: 'm',
          apiKey: 'KEY',
          fetchImpl,
          sleep: async () => {},
          maxRetries: 2,
        }),
      EmbeddingError,
    );

    // The first try and two more.
    assert.equal(calls.length, 3);
  });

  it('never puts the key into the message of a failure', async () => {
    const { fetch: fetchImpl } = fakeFetch([
      new Response('no such model', { status: 400 }),
    ]);

    await assert.rejects(
      () =>
        embedTexts(['a'], {
          model: 'm',
          apiKey: 'sk-secret-key',
          fetchImpl,
          sleep: async () => {},
        }),
      (error: unknown) => {
        assert.ok(error instanceof EmbeddingError);
        assert.equal(error.message.includes('sk-secret-key'), false);
        return true;
      },
    );
  });
});

describe('parseEmbeddings', () => {
  it('refuses an answer with the wrong number of vectors', () => {
    assert.throws(
      () => parseEmbeddings({ data: [{ embedding: [1], index: 0 }] }, 2),
      EmbeddingError,
    );
  });

  it('refuses a vector that is not a list of numbers', () => {
    assert.throws(
      () => parseEmbeddings({ data: [{ embedding: ['x'], index: 0 }] }, 1),
      EmbeddingError,
    );
  });

  it('refuses vectors of different lengths', () => {
    assert.throws(
      () =>
        parseEmbeddings(
          {
            data: [
              { embedding: [1, 2], index: 0 },
              { embedding: [1], index: 1 },
            ],
          },
          2,
        ),
      EmbeddingError,
    );
  });
});

describe('retryAfterMs', () => {
  it('reads a number of seconds', () => {
    const response = new Response('', { status: 429, headers: { 'Retry-After': '3' } });
    assert.equal(retryAfterMs(response), 3000);
  });

  it('has nothing when the answer does not say', () => {
    const response = new Response('', { status: 429 });
    assert.equal(retryAfterMs(response), null);
  });
});

describe('the fake embedder', () => {
  it('gives the same vector for the same text', () => {
    const one = deterministicEmbedding('Кали');
    const two = deterministicEmbedding('Кали');

    assert.deepEqual([...one], [...two]);
    assert.equal(one.length, 1024);
  });

  it('gives another vector for another text', () => {
    const one = deterministicEmbedding('Кали');
    const two = deterministicEmbedding('Бабье царство');

    assert.notDeepEqual([...one], [...two]);
  });

  it('answers with a vector', async () => {
    const embedder = createFakeEmbedder();

    assert.equal(embedder.available, true);
    const vector = await embedder.embed('Кали');
    assert.ok(vector);
    assert.equal(vector.length, 1024);
  });

  it('answers with nothing for an empty text', async () => {
    const embedder = createFakeEmbedder();
    assert.equal(await embedder.embed('   '), null);
  });

  it('answers with one vector per text', async () => {
    const embedder = createFakeEmbedder({ dim: 8 });
    const vectors = await embedder.embedMany(['a', 'b', 'c']);

    assert.equal(vectors?.length, 3);
    assert.equal(vectors?.[0]?.length, 8);
  });
});
