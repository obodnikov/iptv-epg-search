/**
 * blend.test.ts - the arithmetic of the blend.
 *
 * The blend mixes the words and the meaning of a query
 * (design: iptv-mcp-servers.md §7.1 step 4): both scores are rescaled to
 * 0-1 inside the candidate set, and then
 * `score = meaningWeight * meaning + (1 - meaningWeight) * words`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { blendCandidates, rescale, type Candidate } from '../../src/cinema/blend.ts';

/**
 * A score, rounded: the arithmetic of the blend is a division.
 */
function round(value: number | undefined): number {
  return Math.round((value ?? 0) * 1e6) / 1e6;
}

describe('rescale', () => {
  it('puts the best value at 1 and the worst at 0', () => {
    const range = { min: 1, max: 3 };
    assert.equal(rescale(3, range), 1);
    assert.equal(rescale(1, range), 0);
    assert.equal(rescale(2, range), 0.5);
  });

  it('has nothing without a range', () => {
    assert.equal(rescale(1, null), 0);
  });

  it('gives 1 when every value is the same', () => {
    assert.equal(rescale(5, { min: 5, max: 5 }), 1);
  });
});

describe('blendCandidates', () => {
  const candidates: Candidate[] = [
    // The best match by words, the worst by meaning.
    { title_id: 'a', words: -10, distance: 1.1 },
    // In the middle of both.
    { title_id: 'b', words: -7.5, distance: 0.6 },
    // The best match by meaning, the worst by words.
    { title_id: 'c', words: -5, distance: 0.1 },
    // Found by the meaning alone.
    { title_id: 'd', words: null, distance: 0.35 },
  ];

  it('gives the best match by words the score 1', () => {
    const scores = blendCandidates(candidates, 0);

    // Only the words count: the bm25 of -10 is the best, so it gets 1.
    assert.equal(round(scores.get('a')), 1);
    assert.equal(round(scores.get('b')), 0.5);
    assert.equal(round(scores.get('c')), 0);
    // A title that matched no word gets 0.
    assert.equal(round(scores.get('d')), 0);
  });

  it('gives the nearest title the score 1', () => {
    const scores = blendCandidates(candidates, 1);

    assert.equal(round(scores.get('c')), 1);
    assert.equal(round(scores.get('b')), 0.5);
    assert.equal(round(scores.get('a')), 0);
    // A title without a vector gets 0.
    assert.equal(round(scores.get('d')), 0.75);
  });

  it('mixes the two sides with the weight', () => {
    const scores = blendCandidates(candidates, 0.7);

    // a: 0.7 * 0 + 0.3 * 1
    assert.equal(round(scores.get('a')), 0.3);
    // b: 0.7 * 0.5 + 0.3 * 0.5
    assert.equal(round(scores.get('b')), 0.5);
    // c: 0.7 * 1 + 0.3 * 0
    assert.equal(round(scores.get('c')), 0.7);
    // d: 0.7 * 0.75 + 0.3 * 0
    assert.equal(round(scores.get('d')), 0.525);
  });

  it('gives a title that was found by one side only 0 for the other', () => {
    const scores = blendCandidates(
      [{ title_id: 'only-meaning', words: null, distance: 0.2 }],
      0.5,
    );

    // There is only one candidate, so the meaning is 1 and the words 0.
    assert.equal(scores.get('only-meaning'), 0.5);
  });

  it('keeps the weight inside its bounds', () => {
    const over = blendCandidates(candidates, 5);
    const meaningOnly = blendCandidates(candidates, 1);

    assert.deepEqual(over.get('b'), meaningOnly.get('b'));

    const under = blendCandidates(candidates, -1);
    const wordsOnly = blendCandidates(candidates, 0);

    assert.deepEqual(under.get('a'), wordsOnly.get('a'));
  });

  it('has nothing for an empty set', () => {
    const scores = blendCandidates([], 0.7);
    assert.equal(scores.size, 0);
  });
});
