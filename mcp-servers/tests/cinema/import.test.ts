import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyCinemaSchema, SCHEMA_VERSION } from '../../src/cinema/schema.ts';
import {
  importCatalogFile,
  importCatalogText,
  prepareTitles,
  parseCatalogText,
  validateCatalogText,
  type ImportOptions,
} from '../../src/cinema/import.ts';
import { titleIdFor, textHash } from '../../src/cinema/keys.ts';
import { acquireLock } from '../../src/shared/lock.ts';
import {
  reconcileVectorQueue,
  rebuildVectorQueue,
} from '../../src/cinema/queue.ts';
import {
  computeContentHash,
  writeCatalog,
  type PreparedTitle,
} from '../../src/cinema/store.ts';
import { stemText } from '../../src/shared/text.ts';
import { fixture } from '../fixtures/load.ts';
import { testDatabase, type TestDatabase } from '../helpers.ts';

const catalogueA = fixture('import-a.m3u');
const catalogueB = fixture('import-b.m3u');

const NOW = 1_800_000_000;

function options(overrides: Partial<ImportOptions> = {}): ImportOptions {
  return {
    cinemaUrl: '',
    excludeCategories: [],
    countryAliases: {},
    trackChanges: true,
    embeddingModel: 'BAAI/bge-m3',
    minTextChars: 0,
    now: NOW,
    ...overrides,
  };
}

/** A database with the cinema schema. */
function cinemaDatabase(): TestDatabase {
  const test = testDatabase();
  applyCinemaSchema(test.db);
  return test;
}

/** The ids of the titles, by their title. */
function idsByTitle(db: TestDatabase['db']): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of db.all<{ title: string; title_id: string }>(
    'SELECT title, title_id FROM titles',
  )) {
    map.set(row.title, row.title_id);
  }
  return map;
}

/**
 * A row of the database as a plain object.
 *
 * The rows of `node:sqlite` have no prototype, which the strict
 * comparison of `assert.deepEqual` notices.
 */
function plain<T extends Record<string, unknown>>(row: T): T {
  return { ...row } as T;
}

/**
 * The titles of the rows of the keyword index.
 *
 * The index holds the stemmed text, so the name of the title comes from the
 * table of the titles.
 */
function ftsTitles(db: TestDatabase['db'], match: string): string[] {
  return db
    .all<{ title: string }>(
      `SELECT t.title FROM titles_fts f JOIN titles t ON t.rowid = f.rowid
        WHERE f.titles_fts MATCH ? ORDER BY t.title`,
      match,
    )
    .map((row) => row.title);
}

/**
 * A title that is ready to be written, built by hand.
 *
 * The tests use it for the cases the parser cannot produce: two titles of
 * one import that want the same id.
 */
function preparedTitle(input: {
  title: string;
  titleNorm: string;
  year: number;
  director: string;
  lookupKey: string;
  seed: string;
}): PreparedTitle {
  const embedText = `${input.title} (${input.year}). Фильм. Жанры: Драма. Режиссёр: ${input.director}.`;
  const prepared: PreparedTitle = {
    type: 'film',
    title: input.title,
    titleNorm: input.titleNorm,
    year: input.year,
    rating: null,
    category: 'Зарубежные фильмы',
    director: input.director,
    description: '',
    posterUrl: '',
    durationMin: null,
    addedAt: NOW,
    addedRaw: '2026-05-03 13:08:59+03:00',
    isAdult: false,
    isNewTag: false,
    genres: ['Драма'],
    countries: [],
    seasonCount: null,
    episodeCount: null,
    variants: [],
    episodes: [],
    lookupKey: input.lookupKey,
    seed: input.seed,
    embedText,
    textHash: textHash(embedText),
    contentHash: '',
  };
  prepared.contentHash = computeContentHash(prepared);
  return prepared;
}

describe('validateCatalogText', () => {
  it('accepts a catalogue', () => {
    assert.equal(validateCatalogText(catalogueA), null);
  });

  it('refuses a file without the header', () => {
    assert.match(validateCatalogText('#EXTINF:1 x, title\nhttp://example.invalid/a') ?? '', /EXTM3U/);
  });

  it('refuses a file without an entry', () => {
    assert.match(validateCatalogText('#EXTM3U\n') ?? '', /EXTINF/);
  });

  it('accepts a byte order mark before the header', () => {
    assert.equal(validateCatalogText(`\uFEFF${catalogueA}`), null);
  });
});

