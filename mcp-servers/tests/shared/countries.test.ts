import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COUNTRY_CODES,
  COUNTRY_NAMES,
  countryCode,
  countryCodesOf,
  countryName,
  normalizeCountryName,
  splitCountryList,
} from '../../src/shared/countries.ts';

describe('countryCode', () => {
  it('maps the English names of the sample catalogue', () => {
    assert.equal(countryCode('France'), 'FR');
    assert.equal(countryCode('Japan'), 'JP');
    assert.equal(countryCode('United States of America'), 'US');
    assert.equal(countryCode('United Kingdom'), 'GB');
    assert.equal(countryCode('South Korea'), 'KR');
  });

  it('maps the Russian names of the sample catalogue', () => {
    assert.equal(countryCode('Франция'), 'FR');
    assert.equal(countryCode('Россия'), 'RU');
    assert.equal(countryCode('США'), 'US');
    assert.equal(countryCode('Англия'), 'GB');
    assert.equal(countryCode('Корея Южная'), 'KR');
  });

  it('maps the short forms', () => {
    assert.equal(countryCode('USA'), 'US');
    assert.equal(countryCode('UK'), 'GB');
    assert.equal(countryCode('USSR'), 'SU');
    assert.equal(countryCode('СССР'), 'SU');
  });

  it('maps the Russian names that are easy to spell wrong', () => {
    assert.equal(countryCode('Бангладеш'), 'BD');
    assert.equal(countryCode('Лаос'), 'LA');
    assert.equal(countryCode('Корея Южная'), 'KR');
  });

  it('maps the typo of the provider', () => {
    assert.equal(countryCode('United States of Amer'), 'US');
  });

  it('ignores the case and the surrounding spaces', () => {
    assert.equal(countryCode('  FRANCE '), 'FR');
    assert.equal(countryCode('фРАНЦИЯ'), 'FR');
  });

  it('returns null for an unknown name', () => {
    assert.equal(countryCode('Atlantis'), null);
    assert.equal(countryCode(''), null);
  });

  it('uses the aliases of the settings', () => {
    assert.equal(countryCode('Соединенные Штаты', { 'Соединенные Штаты': 'US' }), 'US');
    assert.equal(countryCode('Wonderland', { Wonderland: 'WL' }), 'WL');
  });

  it('finds an alias whatever its spelling is', () => {
    assert.equal(countryCode('Соединенные Штаты', { '  СОЕДИНЕННЫЕ  ШТАТЫ ': 'US' }), 'US');
    assert.equal(countryCode('Wonderland', { WONDERLAND: 'WL' }), 'WL');
  });
});

describe('splitCountryList', () => {
  it('splits a list of countries', () => {
    assert.deepEqual(splitCountryList('Canada, United States of America'), [
      'Canada',
      'United States of America',
    ]);
  });

  it('trims the parts and drops the empty ones', () => {
    assert.deepEqual(splitCountryList(' Canada ,  Mexico ,'), ['Canada', 'Mexico']);
    assert.deepEqual(splitCountryList(''), []);
  });
});

describe('countryCodesOf', () => {
  it('maps every country of the attribute', () => {
    assert.deepEqual(countryCodesOf('Canada, United States of America'), ['CA', 'US']);
  });

  it('skips unknown names', () => {
    assert.deepEqual(countryCodesOf('Canada, Atlantis'), ['CA']);
  });
});

describe('countryName', () => {
  it('returns the English name of a code', () => {
    assert.equal(countryName('FR'), 'France');
    assert.equal(countryName('US'), 'United States');
  });

  it('falls back to the code', () => {
    assert.equal(countryName('ZZ'), 'ZZ');
  });
});

describe('normalizeCountryName', () => {
  it('lower cases, replaces ё and collapses spaces', () => {
    assert.equal(normalizeCountryName('  Франция  '), 'франция');
    assert.equal(normalizeCountryName('БЕЛЬГИЯ'), 'бельгия');
  });
});

describe('the table', () => {
  it('maps every code to a two-letter code', () => {
    for (const [name, code] of Object.entries(COUNTRY_CODES)) {
      assert.match(code, /^[A-Z]{2}$/, name);
    }
  });

  it('names every code it maps', () => {
    for (const code of new Set(Object.values(COUNTRY_CODES))) {
      assert.ok(COUNTRY_NAMES[code], code);
    }
  });

  it('holds no name that mixes Latin and Cyrillic letters', () => {
    for (const name of Object.keys(COUNTRY_CODES)) {
      const mixed = /[a-zA-Z]/.test(name) && /[\u0400-\u04FF]/.test(name);
      assert.equal(mixed, false, name);
    }
  });
});
