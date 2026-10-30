/**
 * The times of the guide.
 *
 * The cases of the design (tv-guide-server.md §10 T1): `+0300`, `-0130`,
 * a missing offset, month 13, hour 24. The reference values come from the
 * live-tv plan (docs/design/live-tv-playback-plan.md §5.4): 09:10 MSK is
 * 06:10 UTC.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { epgRawToEpochSeconds, parseEpgTime } from '../../src/tv-guide/epg-time.ts';

test('a time with +0300 converts to UTC epoch seconds', () => {
  const epoch = epgRawToEpochSeconds('20260614091000 +0300');
  assert.equal(epoch, Date.parse('2026-06-14T06:10:00Z') / 1000);
});

test('a time with -0130 converts to UTC epoch seconds', () => {
  const epoch = epgRawToEpochSeconds('20260614091000 -0130');
  assert.equal(epoch, Date.parse('2026-06-14T10:40:00Z') / 1000);
});

test('the strict check refuses a time without an offset', () => {
  assert.equal(epgRawToEpochSeconds('20260614091000'), null);
});

test('a missing offset takes the default offset and says so', () => {
  const parsed = parseEpgTime('20260614091000', '+0300');
  assert.ok(parsed !== null);
  assert.equal(parsed.epoch, Date.parse('2026-06-14T06:10:00Z') / 1000);
  assert.equal(parsed.offset, '+0300');
  assert.equal(parsed.usedDefault, true);
});

test('an explicit offset wins over the default', () => {
  const parsed = parseEpgTime('20260614091000 +0300', '+0000');
  assert.ok(parsed !== null);
  assert.equal(parsed.usedDefault, false);
  assert.equal(parsed.offset, '+0300');
});

test('month 13 is rejected, not rolled into the next year', () => {
  assert.equal(epgRawToEpochSeconds('20261314091000 +0300'), null);
  assert.equal(parseEpgTime('20261314091000', '+0300'), null);
});

test('the 31st of a month that has no 31st is rejected', () => {
  assert.equal(epgRawToEpochSeconds('20260231091000 +0300'), null);
});

test('hour 24 is rejected', () => {
  assert.equal(epgRawToEpochSeconds('20260614241000 +0300'), null);
});

test('minute 60 and second 60 are rejected', () => {
  assert.equal(epgRawToEpochSeconds('20260614096000 +0300'), null);
  assert.equal(epgRawToEpochSeconds('20260614091060 +0300'), null);
});

test('an impossible offset is rejected', () => {
  assert.equal(epgRawToEpochSeconds('20260614091000 +2400'), null);
  assert.equal(epgRawToEpochSeconds('20260614091000 +0360'), null);
});

test('a value that is not a time at all is rejected', () => {
  assert.equal(epgRawToEpochSeconds(''), null);
  assert.equal(epgRawToEpochSeconds('2026-06-14 09:10'), null);
  assert.equal(epgRawToEpochSeconds('yesterday'), null);
});

test('a default offset that is not an offset is refused', () => {
  assert.equal(parseEpgTime('20260614091000', 'Moscow'), null);
});

test('a leap day that exists is accepted', () => {
  const epoch = epgRawToEpochSeconds('20280229091000 +0300');
  assert.equal(epoch, Date.parse('2028-02-29T06:10:00Z') / 1000);
});

test('whitespace around the value is allowed', () => {
  const epoch = epgRawToEpochSeconds('  20260614091000   +0300  ');
  assert.equal(epoch, Date.parse('2026-06-14T06:10:00Z') / 1000);
});
