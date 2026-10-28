import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  SettingsStore,
  checkSourceUrl,
  loadSettings,
  mergeSettings,
  writeSettingsTemplate,
  type SettingsSpec,
} from '../../src/shared/settings.ts';

const SPEC: SettingsSpec = {
  defaults: {
    cinemaUrl: '',
    timezone: 'auto',
    refreshHours: 24,
    refreshOnStart: true,
    includeAdult: false,
    excludeCategories: [],
    countryAliases: {},
    search: { defaultLimit: 20, maxLimit: 50, snippetChars: 200, meaningWeight: 0.7 },
    embeddings: {
      enabled: true,
      model: 'BAAI/bge-m3',
      apiKeyEnv: 'OPENROUTER_API_KEY',
      batchSize: 50,
      minTextChars: 40,
    },
    logLevel: 'info',
  },
  urlFields: ['cinemaUrl'],
  freeForm: ['countryAliases'],
  enums: { logLevel: ['error', 'warn', 'info', 'debug'] },
  patterns: {
    'embeddings.apiKeyEnv': {
      pattern: /^[A-Za-z_][A-Za-z0-9_]*$/,
      what: 'the name of an environment variable',
    },
  },
  ranges: {
    refreshHours: { min: 1, max: 8760 },
    'search.defaultLimit': { min: 1, max: 200 },
    'search.maxLimit': { min: 1, max: 500 },
    'search.snippetChars': { min: 50, max: 2000 },
    'search.meaningWeight': { min: 0, max: 1 },
    'embeddings.batchSize': { min: 1, max: 200 },
    'embeddings.minTextChars': { min: 0, max: 5000 },
  },
};

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'iptv-mcp-settings-'));
}

describe('checkSourceUrl', () => {
  it('accepts an empty value as "not set"', () => {
    assert.deepEqual(checkSourceUrl(''), { ok: true, value: '' });
    assert.deepEqual(checkSourceUrl('   '), { ok: true, value: '' });
    assert.deepEqual(checkSourceUrl(undefined), { ok: true, value: '' });
  });

  it('accepts http and https', () => {
    const check = checkSourceUrl(' https://example.invalid/catalog.m3u ');
    assert.equal(check.ok, true);
    assert.equal(check.value, 'https://example.invalid/catalog.m3u');
  });

  it('rejects a bad protocol', () => {
    const check = checkSourceUrl('ftp://example.invalid/catalog.m3u');
    assert.equal(check.ok, false);
    assert.match(check.error ?? '', /http/);
  });

  it('rejects a string that is not a URL', () => {
    const check = checkSourceUrl('not a url');
    assert.equal(check.ok, false);
  });

  it('rejects a non-string value', () => {
    assert.equal(checkSourceUrl(42).ok, false);
  });
});

