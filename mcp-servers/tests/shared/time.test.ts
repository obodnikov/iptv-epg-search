import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatInTimezone, offsetOf, parseOffset, parseProviderTimestamp, systemTimezone } from '../../src/shared/time.ts';

describe('parseProviderTimestamp', () => {
  it('reads the format of the provider with its offset', () => {
    // 2026-05-03 13:08:59+03:00 is 10:08:59 UTC.
    assert.equal(parseProviderTimestamp('2026-05-03 13:08:59+03:00'), Date.UTC(2026, 4, 3, 10, 8, 59) / 1000);
  });

  it('reads a negative offset', () => {
    assert.equal(parseProviderTimestamp('2026-05-03 13:08:59-05:00'), Date.UTC(2026, 4, 3, 18, 8, 59) / 1000);
  });

  it('reads a zero offset', () => {
    assert.equal(parseProviderTimestamp('2026-05-03 13:08:59+00:00'), Date.UTC(2026, 4, 3, 13, 8, 59) / 1000);
  });

  it('accepts the T separator', () => {
    assert.equal(
      parseProviderTimestamp('2026-05-03T13:08:59+03:00'),
      parseProviderTimestamp('2026-05-03 13:08:59+03:00'),
    );
  });

  it('reads a value without an offset as UTC', () => {
    assert.equal(parseProviderTimestamp('2026-05-03 13:08:59'), Date.UTC(2026, 4, 3, 13, 8, 59) / 1000);
  });

  it('returns null for a broken value', () => {
    assert.equal(parseProviderTimestamp(''), null);
    assert.equal(parseProviderTimestamp('yesterday'), null);
    assert.equal(parseProviderTimestamp('2026-13-03 13:08:59+03:00'), null);
    assert.equal(parseProviderTimestamp('2026-05-32 13:08:59+03:00'), null);
    assert.equal(parseProviderTimestamp('2026-05-03 25:08:59+03:00'), null);
    assert.equal(parseProviderTimestamp(null), null);
  });

  it('returns null for a day that does not exist', () => {
    // Date.UTC would roll these into the next month.
    assert.equal(parseProviderTimestamp('2026-02-31 12:00:00+03:00'), null);
    assert.equal(parseProviderTimestamp('2026-04-31 12:00:00+03:00'), null);
    assert.equal(parseProviderTimestamp('2025-02-29 12:00:00+03:00'), null);
  });

  it('reads the leap day of a leap year', () => {
    assert.equal(
      parseProviderTimestamp('2024-02-29 12:00:00+00:00'),
      Date.UTC(2024, 1, 29, 12, 0, 0) / 1000,
    );
  });

  it('keeps the offset out of the result', () => {
    const withOffset = parseProviderTimestamp('2026-05-03 13:08:59+03:00');
    const asUtc = parseProviderTimestamp('2026-05-03 10:08:59+00:00');
    assert.equal(withOffset, asUtc);
  });
});

describe('formatInTimezone', () => {
  it('shows the time with a real offset', () => {
    const epoch = Date.UTC(2026, 4, 3, 10, 8, 59) / 1000;
    const formatted = formatInTimezone(epoch, 'Europe/Moscow');
    assert.ok(formatted !== null && formatted.startsWith('2026-05-03T13:08:59'), formatted ?? '');
    assert.match(formatted ?? '', /[+-]\d{2}:\d{2}$/);
  });

  it('shows the time in UTC', () => {
    const epoch = Date.UTC(2026, 4, 3, 10, 8, 59) / 1000;
    assert.equal(formatInTimezone(epoch, 'UTC'), '2026-05-03T10:08:59+00:00');
  });

  it('shows a negative offset', () => {
    const epoch = Date.UTC(2026, 4, 3, 10, 8, 59) / 1000;
    assert.equal(formatInTimezone(epoch, 'America/New_York'), '2026-05-03T06:08:59-04:00');
  });

  it('returns null for a missing time', () => {
    assert.equal(formatInTimezone(null, 'UTC'), null);
  });

  it('falls back to UTC for an unknown zone', () => {
    const epoch = Date.UTC(2026, 4, 3, 10, 8, 59) / 1000;
    assert.ok(formatInTimezone(epoch, 'Not/AZone'));
  });
});

describe('parseOffset', () => {
  it('reads the offset of a zone name', () => {
    assert.equal(parseOffset('GMT+03:00'), '+03:00');
    assert.equal(parseOffset('GMT-05:30'), '-05:30');
    assert.equal(parseOffset('GMT+3'), '+03:00');
    assert.equal(parseOffset('GMT'), '+00:00');
    assert.equal(parseOffset('UTC'), '+00:00');
  });
});

describe('offsetOf', () => {
  it('reads the offset of a timezone', () => {
    const epoch = Date.UTC(2026, 4, 3, 10, 8, 59) / 1000;
    assert.equal(offsetOf(epoch, 'Europe/Moscow'), '+03:00');
    assert.equal(offsetOf(epoch, 'UTC'), '+00:00');
  });
});

describe('systemTimezone', () => {
  it('returns a zone name', () => {
    assert.ok(systemTimezone().length > 0);
  });
});
