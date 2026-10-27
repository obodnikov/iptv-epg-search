import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { detectLanguage, normalizeText, normalizeTitle, snippet, stemText, words } from '../../src/shared/text.ts';

describe('detectLanguage', () => {
  it('detects Russian', () => {
    assert.equal(detectLanguage('тихая французская драма о семье'), 'russian');
    assert.equal(detectLanguage('что это'), 'russian');
    assert.equal(detectLanguage('Цинга'), 'russian');
  });

  it('detects English', () => {
    assert.equal(detectLanguage('a quiet french drama about family'), 'english');
    assert.equal(detectLanguage('The Silence of the Lambs'), 'english');
  });

  it('falls back to English for an empty text', () => {
    assert.equal(detectLanguage(''), 'english');
  });
});

describe('stemText', () => {
  it('stems Russian word forms to the same stem', () => {
    assert.equal(stemText('убийство', 'russian'), 'убийств');
    assert.equal(stemText('убийства', 'russian'), 'убийств');
    assert.equal(stemText('убийству', 'russian'), 'убийств');
  });

  it('stems English word forms to the same stem', () => {
    assert.equal(stemText('films', 'english'), 'film');
    assert.equal(stemText('film', 'english'), 'film');
  });

  it('drops punctuation', () => {
    // The Russian Snowball stemmer removes the endings: "кали" -> "кал",
    // "она" -> "он".
    assert.equal(stemText('Кали, она же', 'russian'), 'кал он же');
  });

  it('returns an empty string for an empty text', () => {
    assert.equal(stemText('', 'russian'), '');
  });

  it('guesses the language when none is given', () => {
    assert.equal(stemText('фильмы'), 'фильм');
  });
});

describe('normalizeTitle', () => {
  it('lower cases, replaces ё and collapses punctuation', () => {
    assert.equal(normalizeTitle('Кали (4K HDR)'), 'кали 4k hdr');
    assert.equal(normalizeTitle('Ёлка'), 'елка');
    assert.equal(normalizeTitle('Бабье  царство'), 'бабье царство');
  });
  it('keeps the letters of every script', () => {
    // Two titles of different languages must not end up as the same key.
    assert.equal(normalizeTitle('影武者'), '影武者');
    assert.equal(normalizeTitle('Amélie'), 'amélie');
    assert.notEqual(normalizeTitle('Амели'), normalizeTitle('Amélie'));
  });

  it('does not let two different titles collapse into nothing', () => {
    const first = normalizeTitle('Сталкер');
    const second = normalizeTitle('Зори');
    assert.notEqual(first, second);
    assert.ok(first.length > 0 && second.length > 0);
  });

  it('returns an empty string for an empty text', () => {
    assert.equal(normalizeTitle(''), '');
  });
});

describe('normalizeText', () => {
  it('collapses the spaces and replaces ё', () => {
    assert.equal(normalizeText('  Кали   и  Ёлка '), 'Кали и Елка');
  });
});

describe('snippet', () => {
  it('cuts on a word boundary', () => {
    const text = 'one two three four five six';
    assert.equal(snippet(text, 10), 'one two…');
  });

  it('keeps a short text as it is', () => {
    assert.equal(snippet('short', 100), 'short');
  });
});

describe('words', () => {
  it('keeps the letters and the digits only', () => {
    // The punctuation is removed, not replaced by a space: the web app's
    // stemText does the same (public/scripts/utils/fuzzySearch.js:61).
    assert.deepEqual(words('Кали, и ёлочка-2!'), ['Кали', 'и', 'ёлочка2']);
  });
});