describe('mergeSettings', () => {
  it('keeps the defaults for a missing file', () => {
    const { settings, issues } = mergeSettings({}, SPEC);
    assert.deepEqual(issues, []);
    assert.equal(settings['refreshHours'], 24);
    assert.equal(settings['cinemaUrl'], '');
  });

  it('reports a value that is not a JSON object', () => {
    for (const raw of [[], null, 'text', 42]) {
      const { settings, issues } = mergeSettings(raw, SPEC);
      assert.equal(settings['refreshHours'], 24);
      assert.match(issues[0] ?? '', /JSON object/);
    }
  });

  it('takes the values of the file', () => {
    const { settings, issues } = mergeSettings({ refreshHours: 6, cinemaUrl: 'http://example.invalid/a' }, SPEC);
    assert.deepEqual(issues, []);
    assert.equal(settings['refreshHours'], 6);
    assert.equal(settings['cinemaUrl'], 'http://example.invalid/a');
  });

  it('keeps the default and reports a value of the wrong type', () => {
    const { settings, issues } = mergeSettings({ refreshHours: 'six' }, SPEC);
    assert.equal(settings['refreshHours'], 24);
    assert.equal(issues.length, 1);
    assert.match(issues[0] ?? '', /refreshHours/);
  });

  it('reports an unknown setting', () => {
    const { issues } = mergeSettings({ nonsense: 1 }, SPEC);
    assert.match(issues[0] ?? '', /nonsense/);
  });

  it('rejects a value that is not the name of an environment variable', () => {
    const { settings, issues } = mergeSettings(
      { embeddings: { apiKeyEnv: 'sk-or-v1-SECRET-KEY-1234567890' } },
      SPEC,
    );

    assert.equal(issues.length, 1);
    assert.match(issues[0] ?? '', /apiKeyEnv/);
    assert.match(issues[0] ?? '', /environment variable/);
    // The value is a secret: it must not reach the message.
    assert.ok(!(issues[0] ?? '').includes('SECRET'));
    // The default is kept.
    assert.deepEqual(settings['embeddings'], {
      enabled: true,
      model: 'BAAI/bge-m3',
      apiKeyEnv: 'OPENROUTER_API_KEY',
      batchSize: 50,
      minTextChars: 40,
    });
  });

  it('rejects a bad URL and keeps the field empty', () => {
    const { settings, issues } = mergeSettings({ cinemaUrl: 'ftp://example.invalid/a' }, SPEC);
    assert.equal(settings['cinemaUrl'], '');
    assert.match(issues[0] ?? '', /cinemaUrl/);
  });

  it('rejects a value outside a closed set', () => {
    const { settings, issues } = mergeSettings({ logLevel: 'loud' }, SPEC);
    assert.equal(settings['logLevel'], 'info');
    assert.match(issues[0] ?? '', /logLevel/);
  });

  it('rejects a number that is outside its range', () => {
    const { settings, issues } = mergeSettings({ refreshHours: -1 }, SPEC);
    assert.equal(settings['refreshHours'], 24);
    assert.match(issues[0] ?? '', /refreshHours/);

    const nested = mergeSettings({ search: { defaultLimit: 100000 } }, SPEC);
    assert.equal((nested.settings['search'] as Record<string, unknown>)['defaultLimit'], 20);
    assert.match(nested.issues[0] ?? '', /search\.defaultLimit/);
  });

  it('accepts a number that is inside its range', () => {
    const { settings, issues } = mergeSettings({ refreshHours: 6 }, SPEC);
    assert.deepEqual(issues, []);
    assert.equal(settings['refreshHours'], 6);
  });

  it('merges nested objects', () => {
    const { settings, issues } = mergeSettings({ search: { defaultLimit: 5 } }, SPEC);
    assert.deepEqual(issues, []);
    assert.equal((settings['search'] as Record<string, unknown>)['defaultLimit'], 5);
    assert.equal((settings['search'] as Record<string, unknown>)['maxLimit'], 50);
  });

  it('names a nested setting with dots', () => {
    const { issues } = mergeSettings({ search: { nonsense: 1 } }, SPEC);
    assert.match(issues[0] ?? '', /search\.nonsense/);
  });

  it('rejects a nested value of the wrong type', () => {
    const { settings, issues } = mergeSettings({ search: { defaultLimit: 'five' } }, SPEC);
    assert.equal((settings['search'] as Record<string, unknown>)['defaultLimit'], 20);
    assert.match(issues[0] ?? '', /search\.defaultLimit/);
  });

  it('does not share the template with the caller', () => {
    const first = mergeSettings({}, SPEC);
    (first.settings['excludeCategories'] as string[]).push('Эротика (18+)');
    ((first.settings['search'] as Record<string, unknown>)['defaultLimit'] as number) = 999;

    const second = mergeSettings({}, SPEC);

    assert.deepEqual(second.settings['excludeCategories'], []);
    assert.equal((second.settings['search'] as Record<string, unknown>)['defaultLimit'], 20);
    assert.deepEqual(SPEC.defaults['excludeCategories'], []);
    assert.equal((SPEC.defaults['search'] as Record<string, unknown>)['defaultLimit'], 20);
  });

  it('accepts free-form keys with string values', () => {
    const { settings, issues } = mergeSettings({ countryAliases: { 'Соединенные Штаты': 'US' } }, SPEC);
    assert.deepEqual(issues, []);
    assert.deepEqual(settings['countryAliases'], { 'Соединенные Штаты': 'US' });
  });

  it('rejects a list that does not hold strings', () => {
    const { settings, issues } = mergeSettings({ excludeCategories: [1, 2] }, SPEC);
    assert.deepEqual(settings['excludeCategories'], []);
    assert.match(issues[0] ?? '', /excludeCategories/);
  });
});