describe('importCatalogText', () => {
  it('writes the titles of the catalogue', () => {
    const test = cinemaDatabase();
    try {
      const outcome = importCatalogText(test.db, catalogueA, options());
      assert.equal(outcome.ok, true);
      assert.equal(outcome.titles, 3);
      assert.equal(outcome.entries, 3);
      assert.equal(outcome.rejected, 0);
      assert.equal(outcome.incomplete, 0);

      const row = test.db.get<{ titles: number; films: number; series: number }>(
        'SELECT count(*) AS titles, sum(type = \'film\') AS films, sum(type = \'series\') AS series FROM titles',
      );
      assert.equal(row?.titles, 3);
      assert.equal(row?.films, 2);
      assert.equal(row?.series, 1);
    } finally {
      test.cleanup();
    }
  });

  it('writes the fields of a film', () => {
    const test = cinemaDatabase();
    try {
      importCatalogText(test.db, catalogueA, options());

      const row = test.db.get<Record<string, unknown>>(
        "SELECT * FROM titles WHERE title = 'Кали'",
      );
      assert.ok(row);
      assert.equal(row['type'], 'film');
      assert.equal(row['title_norm'], 'кали');
      assert.equal(row['year'], 2024);
      assert.equal(row['rating'], 7);
      assert.equal(row['category'], 'Зарубежные фильмы');
      assert.equal(row['director'], 'Julien Seri');
      assert.equal(row['duration_min'], 96);
      assert.equal(row['is_adult'], 0);
      assert.equal(row['is_new_tag'], 0);
      assert.equal(row['added_at'], 1_777_802_939);
      assert.equal(row['added_raw'], '2026-05-03 13:08:59+03:00');
      assert.equal(row['poster_url'], 'http://example.invalid/screenshots/81/8080.jpg');
    } finally {
      test.cleanup();
    }
  });

  it('writes the genres and the countries of a title', () => {
    const test = cinemaDatabase();
    try {
      importCatalogText(test.db, catalogueA, options());

      const genres = test.db.all<{ genre: string }>(
        "SELECT genre FROM title_genres WHERE title_id = (SELECT title_id FROM titles WHERE title = 'Кали') ORDER BY genre",
      );
      assert.deepEqual(genres.map((row) => row.genre), ['Боевик', 'Драма']);

      const countries = test.db.all<{ raw: string; code: string }>(
        "SELECT raw, code FROM title_countries WHERE title_id = (SELECT title_id FROM titles WHERE title = 'Кали')",
      );
      assert.deepEqual(countries.map(plain), [{ raw: 'France', code: 'FR' }]);
    } finally {
      test.cleanup();
    }
  });

  it('writes one row per country of a list', () => {
    const test = cinemaDatabase();
    try {
      const countryList = 'Canada, United States of America';
      const withCountry = catalogueA.replace('country="France"', `country="${countryList}"`);
      importCatalogText(test.db, withCountry, options());

      const countries = test.db.all<{ raw: string; code: string }>(
        "SELECT raw, code FROM title_countries WHERE title_id = (SELECT title_id FROM titles WHERE title = 'Кали') ORDER BY raw",
      );
      assert.deepEqual(countries.map(plain), [
        { raw: 'Canada', code: 'CA' },
        { raw: 'United States of America', code: 'US' },
      ]);
    } finally {
      test.cleanup();
    }
  });

  it('uses the country aliases of the settings', () => {
    const test = cinemaDatabase();
    try {
      const withCountry = catalogueA.replace('country="France"', 'country="Галлия"');
      importCatalogText(
        test.db,
        withCountry,
        options({ countryAliases: { 'Галлия': 'FR' } }),
      );

      const countries = test.db.all<{ raw: string; code: string }>(
        "SELECT raw, code FROM title_countries WHERE title_id = (SELECT title_id FROM titles WHERE title = 'Кали')",
      );
      assert.deepEqual(countries.map(plain), [{ raw: 'Галлия', code: 'FR' }]);
    } finally {
      test.cleanup();
    }
  });

  it('writes the episodes of a series', () => {
    const test = cinemaDatabase();
    try {
      importCatalogText(test.db, catalogueA, options());

      const episodes = test.db.all<{ season: number; episode: number; name: string }>(
        'SELECT season, episode, name FROM episodes ORDER BY season, episode',
      );
      assert.deepEqual(episodes.map(plain), [
        { season: 1, episode: 1, name: 'Бабье царство S01E01' },
      ]);

      const row = test.db.get<{ season_count: number; episode_count: number }>(
        "SELECT season_count, episode_count FROM titles WHERE title = 'Бабье царство'",
      );
      assert.equal(row?.season_count, 1);
      assert.equal(row?.episode_count, 1);
    } finally {
      test.cleanup();
    }
  });

  it('writes the variants of a film', () => {
    const test = cinemaDatabase();
    try {
      const withVariant = catalogueA.replace(
        'http://example.invalid/film1.m3u8?token=KEY',
        'http://example.invalid/film1.m3u8?token=KEY\n#EXTINF:5760 genres="Боевик,Драма" rating="7" year="2024" country="France" director="Julien Seri" added="2026-05-03 13:08:59+03:00" group-title="Ultra HD", Кали (4K HDR)\nhttp://example.invalid/film1-4k.m3u8?token=KEY',
      );
      importCatalogText(test.db, withVariant, options());

      const variants = test.db.all<{ quality: string }>(
        `SELECT v.quality FROM variants v
           JOIN titles t ON t.title_id = v.title_id
          WHERE t.title = 'Кали' ORDER BY v.quality`,
      );
      assert.deepEqual(variants.map((row) => row.quality), ['4K HDR', 'standard']);
    } finally {
      test.cleanup();
    }
  });

  it('keeps the adult titles in the database and marks them', () => {
    const test = cinemaDatabase();
    try {
      const withAdult = catalogueA.replace(
        'http://example.invalid/ep1.m3u8?token=KEY',
        'http://example.invalid/ep1.m3u8?token=KEY\n#EXTINF:-1 genres="Эротические студии" rating="5" year="2025" duration="44" country="Россия" added="2026-03-01 00:00:00+03:00" censored="1" group-title="Эротика (18+)", Что-то для взрослых S01E01\nhttp://example.invalid/adult.m3u8?token=KEY',
      );
      importCatalogText(test.db, withAdult, options());

      const row = test.db.get<{ is_adult: number }>(
        "SELECT is_adult FROM titles WHERE title = 'Что-то для взрослых'",
      );
      assert.equal(row?.is_adult, 1);
      // The adult titles are stored: they are filtered when the question is
      // asked, not when the catalogue is imported.
      assert.equal(
        test.db.get<{ found: number }>('SELECT count(*) AS found FROM titles')?.found,
        4,
      );
    } finally {
      test.cleanup();
    }
  });

  it('does not load the excluded categories', () => {
    const test = cinemaDatabase();
    try {
      importCatalogText(test.db, catalogueA, options({ excludeCategories: ['Сериалы'] }));

      const row = test.db.get<{ titles: number }>('SELECT count(*) AS titles FROM titles');
      assert.equal(row?.titles, 2);
      assert.equal(
        test.db.get<{ found: number }>('SELECT count(*) AS found FROM episodes')?.found,
        0,
      );
    } finally {
      test.cleanup();
    }
  });

  it('refuses a file that is not a catalogue and keeps the old data', () => {
    const test = cinemaDatabase();
    try {
      importCatalogText(test.db, catalogueA, options());

      const outcome = importCatalogText(test.db, 'not a catalogue', options());
      assert.equal(outcome.ok, false);
      assert.match(outcome.error ?? '', /EXTM3U/);

      assert.equal(
        test.db.get<{ found: number }>('SELECT count(*) AS found FROM titles')?.found,
        3,
      );
    } finally {
      test.cleanup();
    }
  });

  it('refuses a catalogue whose titles are all excluded', () => {
    const test = cinemaDatabase();
    try {
      const outcome = importCatalogText(
        test.db,
        catalogueA,
        options({ excludeCategories: ['Зарубежные фильмы', 'Наши фильмы', 'Сериалы'] }),
      );
      assert.equal(outcome.ok, false);
      assert.match(outcome.error ?? '', /no title/);
    } finally {
      test.cleanup();
    }
  });
});

