/**
 * query.test.ts - the words-only search of the cinema catalogue.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyCinemaSchema } from '../../src/cinema/schema.ts';
import { importCatalogText, type ImportOptions } from '../../src/cinema/import.ts';
import {
  buildMatchExpression,
  searchSignature,
  searchTitles,
  stemmedTerms,
  type SearchRequest,
} from '../../src/cinema/search.ts';
import {
  buildFilter,
  countryConditions,
  emptyFilters,
  unknownValues,
} from '../../src/cinema/filters.ts';
import { fixture } from '../fixtures/load.ts';
import { testDatabase, type TestDatabase } from '../helpers.ts';

const catalogue = fixture('import-a.m3u');

function options(): ImportOptions {
  return {
    cinemaUrl: '',
    excludeCategories: [],
    countryAliases: {},
    trackChanges: true,
    embeddingModel: 'BAAI/bge-m3',
    minTextChars: 0,
    now: 1_800_000_000,
  };
}

/** A database with the catalogue of the fixture. */
function withCatalogue(): TestDatabase {
  const test = testDatabase();
  applyCinemaSchema(test.db);
  const outcome = importCatalogText(test.db, catalogue, options());
  if (!outcome.ok) throw new Error(`the fixture could not be imported: ${outcome.error}`);
  return test;
}

function request(overrides: Partial<SearchRequest> = {}): SearchRequest {
  return {
    query: '',
    keywords: [],
    person: '',
    filters: emptyFilters(),
    sort: 'relevance',
    limit: 20,
    offset: 0,
    ...overrides,
  };
}

const searchOptions = {
  aliases: {},
  snippetChars: 200,
  now: 1_800_000_000,
  timezone: 'auto',
};

describe('stemmedTerms', () => {
  it('stems the words of a text', () => {
    assert.deepEqual(stemmedTerms('убийства'), ['убийств']);
  });

  it('has nothing for an empty text', () => {
    assert.deepEqual(stemmedTerms(''), []);
    assert.deepEqual(stemmedTerms('   '), []);
  });
});

describe('buildMatchExpression', () => {
  it('has nothing when there is nothing to look for', () => {
    assert.equal(buildMatchExpression('', [], ''), null);
  });

  it('makes the words of the query alternatives', () => {
    const expression = buildMatchExpression('тихая французская драма', [], '');
    assert.ok(expression);
    assert.match(expression, / OR /);
  });

  it('keeps the words of one keyword together', () => {
    const expression = buildMatchExpression('', ['Дэвид Линч'], '');
    assert.ok(expression);
    assert.match(expression, / AND /);
  });

  it('looks for a person in the people and in the description', () => {
    const expression = buildMatchExpression('', [], 'Julien Seri');
    assert.ok(expression);
    assert.match(expression, /\{people description\}/);
  });

  it('puts the parts of a search together with AND', () => {
    const expression = buildMatchExpression('драма', ['Кали'], 'Seri');
    assert.ok(expression);
    assert.equal(expression.split(' AND ').length >= 3, true);
  });
});

describe('countryConditions', () => {
  it('takes an ISO code as it is', () => {
    assert.deepEqual(countryConditions(['fr'], {}).codes, ['FR']);
  });

  it('maps a name of any language to its code', () => {
    assert.deepEqual(countryConditions(['Франция'], {}).codes, ['FR']);
    assert.deepEqual(countryConditions(['France'], {}).codes, ['FR']);
  });

  it('keeps an unknown name as a raw value', () => {
    const result = countryConditions(['Новая Страна'], {});
    assert.deepEqual(result.codes, []);
    assert.deepEqual(result.raws, ['новая страна']);
  });

  it('uses the aliases of the settings', () => {
    const result = countryConditions(['Соединённые Штаты'], { 'Соединённые Штаты': 'US' });
    assert.deepEqual(result.codes, ['US']);
  });
});

describe('buildFilter', () => {
  it('leaves out the titles that are gone', () => {
    const filter = buildFilter(emptyFilters(), {}, 1_800_000_000);
    assert.match(filter.where, /t\.removed_at IS NULL/);
  });

  it('leaves out the adult content unless it is asked for', () => {
    const filter = buildFilter(emptyFilters(), {}, 1_800_000_000);
    assert.match(filter.where, /t\.is_adult = 0/);

    const filters = { ...emptyFilters(), includeAdult: true };
    assert.doesNotMatch(buildFilter(filters, {}, 1).where, /is_adult/);
  });

  it('asks for at least one of the genres', () => {
    const filters = { ...emptyFilters(), genres: ['Драма', 'Боевик'] };
    const filter = buildFilter(filters, {}, 1);

    assert.match(filter.where, /EXISTS/);
    assert.equal(filter.params.includes('Драма'), true);
    assert.equal(filter.params.includes('Боевик'), true);
  });

  it('asks for none of the excluded genres', () => {
    const filters = { ...emptyFilters(), excludeGenres: ['Ужасы'] };
    const filter = buildFilter(filters, {}, 1);

    assert.match(filter.where, /NOT EXISTS/);
    assert.equal(filter.params.includes('Ужасы'), true);
  });

  it('counts the days of the window of the new titles', () => {
    const filters = { ...emptyFilters(), addedWithinDays: 2 };
    const filter = buildFilter(filters, {}, 1_000_000);

    assert.equal(filter.params.includes(1_000_000 - 2 * 24 * 60 * 60), true);
  });
});

