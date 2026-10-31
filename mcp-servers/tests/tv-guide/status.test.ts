/**
 * `get_status` of the TV Guide server.
 *
 * The numbers of the guide and its window, the masked URLs and the state
 * of the vectors (design: tv-guide-server.md §7.7).
 */

import { strict as assert } from 'node:assert';
import { after, describe, it } from 'node:test';

import {
  guideHarness,
  structured,
  textOf,
  type GuideHarness,
} from './harness.ts';

const harnesses: GuideHarness[] = [];

after(async () => {
  for (const harness of harnesses) await harness.cleanup();
});

describe('get_status', () => {
  it('reports the counts, the window and the masked URLs', async () => {
    const harness = await guideHarness({
      settings: {
        timezone: 'Europe/Moscow',
        refreshOnStart: false,
        epgUrl: 'http://example.invalid/xml/guide.gz',
        liveUrl: 'http://example.invalid/playlist.m3u',
      },
    });
    harnesses.push(harness);

    const result = await harness.call('get_status', {});
    const data = structured(result);

    const counts = data['counts'] as Record<string, number>;
    assert.equal(counts['channels'], 6);
    assert.equal(counts['programmes'], 13);
    assert.equal(counts['texts'], 8);
    assert.equal(counts['with_stream'], 6);
    assert.equal(counts['with_archive'], 5);

    const window = data['window'] as { from: string; to: string };
    assert.equal(window.from, '2026-06-13T12:00:00+03:00');
    // The window is the first and the last start, not the stops.
    assert.equal(window.to, '2026-06-14T20:00:00+03:00');

    // The URLs are masked: the host stays, the path with its key is gone.
    const text = textOf(result);
    assert.match(text, /http:\/\/example\.invalid…\/…e\.gz/);
    assert.equal(text.includes('/xml/guide.gz'), false);

    const last = data['last_refresh'] as Record<string, unknown>;
    assert.equal(last['status'], 'never');

    const vectors = data['vectors'] as Record<string, unknown>;
    assert.equal(vectors['done'], 0);
    assert.equal(vectors['meaning'], false);
    assert.equal(typeof vectors['pending'], 'number');

    assert.equal(data['search_mode'], 'words');
    assert.equal(data['configured'], true);
    assert.equal(data['refresh_running'], null);
  });

  it('says it is not configured when both URLs are empty', async () => {
    const harness = await guideHarness({ settings: { epgUrl: '', liveUrl: '' } });
    harnesses.push(harness);

    const result = await harness.call('get_status', {});
    const data = structured(result);

    assert.equal(data['configured'], false);
    const text = textOf(result);
    assert.match(text, /not set/);
  });
});