describe('the stable ids', () => {
  it('gives the same ids when the catalogue is imported again', () => {
    const test = cinemaDatabase();
    try {
      importCatalogText(test.db, catalogueA, options());
      const first = idsByTitle(test.db);

      importCatalogText(test.db, catalogueA, options());
      const second = idsByTitle(test.db);

      assert.deepEqual([...second.entries()].sort(), [...first.entries()].sort());
      assert.equal(
        test.db.get<{ found: number }>('SELECT count(*) AS found FROM titles')?.found,
        3,
      );
    } finally {
      test.cleanup();
    }
  });

  it('keeps the id of a series when its earliest year changes', () => {
    const test = cinemaDatabase();
    try {
      importCatalogText(test.db, catalogueA, options());
      const before = idsByTitle(test.db).get('Бабье царство');
      assert.ok(before);

      // The first season is lost, so that the series starts a year earlier.
      const later = catalogueA.replace('year="2026" duration="44"', 'year="2025" duration="44"');
      importCatalogText(test.db, later, options());

      const after = idsByTitle(test.db).get('Бабье царство');
      assert.equal(after, before);
      assert.equal(
        test.db.get<{ year: number }>("SELECT year FROM titles WHERE title = 'Бабье царство'")?.year,
        2025,
      );
    } finally {
      test.cleanup();
    }
  });

  it('keeps the moment a title was seen the first time', () => {
    const test = cinemaDatabase();
    try {
      importCatalogText(test.db, catalogueA, options());
      const first = test.db.get<{ first_seen_at: number; last_seen_at: number }>(
        "SELECT first_seen_at, last_seen_at FROM titles WHERE title = 'Кали'",
      );
      assert.equal(first?.first_seen_at, NOW);
      assert.equal(first?.last_seen_at, NOW);

      importCatalogText(test.db, catalogueA, options({ now: NOW + 3600 }));
      const second = test.db.get<{ first_seen_at: number; last_seen_at: number }>(
        "SELECT first_seen_at, last_seen_at FROM titles WHERE title = 'Кали'",
      );
      assert.equal(second?.first_seen_at, NOW);
      assert.equal(second?.last_seen_at, NOW + 3600);
    } finally {
      test.cleanup();
    }
  });

  it('tells two titles that want the same id apart', () => {
    const test = cinemaDatabase();
    try {
      // A row of an earlier catalogue that holds the id that "Кали" is
      // going to get, but that is a different title.
      const baseId = titleIdFor('film | кали | 2024');
      test.db.run(
        `INSERT INTO titles (title_id, type, title, title_norm, year, director, category, first_seen_at, last_seen_at, lookup_key)
         VALUES (?, 'film', 'Другой фильм', 'другой фильм', 1999, 'Другой Режиссер', 'Зарубежные фильмы', ?, ?, ?)`,
        baseId,
        NOW,
        NOW,
        'film|другой фильм|1999',
      );

      const outcome = importCatalogText(test.db, catalogueA, options());
      assert.equal(outcome.ok, true);
      assert.equal(outcome.write?.collisions.length, 1);

      const collision = outcome.write?.collisions[0];
      assert.equal(collision?.baseId, baseId);
      assert.notEqual(collision?.existingTitleId, collision?.incomingTitleId);
      assert.notEqual(collision?.incomingTitleId, baseId);

      // The two titles have different ids now, and both of them are there.
      const ids = test.db.all<{ title_id: string }>('SELECT title_id FROM titles');
      assert.equal(new Set(ids.map((row) => row.title_id)).size, ids.length);
      assert.equal(ids.length, 4);
    } finally {
      test.cleanup();
    }
  });

  it('tells two titles of one import apart that want the same id', () => {
    const test = cinemaDatabase();
    try {
      // Two titles of one import with the same seed: the first one takes
      // the id, the second one finds it and takes another id. Both of them
      // have to stay in the catalogue.
      const seed = 'film | кали | 2024';
      const first = preparedTitle({
        title: 'Кали',
        titleNorm: 'кали',
        year: 2024,
        director: 'Первый Режиссер',
        lookupKey: 'film|кали|2024',
        seed,
      });
      const second = preparedTitle({
        title: 'Кали',
        titleNorm: 'кали',
        year: 2024,
        director: 'Второй Режиссер',
        lookupKey: 'film|кали|другой',
        seed,
      });

      const outcome = writeCatalog(test.db, [first, second], options());
      assert.equal(outcome.collisions.length, 1);

      // Both of them are live and they have different ids.
      const rows = test.db.all<{ title_id: string; removed_at: number | null }>(
        'SELECT title_id, removed_at FROM titles',
      );
      assert.equal(rows.length, 2);
      assert.equal(new Set(rows.map((row) => row.title_id)).size, 2);
      assert.ok(rows.every((row) => row.removed_at === null));

      // And both of them are in the staging table, under their own id.
      const staged = test.db.all<{ title_id: string }>('SELECT title_id FROM import_staging');
      assert.equal(staged.length, 2);
      assert.deepEqual(
        staged.map((row) => row.title_id).sort(),
        rows.map((row) => row.title_id).sort(),
      );

      // The rows of the keyword index follow the id of their title.
      const fts = test.db.all<{ title_id: string }>('SELECT title_id FROM titles_fts');
      assert.equal(fts.length, 2);
      assert.deepEqual(
        fts.map((row) => row.title_id).sort(),
        rows.map((row) => row.title_id).sort(),
      );
    } finally {
      test.cleanup();
    }
  });

  it('writes the collision down', () => {
    const test = cinemaDatabase();
    try {
      // A row of an earlier catalogue that holds the id that "Кали" is
      // going to get: the import has to tell the two apart, and to say so.
      const baseId = titleIdFor('film | кали | 2024');
      test.db.run(
        `INSERT INTO titles (title_id, type, title, title_norm, year, director, category, first_seen_at, last_seen_at, lookup_key)
         VALUES (?, 'film', 'Другой фильм', 'другой фильм', 1999, 'Другой Режиссер', 'Зарубежные фильмы', ?, ?, ?)`,
        baseId,
        NOW,
        NOW,
        'film|другой фильм|1999',
      );

      const warnings: { message: string; fields?: Record<string, unknown> }[] = [];
      const log = {
        warn: (message: string, fields?: Record<string, unknown>) => {
          warnings.push({ message, ...(fields ? { fields } : {}) });
        },
        error: (message: string) => {
          warnings.push({ message });
        },
      };

      const outcome = importCatalogText(test.db, catalogueA, options({ log }));
      assert.equal(outcome.ok, true);
      assert.equal(outcome.write?.collisions.length, 1);

      const warning = warnings.find((entry) => entry.message.includes('same id'));
      assert.ok(warning, 'the collision was not written down');
      assert.equal(warning?.fields?.['base_id'], baseId);
    } finally {
      test.cleanup();
    }
  });
});