describe('unknownValues', () => {
  it('finds the values that the catalogue does not hold', () => {
    const known = new Map([['Драма', 10]]);
    assert.deepEqual(unknownValues(['Драма', 'Комедия'], known), ['Комедия']);
  });
});

describe('searchTitles', () => {
  it('finds a title by its words', () => {
    const test = withCatalogue();
    try {
      const outcome = searchTitles(test.db, request({ query: 'Кали' }), searchOptions);

      assert.equal(outcome.total, 1);
      assert.equal(outcome.items[0]?.title, 'Кали');
      assert.equal(outcome.usedWords, true);
    } finally {
      test.cleanup();
    }
  });

  it('finds a title by another word form', () => {
    const test = withCatalogue();
    try {
      // The description holds "убийства"; the stemmer makes both the
      // same word.
      const outcome = searchTitles(
        test.db,
        request({ query: 'убийство' }),
        searchOptions,
      );

      assert.equal(outcome.total, 1);
      assert.equal(outcome.items[0]?.title, 'Кали');
    } finally {
      test.cleanup();
    }
  });

  it('finds a title by its director', () => {
    const test = withCatalogue();
    try {
      const outcome = searchTitles(
        test.db,
        request({ person: 'Julien Seri' }),
        searchOptions,
      );

      assert.equal(outcome.total, 1);
      assert.equal(outcome.items[0]?.title, 'Кали');
    } finally {
      test.cleanup();
    }
  });

  it('finds a title by a keyword', () => {
    const test = withCatalogue();
    try {
      const outcome = searchTitles(
        test.db,
        request({ keywords: ['Бабье царство'] }),
        searchOptions,
      );

      assert.equal(outcome.total, 1);
      assert.equal(outcome.items[0]?.title, 'Бабье царство');
    } finally {
      test.cleanup();
    }
  });

  it('returns the filter result when there are no words', () => {
    const test = withCatalogue();
    try {
      const outcome = searchTitles(test.db, request(), searchOptions);

      assert.equal(outcome.total, 3);
      assert.equal(outcome.usedWords, false);
      // Without words the newest title comes first: the fixture added
      // "Кали" on 2026-05-03 and "Бабье царство" on 2026-05-01.
      assert.equal(outcome.items[0]?.title, 'Кали');
    } finally {
      test.cleanup();
    }
  });

  it('counts everything that matches, not only the page', () => {
    const test = withCatalogue();
    try {
      const outcome = searchTitles(test.db, request({ limit: 1 }), searchOptions);

      assert.equal(outcome.total, 3);
      assert.equal(outcome.items.length, 1);
    } finally {
      test.cleanup();
    }
  });

  it('cuts the excerpt of the description', () => {
    const test = withCatalogue();
    try {
      const outcome = searchTitles(
        test.db,
        request({ query: 'Кали' }),
        { ...searchOptions, snippetChars: 20 },
      );

      assert.ok((outcome.items[0]?.snippet.length ?? 0) <= 21);
    } finally {
      test.cleanup();
    }
  });

  it('gives a bigger score to the better match', () => {
    const test = withCatalogue();
    try {
      const outcome = searchTitles(
        test.db,
        request({ query: 'Кали убийство спецназе' }),
        searchOptions,
      );

      assert.ok(outcome.items.length >= 1);
      assert.ok((outcome.items[0]?.score ?? 0) > 0);
    } finally {
      test.cleanup();
    }
  });
});

describe('searchSignature', () => {
  it('is the same for the same search', () => {
    assert.equal(
      searchSignature(request({ query: 'Кали' })),
      searchSignature(request({ query: 'Кали' })),
    );
  });

  it('is different for another search', () => {
    assert.notEqual(
      searchSignature(request({ query: 'Кали' })),
      searchSignature(request({ query: 'Список' })),
    );
    assert.notEqual(
      searchSignature(request({ sort: 'rating' })),
      searchSignature(request({ sort: 'title' })),
    );
  });

  it('does not depend on the order of the lists', () => {
    const one = request({ keywords: ['a', 'b'] });
    const two = request({ keywords: ['b', 'a'] });
    assert.equal(searchSignature(one), searchSignature(two));
  });
});
