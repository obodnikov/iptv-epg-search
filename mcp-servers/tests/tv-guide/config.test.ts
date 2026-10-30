/**
 * The settings of the TV Guide server.
 *
 * The template of the design (tv-guide-server.md §9): the file is written
 * once, with mode 0600, and is never rewritten. `groupMap` accepts objects
 * under arbitrary keys; `epgDefaultOffset` has to look like an offset.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import {
  loadSettings,
  mergeSettings,
  writeSettingsTemplate,
} from '../../src/shared/settings.ts';
import {
  TV_GUIDE_SETTINGS_SPEC,
  readTvGuideSettings,
} from '../../src/tv-guide/config.ts';

const dirs: string[] = [];

after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'iptv-tv-guide-config-'));
  dirs.push(dir);
  return dir;
}

describe('the TV Guide settings', () => {
  it('keeps the defaults for an empty file', () => {
    const { settings, issues } = mergeSettings({}, TV_GUIDE_SETTINGS_SPEC);
    assert.deepEqual(issues, []);
    assert.equal(settings['epgUrl'], '');
    assert.equal(settings['liveUrl'], '');
    assert.equal(settings['refreshHours'], 12);
    assert.deepEqual(settings['excludeGroups'], ['XXX (18+)']);
    assert.equal(settings['timeshiftGroups'], 'auto');
    assert.equal(settings['tonightFromHour'], 18);
    assert.equal(settings['epgDefaultOffset'], '+0000');
    assert.equal(settings['pastDays'], 7);
    const embeddings = settings['embeddings'] as Record<string, unknown>;
    assert.equal(embeddings['groups'], 'all');
  });

  it('accepts a group map of objects', () => {
    const { settings, issues } = mergeSettings(
      { groupMap: { 'Кино': { theme: 'film', region: 'RU' }, Baltic: { region: 'BALTIC' } } },
      TV_GUIDE_SETTINGS_SPEC,
    );
    assert.deepEqual(issues, []);
    assert.deepEqual((settings['groupMap'] as Record<string, unknown>)['Кино'], {
      theme: 'film',
      region: 'RU',
    });
  });

  it('reports a group override that is not an object', () => {
    const { issues } = mergeSettings({ groupMap: { 'Кино': 'film' } }, TV_GUIDE_SETTINGS_SPEC);
    assert.match(issues[0] ?? '', /must be an object/);
  });

  it('refuses a default offset that is not an offset', () => {
    const good = mergeSettings({ epgDefaultOffset: '+0530' }, TV_GUIDE_SETTINGS_SPEC);
    assert.deepEqual(good.issues, []);

    const bad = mergeSettings({ epgDefaultOffset: 'MSK' }, TV_GUIDE_SETTINGS_SPEC);
    assert.notEqual(bad.issues.length, 0);
    assert.equal(bad.settings['epgDefaultOffset'], '+0000');
  });

  it('refuses a default offset whose hours or minutes do not exist', () => {
    // The form is right, the offset is not: +9999 is not a time of the
    // day, and neither is +0060.
    const hours = mergeSettings({ epgDefaultOffset: '+9999' }, TV_GUIDE_SETTINGS_SPEC);
    assert.notEqual(hours.issues.length, 0);
    assert.equal(hours.settings['epgDefaultOffset'], '+0000');

    const minutes = mergeSettings({ epgDefaultOffset: '+0060' }, TV_GUIDE_SETTINGS_SPEC);
    assert.notEqual(minutes.issues.length, 0);
    assert.equal(minutes.settings['epgDefaultOffset'], '+0000');

    // The biggest real offset is fine.
    const edge = mergeSettings({ epgDefaultOffset: '+2359' }, TV_GUIDE_SETTINGS_SPEC);
    assert.deepEqual(edge.issues, []);
  });

  it('holds tonightFromHour to the hours of the day', () => {
    const bad = mergeSettings({ tonightFromHour: 25 }, TV_GUIDE_SETTINGS_SPEC);
    assert.notEqual(bad.issues.length, 0);
    assert.equal(bad.settings['tonightFromHour'], 18);
  });

  it('refuses a URL that is not http(s)', () => {
    const { issues } = mergeSettings({ epgUrl: 'ftp://example.invalid/x.gz' }, TV_GUIDE_SETTINGS_SPEC);
    assert.notEqual(issues.length, 0);
  });

  it('reads the typed settings out of the merged file', () => {
    const merged = mergeSettings(
      {
        epgUrl: 'http://example.invalid/guide.gz',
        liveUrl: 'http://example.invalid/playlist.m3u',
        pastDays: 3,
        groupMap: { Baltic: { region: 'BALTIC', timeshiftHours: 0 } },
      },
      TV_GUIDE_SETTINGS_SPEC,
    ).settings;

    const settings = readTvGuideSettings(merged);
    assert.equal(settings.epgUrl, 'http://example.invalid/guide.gz');
    assert.equal(settings.liveUrl, 'http://example.invalid/playlist.m3u');
    assert.equal(settings.pastDays, 3);
    assert.equal(settings.excludeGroups[0], 'XXX (18+)');
    assert.deepEqual(settings.groupMap['Baltic'], { region: 'BALTIC', timeshiftHours: 0 });
    // A group override that is not an object is skipped, not a failure.
    assert.equal(settings.groupMap['Кино'], undefined);
  });

  it('skips a group override with wrong field types', () => {
    const merged = mergeSettings(
      { groupMap: { Baltic: { region: 7, theme: 'general', extra: true } } },
      TV_GUIDE_SETTINGS_SPEC,
    ).settings;
    const settings = readTvGuideSettings(merged);
    assert.deepEqual(settings.groupMap['Baltic'], { theme: 'general' });
  });

  it('the template is written once, with mode 0600', () => {
    const dir = tempDir();
    const path = join(dir, 'settings.json');

    const load = loadSettings(path, TV_GUIDE_SETTINGS_SPEC);
    assert.equal(load.createdTemplate, true);
    assert.equal(load.exists, true);

    assert.equal((statSync(path).mode & 0o777) === 0o600, true);
    const written = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    assert.deepEqual(written['excludeGroups'], ['XXX (18+)']);

    // A second read finds the file and never rewrites it.
    writeFileSync(path, JSON.stringify({ refreshHours: 4 }), { mode: 0o600 });
    const again = loadSettings(path, TV_GUIDE_SETTINGS_SPEC);
    assert.equal(again.createdTemplate, false);
    assert.equal(again.exists, true);
    assert.equal(again.settings['refreshHours'], 4);
  });

  it('writeSettingsTemplate refuses to overwrite an existing file', () => {
    const dir = tempDir();
    const path = join(dir, 'settings.json');
    writeFileSync(path, '{"refreshHours": 4}', { mode: 0o600 });

    assert.throws(() => writeSettingsTemplate(path, TV_GUIDE_SETTINGS_SPEC.defaults));
    assert.equal(JSON.parse(readFileSync(path, 'utf8'))['refreshHours'], 4);
  });
});