describe('the titles that left the catalogue', () => {
  it('gets a removed_at when the changes are tracked', () => {
    const test = cinemaDatabase();
    try {
      importCatalogText(test.db, catalogueA, options());
      importCatalogText(test.db, catalogueB, options({ now: NOW + 60 }));

      const row = test.db.get<{ removed_at: number | null }>(
        "SELECT removed_at FROM titles WHERE title = 'Список'",
      );
      assert.equal(row?.removed_at, NOW + 60);

      const kept = test.db.get<{ removed_at: number | null }>(
        "SELECT removed_at FROM titles WHERE title = 'Кали'",
      );
      assert.equal(kept?.removed_at, null);
    } finally {
      test.cleanup();
    }
  });

  it('is deleted when the changes are not tracked', () => {
    const test = cinemaDatabase();
    try {
      importCatalogText(test.db, catalogueA, options());
      importCatalogText(test.db, catalogueB, options({ trackChanges: false }));

      assert.equal(
        test.db.get<{ found: number }>("SELECT count(*) AS found FROM titles WHERE title = 'Список'")
          ?.found,
        0,
      );
      assert.equal(
        test.db.get<{ found: number }>('SELECT count(*) AS found FROM titles')?.found,
        2,
      );
    } finally {
      test.cleanup();
    }
  });

  it('keeps the moment a title was seen the first time when it is deleted', () => {
    const test = cinemaDatabase();
    try {
      importCatalogText(test.db, catalogueA, options());
      importCatalogText(test.db, catalogueB, options({ trackChanges: false, now: NOW + 60 }));

      const row = test.db.get<{ first_seen_at: number }>(
        "SELECT first_seen_at FROM titles WHERE title = 'Кали'",
      );
      assert.equal(row?.first_seen_at, NOW);
    } finally {
      test.cleanup();
    }
  });

  it('leaves no row of the keyword index behind', () => {
    const test = cinemaDatabase();
    try {
      importCatalogText(test.db, catalogueA, options());
      importCatalogText(test.db, catalogueB, options({ trackChanges: false }));

      const rows = test.db.all<{ title_id: string }>('SELECT title_id FROM titles_fts');
      assert.equal(rows.length, 2);
    } finally {
      test.cleanup();
    }
  });
});

