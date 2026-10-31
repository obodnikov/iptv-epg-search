/**
 * The catch-up rule.
 *
 * The cases of the design (tv-guide-server.md §10 T3): the boundaries at
 * `stop_utc = now` and at exactly `archive_days` days, a stream URL that
 * already carries query parameters, and a stream URL that is not http(s).
 * The rule is the port of `public/scripts/components/results.js`
 * (`showProgramModal`), probed at the provider in
 * docs/design/live-tv-playback-plan.md §5.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  buildCatchupUrl,
  buildWatchLiveUrl,
  catchupPossible,
  catchupRefusal,
} from '../../src/tv-guide/guide-links.ts';
import type { ChannelLinkFacts } from '../../src/tv-guide/guide-links.ts';

/** 2026-06-14 12:00 UTC. */
const NOW = Math.floor(Date.parse('2026-06-14T12:00:00Z') / 1000);

const DAY = 86400;

/** A channel with a stream, a week of archive and the shift type. */
function channel(overrides: Partial<ChannelLinkFacts> = {}): ChannelLinkFacts {
  return {
    stream_url: 'http://example.invalid/s/KEY/pervyj.m3u8',
    archive_days: 7,
    catchup_type: 'shift',
    ...overrides,
  };
}

describe('the catch-up rule', () => {
  it('builds a link with utc and lutc', () => {
    const start = NOW - 3600;
    const stop = NOW - 1800;
    const link = buildCatchupUrl(channel(), start, stop, NOW);

    assert.equal(link.ok, true);
    if (!link.ok) return;
    const url = new URL(link.url);
    assert.equal(url.searchParams.get('utc'), String(start));
    assert.equal(url.searchParams.get('lutc'), String(NOW));
    assert.equal(link.built_at, NOW);
  });

  it('keeps the query parameters the stream URL already has', () => {
    const start = NOW - 3600;
    const link = buildCatchupUrl(
      channel({ stream_url: 'http://example.invalid/s/KEY/p.m3u8?token=KEY' }),
      start,
      NOW - 60,
      NOW,
    );

    assert.equal(link.ok, true);
    if (!link.ok) return;
    const url = new URL(link.url);
    assert.equal(url.searchParams.get('token'), 'KEY');
    assert.equal(url.searchParams.get('utc'), String(start));
    assert.equal(url.searchParams.get('lutc'), String(NOW));
  });

  it('refuses a programme that has not ended, also at the exact second', () => {
    // The programme ends at its stop second: one second before, the link
    // is not there; at the stop second and after, it is. `statusOf` draws
    // the same line, so a status of `past` never meets the refusal
    // "has not ended yet".
    assert.equal(catchupRefusal(channel(), NOW - 3600, NOW + 1, NOW), 'not_ended');
    assert.equal(catchupPossible(channel(), NOW - 3600, NOW + 1, NOW), false);
    assert.equal(catchupRefusal(channel(), NOW - 3600, NOW, NOW), null);
    assert.equal(catchupPossible(channel(), NOW - 3600, NOW, NOW), true);
  });

  it('refuses a programme older than the archive, also at the exact day', () => {
    // `now - start` of exactly `archive_days` days is inside the window.
    assert.equal(catchupRefusal(channel(), NOW - 7 * DAY, NOW - 6 * DAY, NOW), null);
    // One second more is outside it.
    assert.equal(
      catchupRefusal(channel(), NOW - 7 * DAY - 1, NOW - 6 * DAY, NOW),
      'outside_window',
    );
  });

  it('refuses a channel without an archive and with another type', () => {
    assert.equal(catchupRefusal(channel({ archive_days: 0 }), NOW - 3600, NOW - 60, NOW), 'no_archive');
    assert.equal(
      catchupRefusal(channel({ catchup_type: 'append' }), NOW - 3600, NOW - 60, NOW),
      'unsupported_type',
    );
    assert.equal(catchupRefusal(channel({ catchup_type: null }), NOW - 3600, NOW - 60, NOW), 'unsupported_type');
  });

  it('refuses a channel without a stream', () => {
    assert.equal(catchupRefusal(channel({ stream_url: null }), NOW - 3600, NOW - 60, NOW), 'no_stream');
  });

  it('refuses a stream URL that is not http(s)', () => {
    const link = buildCatchupUrl(
      channel({ stream_url: 'ftp://example.invalid/s/KEY/p.m3u8' }),
      NOW - 3600,
      NOW - 60,
      NOW,
    );
    assert.equal(link.ok, false);
    if (link.ok) return;
    assert.equal(link.reason, 'url_rejected');
  });

  it('refuses a stream URL that cannot be parsed', () => {
    const link = buildCatchupUrl(
      channel({ stream_url: 'not-a-url' }),
      NOW - 3600,
      NOW - 60,
      NOW,
    );
    assert.equal(link.ok, false);
    if (link.ok) return;
    assert.equal(link.reason, 'url_rejected');
  });

  it('gives the Watch Live URL when it passes the check', () => {
    assert.equal(buildWatchLiveUrl('http://example.invalid/s/KEY/p.m3u8'), 'http://example.invalid/s/KEY/p.m3u8');
    assert.equal(buildWatchLiveUrl('javascript:alert(1)'), null);
    assert.equal(buildWatchLiveUrl(null), null);
  });
});
