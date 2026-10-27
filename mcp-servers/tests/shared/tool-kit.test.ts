/**
 * tool-kit.test.ts - the shared shape of the answers of the tools.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  cursorMismatchMessage,
  decodeCursor,
  encodeCursor,
  errorResult,
  okResult,
  renderLines,
  signatureOf,
} from '../../src/shared/tool-kit.ts';

describe('okResult', () => {
  it('carries the text and the structure', () => {
    const result = okResult({ total: 2 }, 'two titles');

    assert.equal(result.isError, undefined);
    assert.equal(result.content[0]?.type, 'text');
    assert.equal(
      result.content[0]?.type === 'text' ? result.content[0].text : '',
      'two titles',
    );
    assert.deepEqual(result.structuredContent, { total: 2 });
  });
});

describe('errorResult', () => {
  it('is an error and carries the sentence', () => {
    const result = errorResult('Genre not found.');

    assert.equal(result.isError, true);
    assert.equal(
      result.content[0]?.type === 'text' ? result.content[0].text : '',
      'Genre not found.',
    );
    // There is no structured content: the output schema describes the
    // successful answer.
    assert.equal(result.structuredContent, undefined);
  });
});

describe('renderLines', () => {
  it('joins the lines', () => {
    assert.equal(renderLines(['one', 'two']), 'one\ntwo');
    assert.equal(renderLines([]), '');
  });
});

describe('the cursor', () => {
  it('keeps the offset and the signature', () => {
    const cursor = { offset: 20, signature: 'abc123' };
    const decoded = decodeCursor(encodeCursor(cursor));

    assert.deepEqual(decoded, cursor);
  });

  it('holds nothing of the catalogue', () => {
    const encoded = encodeCursor({ offset: 5, signature: 'abc' });

    assert.equal(encoded.includes('Кали'), false);
    assert.equal(/[A-Za-z0-9_-]+/.test(encoded), true);
  });

  it('reads a broken cursor as null', () => {
    assert.equal(decodeCursor(''), null);
    assert.equal(decodeCursor('not a cursor'), null);
    assert.equal(decodeCursor(Buffer.from('{"o":-1,"s":"a"}', 'utf8').toString('base64url')), null);
    assert.equal(decodeCursor(Buffer.from('{"o":"x","s":"a"}', 'utf8').toString('base64url')), null);
  });

  it('has a sentence for a cursor of another query', () => {
    assert.match(cursorMismatchMessage(), /different query/);
  });
});

describe('signatureOf', () => {
  it('is the same for the same parts', () => {
    assert.equal(signatureOf(['a', 1, true]), signatureOf(['a', 1, true]));
  });

  it('is different for other parts', () => {
    assert.notEqual(signatureOf(['a', 1]), signatureOf(['a', 2]));
    assert.notEqual(signatureOf(['a', 1]), signatureOf(['b', 1]));
  });
});