describe('the lock of the working folder', () => {
  it('is taken and given back by the import', () => {
    const test = cinemaDatabase();
    try {
      const outcome = importCatalogText(
        test.db,
        catalogueA,
        options({ dataDir: test.dir }),
      );
      assert.equal(outcome.ok, true);
      assert.equal(existsSync(join(test.dir, 'refresh.lock')), false);
    } finally {
      test.cleanup();
    }
  });

  it('stops the import when another process holds it', () => {
    const test = cinemaDatabase();
    try {
      const lock = acquireLock(join(test.dir, 'refresh.lock'));
      assert.ok(lock);

      const outcome = importCatalogText(
        test.db,
        catalogueA,
        options({ dataDir: test.dir }),
      );
      assert.equal(outcome.ok, false);
      assert.match(outcome.error ?? '', /already running/);

      // Nothing was written.
      assert.equal(
        test.db.get<{ found: number }>('SELECT count(*) AS found FROM titles')?.found,
        0,
      );
    } finally {
      test.cleanup();
    }
  });
});

describe('the failures of the write', () => {
  it('are reported as an outcome and keep the old catalogue', () => {
    const test = cinemaDatabase();
    try {
      importCatalogText(test.db, catalogueA, options());

      // The write fails in the middle.
      test.db.exec(
        `CREATE TRIGGER fail BEFORE INSERT ON titles
         BEGIN SELECT RAISE(ABORT, 'the table is locked'); END`,
      );

      const outcome = importCatalogText(test.db, catalogueA, options());
      assert.equal(outcome.ok, false);
      assert.match(outcome.error ?? '', /could not be written/);
      assert.match(outcome.error ?? '', /locked/);

      // The old catalogue is still there.
      assert.equal(
        test.db.get<{ found: number }>('SELECT count(*) AS found FROM titles')?.found,
        3,
      );
    } finally {
      test.cleanup();
    }
  });
});

