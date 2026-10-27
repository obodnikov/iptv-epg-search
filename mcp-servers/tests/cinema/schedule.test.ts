/**
 * schedule.test.ts - when the server has to refresh the catalogue when it
 * starts.
 *
 * A failed refresh must not make the data look fresh: the server has to
 * try again.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyCinemaSchema } from '../../src/cinema/schema.ts';
import { shouldRefreshAtStart } from '../../src/cinema/refresh.ts';
import { readCinemaSettings, CINEMA_SETTINGS_TEMPLATE } from '../../src/cinema/config.ts';
import { META_KEYS, writeRefreshState } from '../../src/cinema/status.ts';
import { importSettingsSignature } from '../../src/cinema/import.ts';
import { sha256 } from '../../src/shared/hash.ts';
import { testDatabase, type TestDatabase } from '../helpers.ts';

const URL = 'http://provider.invalid/catalogue.m3u?token=KEY';
const NOW = 1_800_000_000;

/** A database with the cinema schema. */
function cinemaDatabase(): TestDatabase {
  const test = testDatabase();
  applyCinemaSchema(test.db);
  return test;
}

/** The settings of the test. */
function settings(overrides: Record<string, unknown> = {}) {
  const merged = { ...CINEMA_SETTINGS_TEMPLATE, cinemaUrl: URL, ...overrides };
  return readCinemaSettings(merged as Record<string, unknown>);
}

/**
 * The state of a successful import.
 */
function successfulImport(db: TestDatabase['db'], at: number): void {
  writeRefreshState(db, {
    at,
    ok: true,
    durationMs: 100,
    entries: 3,
    rejected: 0,
    incomplete: 0,
    titles: 3,
  });
  db.setMeta(META_KEYS.sourceUrlHash, sha256(URL));
  db.setMeta(META_KEYS.importSettingsHash, importSettingsSignature(settings()));
}

describe('shouldRefreshAtStart', () => {
  it('refreshes when the catalogue was never imported', () => {
    const test = cinemaDatabase();
    try {
      const decision = shouldRefreshAtStart(test.db, settings(), NOW);
      assert.equal(decision.refresh, true);
      assert.match(decision.reason, /never imported/);
    } finally {
      test.cleanup();
    }
  });

  it('does not refresh when the catalogue is fresh', () => {
    const test = cinemaDatabase();
    try {
      successfulImport(test.db, NOW - 3600);

      const decision = shouldRefreshAtStart(test.db, settings(), NOW);
      assert.equal(decision.refresh, false);
      assert.match(decision.reason, /fresh/);
    } finally {
      test.cleanup();
    }
  });

  it('refreshes when the catalogue is older than the setting allows', () => {
    const test = cinemaDatabase();
    try {
      successfulImport(test.db, NOW - 48 * 3600);

      const decision = shouldRefreshAtStart(test.db, settings({ refreshHours: 24 }), NOW);
      assert.equal(decision.refresh, true);
      assert.match(decision.reason, /older/);
    } finally {
      test.cleanup();
    }
  });

  it('refreshes again when the last refresh failed', () => {
    const test = cinemaDatabase();
    try {
      // The data was imported two hours ago and is still fresh, but the
      // last attempt an hour ago failed: the failure has to be tried
      // again.
      successfulImport(test.db, NOW - 7200);
      writeRefreshState(test.db, {
        at: NOW - 3600,
        ok: false,
        durationMs: 100,
        entries: 0,
        rejected: 0,
        incomplete: 0,
        titles: 0,
        error: 'the provider answered 500',
      });

      const decision = shouldRefreshAtStart(test.db, settings(), NOW);
      assert.equal(decision.refresh, true);
      assert.match(decision.reason, /failed/);
    } finally {
      test.cleanup();
    }
  });

  it('refreshes when the settings that change the import changed', () => {
    const test = cinemaDatabase();
    try {
      successfulImport(test.db, NOW - 3600);

      // The data is fresh, but a category is not loaded any more: the
      // catalogue has to be written again.
      const decision = shouldRefreshAtStart(
        test.db,
        settings({ excludeCategories: ['Наши фильмы'] }),
        NOW,
      );
      assert.equal(decision.refresh, true);
      assert.match(decision.reason, /settings changed/);
    } finally {
      test.cleanup();
    }
  });

  it('refreshes when the state of the last import is not known', () => {
    const test = cinemaDatabase();
    try {
      // The data was imported, but the hashes of the URL and of the
      // settings were never written down: the server cannot tell whether
      // something changed, so it imports once more.
      writeRefreshState(test.db, {
        at: NOW - 3600,
        ok: true,
        durationMs: 100,
        entries: 3,
        rejected: 0,
        incomplete: 0,
        titles: 3,
      });

      const decision = shouldRefreshAtStart(test.db, settings(), NOW);
      assert.equal(decision.refresh, true);
      assert.match(decision.reason, /not known/);
    } finally {
      test.cleanup();
    }
  });

  it('refreshes when the URL of the provider changed', () => {
    const test = cinemaDatabase();
    try {
      successfulImport(test.db, NOW - 3600);
      test.db.setMeta(META_KEYS.sourceUrlHash, sha256('http://provider.invalid/other.m3u'));

      const decision = shouldRefreshAtStart(test.db, settings(), NOW);
      assert.equal(decision.refresh, true);
      assert.match(decision.reason, /URL/);
    } finally {
      test.cleanup();
    }
  });

  it('does not refresh when the refresh at the start is switched off', () => {
    const test = cinemaDatabase();
    try {
      const decision = shouldRefreshAtStart(
        test.db,
        settings({ refreshOnStart: false }),
        NOW,
      );
      assert.equal(decision.refresh, false);
    } finally {
      test.cleanup();
    }
  });

  it('does not refresh when the URL is not set', () => {
    const test = cinemaDatabase();
    try {
      const decision = shouldRefreshAtStart(
        test.db,
        settings({ cinemaUrl: '' }),
        NOW,
      );
      assert.equal(decision.refresh, false);
      assert.match(decision.reason, /not set/);
    } finally {
      test.cleanup();
    }
  });
});
