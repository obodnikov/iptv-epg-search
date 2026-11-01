/**
 * The search of the guide, through the tool.
 *
 * The cases of the design (tv-guide-server.md §10 T3): the collapse of
 * the repeats (`hide_repeats`), the preference of the better quality
 * (`prefer_hd`), the periods, the filters for kinds, countries, regions
 * and channels, `only_catchup`, the adult filter, the orders and the
 * cursor. The fixtures live in `tests/fixtures/tv-guide-tools-*`; the
 * moment is 2026-06-14 09:00 UTC, the settings speak of Europe/Moscow.
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

async function harness(
  settings: Record<string, unknown> = {},
  now?: number,
): Promise<GuideHarness> {
  const h = await guideHarness({
    settings: {
      timezone: 'Europe/Moscow',
      refreshOnStart: false,
      epgUrl: 'http://example.invalid/xml/guide.gz',
      liveUrl: 'http://example.invalid/playlist.m3u',
      ...settings,
    },
    now,
  });
  harnesses.push(h);
  return h;
}

interface Item {
  program_id: string;
  title: string;
  status: string;
  has_catchup: boolean;
}

function items(result: Record<string, unknown>): Item[] {
  return (result['items'] ?? []) as Item[];
}

function ids(result: Record<string, unknown>): string[] {
  return items(result).map((item) => item.program_id);
}

describe('search_programs', () => {
  it('collapses the repeats and keeps the best quality by default', async () => {
    const h = await harness();
    const result = await h.call('search_programs', { kinds: ['film'] });
    const data = structured(result);

    // The three airings of the film share one title and one channel
    // family; at the moment they share, the HD channel wins. The evening
    // film of the fixture is a film of its own.
    assert.equal(data['total'], 2);
    assert.deepEqual(ids(data), ['pervyj-hd@1781431200', 'pervyj@1781451900']);
    assert.equal(data['search_mode'], 'filters');
  });

  it('lists every airing when the collapse is switched off', async () => {
    const h = await harness();
    const result = await h.call('search_programs', {
      kinds: ['film'],
      hide_repeats: false,
      prefer_hd: false,
    });
    const data = structured(result);

    assert.equal(data['total'], 4);
    assert.deepEqual(ids(data).sort(), [
      'pervyj-2@1781438400',
      'pervyj-hd@1781431200',
      'pervyj@1781431200',
      'pervyj@1781451900',
    ]);
  });

  it('keeps one airing per moment when only the quality collapses', async () => {
    const h = await harness();
    const result = await h.call('search_programs', {
      kinds: ['film'],
      hide_repeats: false,
      prefer_hd: true,
    });
    const data = structured(result);

    assert.equal(data['total'], 3);
    assert.deepEqual(ids(data).sort(), [
      'pervyj-2@1781438400',
      'pervyj-hd@1781431200',
      'pervyj@1781451900',
    ]);
  });

  it('keeps the copies of other families when the quality collapses', async () => {
    // The news air on two channels of two families at the same moment:
    // they are not copies of one another, and both stay.
    const h = await harness();
    const result = await h.call('search_programs', {
      query: 'новость дня',
      period: 'now',
      hide_repeats: false,
      prefer_hd: true,
    });
    const data = structured(result);

    assert.equal(data['total'], 2);
    assert.deepEqual(ids(data).sort(), ['kino@1781427600', 'pervyj@1781427600']);
  });

  it('shows what is on air for period "now"', async () => {
    const h = await harness();
    const result = await h.call('search_programs', { period: 'now' });
    const data = structured(result);

    // The news, on two channels of two families, is on air.
    assert.equal(data['total'], 2);
    assert.deepEqual(ids(data), ['kino@1781427600', 'pervyj@1781427600']);
    assert.equal(items(data)[0]?.status, 'live');
  });

  it('puts the on-air programme into "today"', async () => {
    const h = await harness();
    const result = await h.call('search_programs', { period: 'today' });
    const data = structured(result);

    // The programmes that are on air, the ones that start today; the
    // repeats are collapsed; the adult channel is left out.
    assert.deepEqual(ids(data), [
      'kino@1781427600',
      'pervyj@1781427600',
      'pervyj-hd@1781431200',
      'sport@1781434800',
      'pervyj@1781438400',
      'pervyj@1781451900',
    ]);
    assert.equal(items(data)[0]?.status, 'live');
  });

  it('floors `tonight` at the evening hour, also for the on-air clause', async () => {
    // 19:00 Moscow time: the film that started at 18:45 is still on and
    // stays in `tonight`; the marathon that started at 15:00 does not
    // become an evening programme; the repeat of the match starts in the
    // evening and is there by its start.
    const h = await harness({}, Math.floor(Date.parse('2026-06-14T16:00:00Z') / 1000));
    const result = await h.call('search_programs', { period: 'tonight' });
    const data = structured(result);

    assert.deepEqual(ids(data), ['pervyj@1781451900', 'sport@1781456400']);
  });

  it('reads `from` / `to` as inclusive at the start, exclusive at the end', async () => {
    const h = await harness();
    const inside = structured(
      await h.call('search_programs', {
        channels: ['Первый канал HD'],
        from: '2026-06-14T13:00:00',
        to: '2026-06-14T13:30:00',
      }),
    );
    // The film starts exactly at `from`.
    assert.equal(inside['total'], 1);

    const edge = structured(
      await h.call('search_programs', {
        channels: ['Первый канал HD'],
        from: '2026-06-14T12:00:00',
        to: '2026-06-14T13:00:00',
      }),
    );
    // A programme that starts exactly at `to` is beyond the window.
    assert.equal(edge['total'], 0);
  });

  it('reads the past backwards, with the catch-up marks', async () => {
    const h = await harness();
    const result = await h.call('search_programs', { period: 'past_24h' });
    const data = structured(result);

    // The newest first: the news of the morning, the film of the channel
    // without an archive, the programme of yesterday.
    assert.deepEqual(ids(data), [
      'pervyj@1781424000',
      'kino@1781409600',
      'pervyj@1781341200',
    ]);
    const list = items(data);
    assert.equal(list[0]?.has_catchup, true);
    assert.equal(list[1]?.has_catchup, false);
    assert.equal(list[2]?.has_catchup, true);
  });

  it('keeps only the catch-up programmes on demand', async () => {
    const h = await harness();
    const result = await h.call('search_programs', {
      period: 'past_24h',
      only_catchup: true,
    });
    const data = structured(result);

    assert.deepEqual(ids(data), ['pervyj@1781424000', 'pervyj@1781341200']);
  });

  it('finds a programme by the words of the query', async () => {
    const h = await harness();
    const result = await h.call('search_programs', { query: 'бык' });
    const data = structured(result);

    assert.equal(data['search_mode'], 'words');
    assert.equal(data['total'], 1);
    assert.equal(items(data)[0]?.program_id, 'pervyj-hd@1781431200');
  });

  it('finds a match by a keyword that names a participant', async () => {
    const h = await harness();
    const result = await h.call('search_programs', {
      query: 'матч чемпионата мира',
      keywords: ['Швеция'],
      kinds: ['sport'],
    });
    const data = structured(result);

    assert.equal(data['total'], 1);
    assert.equal(items(data)[0]?.title.startsWith('Футбол.'), true);
  });

  it('finds a director by `person`', async () => {
    const h = await harness();
    const result = await h.call('search_programs', { person: 'Хлебников' });
    const data = structured(result);

    assert.equal(data['total'], 1);
    assert.equal(items(data)[0]?.program_id, 'pervyj-hd@1781431200');
  });

  it('filters by the country of production', async () => {
    const h = await harness();
    const result = await h.call('search_programs', {
      production_countries: ['Франция'],
      period: 'past_24h',
    });
    const data = structured(result);

    assert.equal(data['total'], 1);
    assert.deepEqual(ids(data), ['kino@1781409600']);
  });

  it('filters by the year of production', async () => {
    const h = await harness();
    const result = await h.call('search_programs', {
      year_from: 2019,
      year_to: 2019,
      hide_repeats: false,
      prefer_hd: false,
    });
    const data = structured(result);

    assert.equal(data['total'], 3);
  });

  it('filters by the country of the channel', async () => {
    const h = await harness();
    const result = await h.call('search_programs', {
      channel_regions: ['DE'],
    });
    const data = structured(result);
    assert.equal(data['total'], 0);

    const russian = await h.call('search_programs', {
      channel_regions: ['RU'],
      kinds: ['sport'],
    });
    assert.equal(structured(russian)['total'], 1);
  });

  it('filters by channel name and refuses an unknown one', async () => {
    const h = await harness();
    const result = await h.call('search_programs', {
      channels: ['Спорт канал'],
      hide_repeats: false,
      prefer_hd: false,
    });
    assert.equal(structured(result)['total'], 2);

    const unknown = await h.call('search_programs', { channels: ['Нет такого'] });
    assert.equal(unknown.isError, true);
    assert.match(textOf(unknown), /not found/);
  });

  it('hides the adult channel unless the setting allows it', async () => {
    const h = await harness();
    const day = await h.call('search_programs', { period: 'today' });
    assert.equal(
      textOf(day).includes('Ночной сеанс'),
      false,
      'the adult programme is absent',
    );

    const open = await harness({ includeAdult: true });
    const dayOpen = await open.call('search_programs', { period: 'today' });
    const list = items(structured(dayOpen));
    assert.equal(
      list.some((item) => item.program_id === 'xxx@1781431200'),
      true,
      'the adult programme is there when includeAdult is true',
    );
  });

  it('pages a long result with the cursor', async () => {
    const h = await harness();
    const first = structured(
      await h.call('search_programs', {
        period: 'today',
        hide_repeats: false,
        prefer_hd: false,
        limit: 1,
      }),
    );
    assert.equal(first['total'], 9);
    assert.equal(items(first).length, 1);
    const cursor = first['next_cursor'];
    assert.equal(typeof cursor, 'string');

    const second = structured(
      await h.call('search_programs', {
        period: 'today',
        hide_repeats: false,
        prefer_hd: false,
        limit: 1,
        cursor,
      }),
    );
    assert.equal(second['total'], 9);
    assert.notDeepEqual(ids(second), ids(first));

    // A cursor of another search does not fit.
    const wrong = await h.call('search_programs', {
      period: 'tomorrow',
      hide_repeats: false,
      prefer_hd: false,
      limit: 1,
      cursor,
    });
    assert.equal(wrong.isError, true);
  });

  it('sorts by channel when asked', async () => {
    const h = await harness();
    const result = await h.call('search_programs', {
      period: 'today',
      hide_repeats: false,
      prefer_hd: false,
      sort: 'channel',
    });
    const data = structured(result);
    const names = items(data).map((item) => item.program_id.split('@')[0] ?? '');
    const sorted = [...names].sort((left, right) => (left < right ? -1 : 1));
    assert.deepEqual(names, sorted);
  });

  it('runs a search without filters at all (the candidate SQL stays valid)', async () => {
    const h = await harness();
    // No period, no filters: the whole guide is the candidate set, and
    // the WHERE clause of the candidate SQL is empty. A dangling WHERE
    // would be a syntax error (found by the measurement run of T4).
    const result = await h.call('search_programs', { hide_repeats: false, prefer_hd: false });
    const data = structured(result);
    assert.equal(result.isError, undefined);
    assert.ok((data['total'] as number) > 0);
  });
});