describe('the schema', () => {
  it('has a unique index over the lookup key', () => {
    const test = cinemaDatabase();
    try {
      const indexes = test.db.all<{ name: string; unique: number }>(
        "PRAGMA index_list('titles')",
      );
      const lookup = indexes.find((index) => index.name === 'idx_titles_lookup');
      assert.ok(lookup, 'the index over the lookup key is missing');
      assert.equal(lookup?.unique, 1);
    } finally {
      test.cleanup();
    }
  });

  it('refuses two titles with the same lookup key', () => {
    const test = cinemaDatabase();
    try {
      const insert = (id: string): void => {
        test.db.run(
          `INSERT INTO titles (title_id, type, title, title_norm, year, first_seen_at, last_seen_at, lookup_key)
           VALUES (?, 'film', 'Кали', 'кали', 2024, ?, ?, 'film|кали|2024')`,
          id,
          NOW,
          NOW,
        );
      };

      insert('one');
      assert.throws(() => insert('two'), /UNIQUE/);
    } finally {
      test.cleanup();
    }
  });

  it('writes the version of the schema into the meta table', () => {
    const test = cinemaDatabase();
    try {
      assert.equal(test.db.meta('schema_version'), String(SCHEMA_VERSION));
    } finally {
      test.cleanup();
    }
  });

  it('refuses a database with titles that share their lookup key', () => {
    const test = testDatabase();
    try {
      // A database of an earlier build, with an empty lookup key in every row.
      test.db.exec(
        `CREATE TABLE titles (
           title_id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL,
           title_norm TEXT NOT NULL, year INTEGER, rating REAL, category TEXT,
           director TEXT, description TEXT, poster_url TEXT, duration_min INTEGER,
           added_at INTEGER, is_adult INTEGER NOT NULL DEFAULT 0,
           is_new_tag INTEGER NOT NULL DEFAULT 0, season_count INTEGER,
           episode_count INTEGER, text_hash TEXT, first_seen_at INTEGER NOT NULL,
           last_seen_at INTEGER NOT NULL, removed_at INTEGER,
           lookup_key TEXT NOT NULL DEFAULT '', content_hash TEXT, added_raw TEXT,
           embed_text TEXT)`,
      );
      test.db.run(
        `INSERT INTO titles (title_id, type, title, title_norm, year, first_seen_at, last_seen_at)
         VALUES ('a', 'film', 'Кали', 'кали', 2024, ?, ?)`,
        NOW,
        NOW,
      );
      test.db.run(
        `INSERT INTO titles (title_id, type, title, title_norm, year, first_seen_at, last_seen_at)
         VALUES ('b', 'film', 'Кали', 'кали', 2024, ?, ?)`,
        NOW,
        NOW,
      );

      assert.throws(() => applyCinemaSchema(test.db), /lookup key/);
    } finally {
      test.cleanup();
    }
  });
});

describe('the titles that come back', () => {
  it('keeps the id and the first time a title was seen', () => {
    const test = cinemaDatabase();
    try {
      importCatalogText(test.db, catalogueA, options());
      const before = idsByTitle(test.db).get('Список');
      assert.ok(before);

      // The title is not in the catalogue any more.
      importCatalogText(test.db, catalogueB, options({ now: NOW + 60 }));
      const removed = test.db.get<{ removed_at: number | null }>(
        "SELECT removed_at FROM titles WHERE title = 'Список'",
      );
      assert.equal(removed?.removed_at, NOW + 60);

      // And it comes back.
      importCatalogText(test.db, catalogueA, options({ now: NOW + 120 }));
      const row = test.db.get<{
        title_id: string;
        removed_at: number | null;
        first_seen_at: number;
      }>("SELECT title_id, removed_at, first_seen_at FROM titles WHERE title = 'Список'");
      assert.equal(row?.title_id, before);
      assert.equal(row?.removed_at, null);
      assert.equal(row?.first_seen_at, NOW);
    } finally {
      test.cleanup();
    }
  });

  it('is put into the queue of the texts again', () => {
    const test = cinemaDatabase();
    try {
      importCatalogText(test.db, catalogueA, options());
      const hash = test.db.get<{ text_hash: string }>(
        "SELECT text_hash FROM titles WHERE title = 'Список'",
      );
      assert.ok(hash?.text_hash);

      // The title leaves the catalogue: its text leaves the queue with it.
      importCatalogText(test.db, catalogueB, options({ now: NOW + 60 }));
      assert.equal(
        test.db.get<{ found: number }>(
          'SELECT count(*) AS found FROM vector_queue WHERE text_hash = ?',
          hash?.text_hash ?? '',
        )?.found,
        0,
      );

      // And it comes back: the text has to be embedded again.
      importCatalogText(test.db, catalogueA, options({ now: NOW + 120 }));
      assert.equal(
        test.db.get<{ found: number }>(
          'SELECT count(*) AS found FROM vector_queue WHERE text_hash = ?',
          hash?.text_hash ?? '',
        )?.found,
        1,
      );
    } finally {
      test.cleanup();
    }
  });
});

describe('the keyword index', () => {
  it('finds another word form', () => {
    const test = cinemaDatabase();
    try {
      importCatalogText(test.db, catalogueA, options());

      // The index holds the stemmed text, and the query is stemmed the
      // same way: "убийства" becomes "убийств", like "убийство".
      assert.deepEqual(ftsTitles(test.db, stemText('убийства')), ['Кали']);
    } finally {
      test.cleanup();
    }
  });

  it('finds a title by its name', () => {
    const test = cinemaDatabase();
    try {
      importCatalogText(test.db, catalogueA, options());

      assert.deepEqual(ftsTitles(test.db, stemText('Кали')), ['Кали']);
    } finally {
      test.cleanup();
    }
  });

  it('is written again when the text of a title changes', () => {
    const test = cinemaDatabase();
    try {
      importCatalogText(test.db, catalogueA, options());

      const changed = catalogueA.replace(
        'Расследование убийства в горах.',
        'Расследование пропажи в горах.',
      );
      importCatalogText(test.db, changed, options());

      assert.deepEqual(ftsTitles(test.db, stemText('убийства')), []);
      assert.deepEqual(ftsTitles(test.db, stemText('пропажи')), ['Кали']);
    } finally {
      test.cleanup();
    }
  });

  it('has one row per title', () => {
    const test = cinemaDatabase();
    try {
      importCatalogText(test.db, catalogueA, options());
      importCatalogText(test.db, catalogueA, options());

      assert.equal(
        test.db.get<{ found: number }>('SELECT count(*) AS found FROM titles_fts')?.found,
        3,
      );
    } finally {
      test.cleanup();
    }
  });
});