describe('loadSettings', () => {
  it('writes the template with mode 0600 when the file is missing', () => {
    const dir = tempDir();
    const path = join(dir, 'settings.json');

    const load = loadSettings(path, SPEC);

    assert.equal(load.createdTemplate, true);
    assert.equal(load.issues.length, 0);

    // The mode of a file is a Unix thing; on Windows it does not exist.
    if (process.platform !== 'win32') {
      const mode = statSync(path).mode & 0o777;
      assert.equal(mode, 0o600);
    }

    const written = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    assert.equal(written['refreshHours'], 24);
    assert.equal(written['cinemaUrl'], '');
  });

  it('tightens the rights of an existing settings file', () => {
    if (process.platform === 'win32') return;
    const dir = tempDir();
    const path = join(dir, 'settings.json');
    writeFileSync(path, '{"refreshHours": 3}', { mode: 0o644 });
    chmodSync(path, 0o644);

    loadSettings(path, SPEC);

    assert.equal(statSync(path).mode & 0o777, 0o600);
  });

  it('does not overwrite an existing file', () => {
    const dir = tempDir();
    const path = join(dir, 'settings.json');
    writeFileSync(path, '{"refreshHours": 3}', { mode: 0o600 });

    const load = loadSettings(path, SPEC);

    assert.equal(load.createdTemplate, false);
    assert.equal(load.settings['refreshHours'], 3);
    assert.equal(readFileSync(path, 'utf8'), '{"refreshHours": 3}');
  });

  it('reports a file that is not valid JSON and uses the defaults', () => {
    const dir = tempDir();
    const path = join(dir, 'settings.json');
    writeFileSync(path, 'not json', { mode: 0o600 });

    const load = loadSettings(path, SPEC);

    assert.equal(load.settings['refreshHours'], 24);
    assert.match(load.issues[0] ?? '', /JSON/);
  });

  it('does not crash when the template cannot be written', () => {
    const dir = tempDir();
    // The parent of the settings file is a file, so nothing can be written.
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, 'not a directory');
    const path = join(blocker, 'settings.json');

    const load = loadSettings(path, SPEC);

    assert.equal(load.settings['refreshHours'], 24);
    assert.equal(load.createdTemplate, false);
    assert.match(load.issues[0] ?? '', /could not be written/);
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports a file that does not hold a JSON object', () => {
    const dir = tempDir();
    const path = join(dir, 'settings.json');
    writeFileSync(path, '["not", "an", "object"]', { mode: 0o600 });

    const load = loadSettings(path, SPEC);

    assert.equal(load.settings['refreshHours'], 24);
    assert.match(load.issues[0] ?? '', /JSON object/);
  });
});

describe('writeSettingsTemplate', () => {
  it('refuses to overwrite an existing file', () => {
    const dir = tempDir();
    const path = join(dir, 'settings.json');
    writeSettingsTemplate(path, { a: 1 });
    assert.throws(() => writeSettingsTemplate(path, { a: 2 }));
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { a: 1 });
  });
});

describe('SettingsStore', () => {
  it('picks up a changed file', async () => {
    const dir = tempDir();
    const path = join(dir, 'settings.json');
    writeFileSync(path, '{"refreshHours": 3}', { mode: 0o600 });

    const store = new SettingsStore(path, SPEC);
    assert.equal(store.settings()['refreshHours'], 3);

    // The new content has a different size, so the fingerprint changes even
    // when the file system does not move the timestamp.
    writeFileSync(path, '{"refreshHours": 9, "includeAdult": true}', { mode: 0o600 });

    assert.equal(store.settings()['refreshHours'], 9);
  });
});
