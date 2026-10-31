/**
 * The time windows of the tools.
 *
 * The cases of the design (tv-guide-server.md §10 T3): the periods around
 * midnight, and with a time zone different from the offset of the EPG.
 * The fixtures carry `+0300`; the tests read them in zones from
 * `Europe/Moscow` to `Europe/Berlin`, where the local day starts three
 * hours earlier than the day of the provider.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  exactWindow,
  isPeriod,
  isoToEpoch,
  localDateToEpoch,
  localMidnight,
  localParts,
  periodWindow,
  statusOf,
  wallClockToEpoch,
} from '../../src/tv-guide/periods.ts';

/** 2026-06-14 21:00 UTC. */
const NOW = Math.floor(Date.parse('2026-06-14T21:00:00Z') / 1000);

function epoch(text: string): number {
  return Math.floor(Date.parse(text) / 1000);
}

describe('the periods of the tools', () => {
  it('knows the names of the periods', () => {
    assert.equal(isPeriod('tonight'), true);
    assert.equal(isPeriod('tomorrow'), true);
    assert.equal(isPeriod('yesterday'), false);
  });

  it('reads the local parts of a moment', () => {
    const parts = localParts(NOW, 'Europe/Moscow');
    // 21:00 UTC is 00:00 of the next day in Moscow.
    assert.deepEqual(parts, {
      year: 2026,
      month: 6,
      day: 15,
      hour: 0,
      minute: 0,
      second: 0,
    });
  });

  it('finds the local midnight of a moment', () => {
    assert.equal(localMidnight(NOW, 'Europe/Moscow'), epoch('2026-06-14T21:00:00Z'));
    // Berlin is two hours behind Moscow in June: the local day starts at
    // 22:00 UTC of the day before.
    assert.equal(localMidnight(NOW, 'Europe/Berlin'), epoch('2026-06-13T22:00:00Z'));
  });

  it('turns a wall clock into epoch seconds', () => {
    assert.equal(
      wallClockToEpoch({ year: 2026, month: 6, day: 15, hour: 18 }, 'Europe/Moscow'),
      epoch('2026-06-15T15:00:00Z'),
    );
  });

  it('reads a local date', () => {
    assert.equal(
      localDateToEpoch('2026-06-15', 'Europe/Moscow'),
      epoch('2026-06-14T21:00:00Z'),
    );
    assert.equal(localDateToEpoch('15.06.2026', 'Europe/Moscow'), null);
    assert.equal(localDateToEpoch('2026-13-01', 'Europe/Moscow'), null);
  });

  it('reads an ISO date-time with and without an offset', () => {
    // With an offset the string is absolute.
    assert.equal(
      isoToEpoch('2026-06-15T21:00:00+03:00', 'Europe/Berlin'),
      epoch('2026-06-15T18:00:00Z'),
    );
    // Without one it is a wall clock of the zone of the user.
    assert.equal(
      isoToEpoch('2026-06-15T21:00:00', 'Europe/Moscow'),
      epoch('2026-06-15T18:00:00Z'),
    );
    assert.equal(isoToEpoch('not a date', 'Europe/Moscow'), null);
    assert.equal(isoToEpoch('2026-06-15T25:00:00', 'Europe/Moscow'), null);
  });

  it('keeps `tonight` between the evening hour and the end of the day', () => {
    const moscowNow = epoch('2026-06-14T09:00:00Z'); // 12:00 in Moscow.
    const window = periodWindow('tonight', moscowNow, 'Europe/Moscow', 18);
    assert.equal(window.field, 'start');
    assert.equal(window.from, epoch('2026-06-14T15:00:00Z')); // 18:00 MSK.
    assert.equal(window.to, epoch('2026-06-14T21:00:00Z')); // 24:00 MSK.

    // Before the evening hour the window still starts at the evening
    // hour: "tonight" is 18:00\u201324:00, also at four in the afternoon.
    const early = epoch('2026-06-14T13:00:00Z'); // 16:00 in Moscow.
    const windowEarly = periodWindow('tonight', early, 'Europe/Moscow', 18);
    assert.equal(windowEarly.from, epoch('2026-06-14T15:00:00Z'));
  });

  it('moves `today` with the zone of the user, not with the offset of the EPG', () => {
    // 21:30 UTC: in Moscow it is the next day already (00:30 of the
    // 15th), in Berlin it is still the evening of the 14th (23:30).
    const late = epoch('2026-06-14T21:30:00Z');
    const moscow = periodWindow('today', late, 'Europe/Moscow', 18);
    assert.equal(moscow.from, late);
    assert.equal(moscow.to, epoch('2026-06-15T21:00:00Z')); // 24:00 MSK.

    const berlin = periodWindow('today', late, 'Europe/Berlin', 18);
    assert.equal(berlin.from, late);
    assert.equal(berlin.to, epoch('2026-06-14T22:00:00Z')); // 24:00 CEST.
  });

  it('puts `tomorrow` on the local next day', () => {
    const window = periodWindow('tomorrow', NOW, 'Europe/Berlin', 18);
    // The local day of Berlin starts at 22:00 UTC; tomorrow is the next
    // such wall.
    assert.equal(window.from, epoch('2026-06-14T22:00:00Z'));
    assert.equal(window.to, epoch('2026-06-15T22:00:00Z'));
  });

  it('bounds the next and the past windows by the moment', () => {
    const next = periodWindow('next_24h', NOW, 'Europe/Moscow', 18);
    assert.equal(next.from, NOW);
    assert.equal(next.to, NOW + 86400);

    const week = periodWindow('next_7d', NOW, 'Europe/Moscow', 18);
    assert.equal(week.to, NOW + 7 * 86400);

    const past = periodWindow('past_24h', NOW, 'Europe/Moscow', 18);
    assert.equal(past.field, 'stop');
    assert.equal(past.from, NOW - 86400);
    assert.equal(past.to, NOW);

    const pastWeek = periodWindow('past_7d', NOW, 'Europe/Moscow', 18);
    assert.equal(pastWeek.from, NOW - 7 * 86400);
  });

  it('makes `now` a window of the moment itself', () => {
    const window = periodWindow('now', NOW, 'Europe/Moscow', 18);
    assert.equal(window.onAir, true);
    assert.equal(window.from, null);
    assert.equal(window.to, null);
  });

  it('makes `today` take the programme that is on air', () => {
    const window = periodWindow('today', NOW, 'Europe/Moscow', 18);
    assert.equal(window.onAir, true);
    assert.equal(window.from, NOW);
  });

  it('takes an exact window as it is written', () => {
    const window = exactWindow(
      epoch('2026-06-15T18:00:00Z'),
      epoch('2026-06-15T20:00:00Z'),
      NOW,
    );
    assert.equal(window.field, 'start');
    assert.equal(window.from, epoch('2026-06-15T18:00:00Z'));
    assert.equal(window.to, epoch('2026-06-15T20:00:00Z'));
    assert.equal(window.onAir, false);
  });

  it('tells what a programme is doing', () => {
    assert.equal(statusOf(100, 200, 50), 'upcoming');
    assert.equal(statusOf(100, 200, 100), 'live');
    assert.equal(statusOf(100, 200, 150), 'live');
    // The stop second itself is the last second of the programme.
    assert.equal(statusOf(100, 200, 200), 'live');
    assert.equal(statusOf(100, 200, 201), 'past');
    assert.equal(statusOf(100, 200, 500), 'past');
  });
});