describe('the queue of the texts to embed', () => {
  it('holds the texts of the new titles', () => {
    const test = cinemaDatabase();
    try {
      importCatalogText(test.db, catalogueA, options());

      const rows = test.db.all<{ text_hash: string; model: string }>(
        'SELECT text_hash, model FROM vector_queue ORDER BY text_hash',
      );
      assert.equal(rows.length, 3);
      assert.ok(rows.every((row) => row.model === 'BAAI/bge-m3'));
    } finally {
      test.cleanup();
    }
  });

  it('does not hold the same text twice', () => {
    const test = cinemaDatabase();
    try {
      importCatalogText(test.db, catalogueA, options());
      importCatalogText(test.db, catalogueA, options());

      assert.equal(
        test.db.get<{ found: number }>('SELECT count(*) AS found FROM vector_queue')?.found,
        3,
      );
    } finally {
      test.cleanup();
    }
  });

  it('drops the texts that left the catalogue', () => {
    const test = cinemaDatabase();
    try {
      importCatalogText(test.db, catalogueA, options());
      importCatalogText(test.db, catalogueB, options({ trackChanges: false }));

      const queued = test.db.all<{ text_hash: string }>('SELECT text_hash FROM vector_queue');
      const live = test.db.all<{ text_hash: string }>(
        'SELECT DISTINCT text_hash FROM titles WHERE removed_at IS NULL',
      );
      assert.equal(queued.length, live.length);
    } finally {
      test.cleanup();
    }
  });

  it('leaves the texts that are too short alone', () => {
    const test = cinemaDatabase();
    try {
      importCatalogText(test.db, catalogueA, options({ minTextChars: 10_000 }));

      assert.equal(
        test.db.get<{ found: number }>('SELECT count(*) AS found FROM vector_queue')?.found,
        0,
      );
    } finally {
      test.cleanup();
    }
  });

  it('is built again when the model changes', () => {
    const test = cinemaDatabase();
    try {
      importCatalogText(test.db, catalogueA, options());

      const queued = rebuildVectorQueue(test.db, 'other/model', 0, NOW);
      assert.equal(queued, 3);

      const rows = test.db.all<{ model: string }>('SELECT model FROM vector_queue');
      assert.ok(rows.every((row) => row.model === 'other/model'));
      assert.equal(rows.length, 3);
    } finally {
      test.cleanup();
    }
  });

  it('does not queue the texts that left the catalogue', () => {
    const test = cinemaDatabase();
    try {
      importCatalogText(test.db, catalogueA, options());
      importCatalogText(test.db, catalogueB, options({ trackChanges: false }));

      rebuildVectorQueue(test.db, 'BAAI/bge-m3', 0, NOW);
      const rows = test.db.all<{ text_hash: string }>('SELECT text_hash FROM vector_queue');
      const live = test.db.all<{ text_hash: string }>(
        'SELECT DISTINCT text_hash FROM titles WHERE removed_at IS NULL',
      );
      assert.equal(rows.length, live.length);
    } finally {
      test.cleanup();
    }
  });

  it('is put in step with the vectors that exist already', () => {
    const test = testDatabase(true);
    try {
      applyCinemaSchema(test.db);
      test.db.exec(
        `CREATE TABLE vec.vectors (
           text_hash TEXT NOT NULL, model TEXT NOT NULL, dim INTEGER NOT NULL,
           embedding BLOB NOT NULL, created_at INTEGER NOT NULL,
           PRIMARY KEY (text_hash, model))`,
      );

      importCatalogText(test.db, catalogueA, options());
      assert.equal(
        test.db.get<{ found: number }>('SELECT count(*) AS found FROM vector_queue')?.found,
        3,
      );

      // One of the texts has a vector already.
      const hash = test.db.get<{ text_hash: string }>(
        'SELECT text_hash FROM vector_queue LIMIT 1',
      );
      test.db.run(
        'INSERT INTO vec.vectors (text_hash, model, dim, embedding, created_at) VALUES (?, ?, ?, ?, ?)',
        hash?.text_hash ?? '',
        'BAAI/bge-m3',
        4,
        Buffer.alloc(16),
        NOW,
      );

      const removed = reconcileVectorQueue(test.db, 'BAAI/bge-m3');
      assert.equal(removed, 1);
      assert.equal(
        test.db.get<{ found: number }>('SELECT count(*) AS found FROM vector_queue')?.found,
        2,
      );
    } finally {
      test.cleanup();
    }
  });

  it('does not queue a text that has a vector already', () => {
    const test = testDatabase(true);
    try {
      applyCinemaSchema(test.db);
      test.db.exec(
        `CREATE TABLE vec.vectors (
           text_hash TEXT NOT NULL, model TEXT NOT NULL, dim INTEGER NOT NULL,
           embedding BLOB NOT NULL, created_at INTEGER NOT NULL,
           PRIMARY KEY (text_hash, model))`,
      );

      // A vector of every text of the catalogue.
      const prepared = prepareTitles(parseCatalogText(catalogueA, options()).catalog, options());
      for (const title of prepared) {
        test.db.run(
          'INSERT INTO vec.vectors (text_hash, model, dim, embedding, created_at) VALUES (?, ?, ?, ?, ?)',
          title.textHash,
          'BAAI/bge-m3',
          4,
          Buffer.alloc(16),
          NOW,
        );
      }

      importCatalogText(test.db, catalogueA, options());
      assert.equal(
        test.db.get<{ found: number }>('SELECT count(*) AS found FROM vector_queue')?.found,
        0,
      );
    } finally {
      test.cleanup();
    }
  });

  it('queues a text again when its vector is gone', () => {
    const test = testDatabase(true);
    try {
      applyCinemaSchema(test.db);
      test.db.exec(
        `CREATE TABLE vec.vectors (
           text_hash TEXT NOT NULL, model TEXT NOT NULL, dim INTEGER NOT NULL,
           embedding BLOB NOT NULL, created_at INTEGER NOT NULL,
           PRIMARY KEY (text_hash, model))`,
      );

      importCatalogText(test.db, catalogueA, options());
      const queued = test.db.get<{ found: number }>('SELECT count(*) AS found FROM vector_queue');
      assert.equal(queued?.found, 3);

      // The vectors and the queue are gone: the texts have to be embedded
      // again.
      test.db.exec('DELETE FROM vec.vectors');
      test.db.exec('DELETE FROM vector_queue');
      assert.equal(
        test.db.get<{ found: number }>('SELECT count(*) AS found FROM vector_queue')?.found,
        0,
      );

      importCatalogText(test.db, catalogueA, options());
      assert.equal(
        test.db.get<{ found: number }>('SELECT count(*) AS found FROM vector_queue')?.found,
        3,
      );
    } finally {
      test.cleanup();
    }
  });
});

describe('the write', () => {
  it('holds everything together: a failed write leaves the old data', () => {
    const test = cinemaDatabase();
    try {
      importCatalogText(test.db, catalogueA, options());

      const parsed = parseCatalogText(catalogueB, options());
      const prepared = prepareTitles(parsed.catalog, options());

      // A title without a name breaks the write in the middle.
      const broken: PreparedTitle = { ...(prepared[0] as PreparedTitle), title: null as never };
      assert.throws(() => writeCatalog(test.db, [broken], options()));

      assert.equal(
        test.db.get<{ found: number }>('SELECT count(*) AS found FROM titles')?.found,
        3,
      );
      assert.equal(
        test.db.get<{ found: number }>('SELECT count(*) AS found FROM titles_fts')?.found,
        3,
      );
    } finally {
      test.cleanup();
    }
  });

  it('reports what it wrote', () => {
    const test = cinemaDatabase();
    try {
      const outcome = importCatalogText(test.db, catalogueA, options());
      assert.equal(outcome.write?.inserted, 3);
      assert.equal(outcome.write?.updated, 0);
      assert.equal(outcome.write?.unchanged, 0);
      assert.equal(outcome.write?.episodes, 1);
      assert.equal(outcome.write?.variants, 2);
    } finally {
      test.cleanup();
    }
  });

  it('counts the titles that did not change', () => {
    const test = cinemaDatabase();
    try {
      importCatalogText(test.db, catalogueA, options());
      const outcome = importCatalogText(test.db, catalogueA, options());
      assert.equal(outcome.write?.unchanged, 3);
      assert.equal(outcome.write?.updated, 0);
    } finally {
      test.cleanup();
    }
  });
});

describe('importCatalogFile', () => {
  it('reads the catalogue from a file', () => {
    const test = cinemaDatabase();
    try {
      const outcome = importCatalogFile(
        test.db,
        fileURLToPath(new URL('../fixtures/import-a.m3u', import.meta.url)),
        options(),
      );
      assert.equal(outcome.ok, true);
      assert.equal(outcome.titles, 3);
    } finally {
      test.cleanup();
    }
  });

  it('reports a file that cannot be read', () => {
    const test = cinemaDatabase();
    try {
      const outcome = importCatalogFile(
        test.db,
        '/does/not/exist.m3u',
        options(),
      );
      assert.equal(outcome.ok, false);
      assert.match(outcome.error ?? '', /could not be read/);
    } finally {
      test.cleanup();
    }
  });
});
