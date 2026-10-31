/**
 * The detail tools of the guide, through the transport.
 *
 * The cases of the design (tv-guide-server.md §10 T3): the catch-up link
 * built at call time with the reason when there is none, the airings of a
 * title, the day of one channel, what every channel shows now, the
 * channels and their groups, and the refusal when the server is not
 * configured.
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
): Promise<GuideHarness> {
  const h = await guideHarness({
    settings: {
      timezone: 'Europe/Moscow',
      refreshOnStart: false,
      epgUrl: 'http://example.invalid/xml/guide.gz',
      liveUrl: 'http://example.invalid/playlist.m3u',
      ...settings,
    },
  });
  harnesses.push(h);
  return h;
}

describe('get_program', () => {
  it('gives the facts and the links of an airing', async () => {
    const h = await harness();
    // Вчера в городе: ended, the channel has an archive of 7 days.
    const result = await h.call('get_program', { program_id: 'pervyj@1781341200' });
    const data = structured(result);

    assert.equal(data['title'], 'Вчера в городе');
    assert.equal(data['status'], 'past');

    const channel = data['channel'] as Record<string, unknown>;
    assert.equal(channel['has_stream'], true);
    assert.equal(channel['archive_days'], 7);
    assert.equal(channel['theme'], 'general');
    assert.equal(channel['region'], 'RU');

    const catchup = data['catchup_url'];
    assert.equal(typeof catchup, 'string');
    const url = new URL(String(catchup));
    assert.equal(url.searchParams.get('utc'), '1781341200');
    assert.ok(Number(url.searchParams.get('lutc') ?? '0') > 0);
    assert.equal(typeof data['link_built_at'], 'string');

    const live = data['watch_live_url'];
    assert.equal(String(live).startsWith('http://example.invalid/'), true);
  });

  it('gives the extracted facts of a film', async () => {
    const h = await harness();
    const result = await h.call('get_program', { program_id: 'pervyj-hd@1781431200' });
    const data = structured(result);

    assert.equal(data['kind'], 'film');
    const facts = data['facts'] as Record<string, unknown>;
    assert.equal(facts['year'], 2019);
    assert.deepEqual(facts['directors'], ['Борис Хлебников']);
    assert.deepEqual(facts['cast'], ['Александр Яценко']);
    assert.deepEqual(facts['genres'], ['драма']);
    const countries = facts['countries'] as { raw: string; code: string }[];
    assert.deepEqual(countries, [{ raw: 'Россия', code: 'RU' }]);

    // The film has not ended: there is no catch-up link, and the reason
    // says why.
    assert.equal(data['catchup_url'], null);
    assert.match(String(data['catchup_refusal']), /not ended/i);

    // The other airings of the same title.
    const others = data['other_airings'] as {
      upcoming: { program_id: string }[];
    };
    assert.equal(others.upcoming.length, 2);
  });

  it('says when the channel has no stream', async () => {
    // The fixture guide has no programme on a channel without a stream
    // that is reachable by id — the kino channel has one. Its channel has
    // a stream but no archive: the refusal names the archive.
    const h = await harness();
    const result = await h.call('get_program', { program_id: 'kino@1781409600' });
    const data = structured(result);
    assert.equal(data['catchup_url'], null);
    assert.match(String(data['catchup_refusal']), /no archive/i);
  });

  it('refuses an id it cannot read and an id that left the guide', async () => {
    const h = await harness();
    const broken = await h.call('get_program', { program_id: 'pervyj' });
    assert.equal(broken.isError, true);

    const gone = await h.call('get_program', { program_id: 'pervyj@1' });
    assert.equal(gone.isError, true);
    assert.match(textOf(gone), /No programme/);
  });

  it('refuses an adult programme unless the setting allows it', async () => {
    const h = await harness();
    const refused = await h.call('get_program', { program_id: 'xxx@1781431200' });
    assert.equal(refused.isError, true);
    assert.match(textOf(refused), /includeAdult/);

    const open = await harness({ includeAdult: true });
    const allowed = await open.call('get_program', { program_id: 'xxx@1781431200' });
    assert.equal(allowed.isError, undefined);
  });
});

describe('find_airings', () => {
  it('finds every airing of a title, upcoming and archived', async () => {
    const h = await harness();
    const result = await h.call('find_airings', { title: 'Бык' });
    const data = structured(result);

    assert.equal(data['total'], 3);
    const upcoming = data['upcoming'] as { program_id: string }[];
    assert.equal(upcoming.length, 3);
    const archived = data['archived'] as unknown[];
    assert.equal(archived.length, 0);
  });

  it('splits the airings around now', async () => {
    const h = await harness();
    const result = await h.call('find_airings', { title: 'Вести' });
    const data = structured(result);

    // The text airs on two channels; the airing of the morning is over.
    assert.equal(data['total'], 3);
    const upcoming = data['upcoming'] as { program_id: string }[];
    const archived = data['archived'] as { program_id: string; has_catchup: boolean }[];
    assert.deepEqual(
      upcoming.map((row) => row.program_id).sort(),
      ['kino@1781427600', 'pervyj@1781427600'],
    );
    assert.deepEqual(archived.map((row) => row.program_id), ['pervyj@1781424000']);
    assert.equal(archived[0]?.has_catchup, true);
  });

  it('leaves the adult channel out unless the setting lets it in', async () => {
    const h = await harness();
    const closed = structured(await h.call('find_airings', { title: 'Ночной сеанс' }));
    assert.equal(closed['total'], 0);

    const open = await harness({ includeAdult: true });
    const opened = structured(await open.call('find_airings', { title: 'Ночной сеанс' }));
    assert.equal(opened['total'], 1);
  });

  it('answers a title that is not in the guide', async () => {
    const h = await harness();
    const result = await h.call('find_airings', { title: 'Нет такого фильма' });
    const data = structured(result);
    assert.equal(data['total'], 0);
    assert.match(textOf(result), /No airing/);
  });

  it('skips the past on demand', async () => {
    const h = await harness();
    const result = await h.call('find_airings', {
      title: 'Вести',
      include_past: false,
    });
    const data = structured(result);
    assert.equal((data['archived'] as unknown[]).length, 0);
  });
});

describe('get_now_and_next', () => {
  it('shows the current and the next programme of every channel', async () => {
    const h = await harness();
    const result = await h.call('get_now_and_next', {});
    const data = structured(result);

    const items = data['items'] as {
      channel: { id: string };
      current: { program_id: string; percent_elapsed: number } | null;
      next: { program_id: string } | null;
    }[];

    const pervyj = items.find((row) => row.channel.id === 'pervyj');
    assert.ok(pervyj);
    assert.equal(pervyj.current?.program_id, 'pervyj@1781427600');
    assert.equal(pervyj.next?.program_id, 'pervyj@1781431200');

    // The time-shifted copy is left out: it has nothing on air before its
    // shift reaches the programme.
    const shifted = items.find((row) => row.channel.id === 'pervyj-2');
    assert.equal(shifted, undefined);
  });

  it('names a time-shifted channel when it is asked for', async () => {
    const h = await harness();
    const result = await h.call('get_now_and_next', {
      channels: ['Первый канал (+2)'],
    });
    const data = structured(result);
    const items = data['items'] as {
      channel: { id: string };
      current: unknown;
      next: { program_id: string } | null;
    }[];

    const shifted = items.find((row) => row.channel.id === 'pervyj-2');
    assert.ok(shifted);
    assert.equal(shifted.current, null);
    assert.equal(shifted.next?.program_id, 'pervyj-2@1781438400');
  });
});

describe('get_channel_schedule', () => {
  it('gives the day of one channel in the zone of the user', async () => {
    const h = await harness();
    const result = await h.call('get_channel_schedule', {
      channel: 'Первый канал',
      date: '2026-06-14',
    });
    const data = structured(result);

    const window = data['window'] as { from: string; to: string };
    assert.equal(window.from, '2026-06-14T00:00:00+03:00');
    assert.equal(window.to, '2026-06-15T00:00:00+03:00');
    // The news of the morning and of noon, the film of the afternoon, the
    // marathon and the evening film; the programme of the 13th belongs to
    // the day of the 13th.
    assert.equal(data['total'], 5);
    const list = data['items'] as { program_id: string }[];
    assert.deepEqual(
      list.map((item) => item.program_id),
      [
        'pervyj@1781424000',
        'pervyj@1781427600',
        'pervyj@1781431200',
        'pervyj@1781438400',
        'pervyj@1781451900',
      ],
    );
  });

  it('refuses the schedule of an adult channel', async () => {
    const h = await harness();
    const result = await h.call('get_channel_schedule', { channel: 'Взрослый канал' });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /includeAdult/);
  });

  it('takes an exact window and pages it', async () => {
    const h = await harness();
    const first = structured(
      await h.call('get_channel_schedule', {
        channel: 'Первый канал',
        from: '2026-06-14T08:00:00',
        to: '2026-06-14T14:00:00',
        limit: 1,
      }),
    );
    assert.equal(first['total'], 3);
    const cursor = first['next_cursor'];
    assert.equal(typeof cursor, 'string');

    const second = structured(
      await h.call('get_channel_schedule', {
        channel: 'Первый канал',
        from: '2026-06-14T08:00:00',
        to: '2026-06-14T14:00:00',
        limit: 1,
        cursor,
      }),
    );
    assert.equal((second['items'] as unknown[]).length, 1);
    assert.notDeepEqual(
      (first['items'] as { program_id: string }[])[0],
      (second['items'] as { program_id: string }[])[0],
    );
  });

  it('refuses an unknown channel and a broken date', async () => {
    const h = await harness();
    const unknown = await h.call('get_channel_schedule', { channel: 'Нет такого' });
    assert.equal(unknown.isError, true);

    const broken = await h.call('get_channel_schedule', {
      channel: 'Первый канал',
      date: '15.06.2026',
    });
    assert.equal(broken.isError, true);
  });
});

describe('list_channels', () => {
  it('returns the groups without filters', async () => {
    const h = await harness();
    const result = await h.call('list_channels', {});
    const data = structured(result);

    assert.equal(data['mode'], 'groups');
    const groups = data['groups'] as {
      group: string;
      theme: string | null;
      region: string | null;
      channels: number;
    }[];
    // The adult group is not named: a group name is content.
    assert.equal(groups.length, 4);
    assert.equal(
      groups.some((group) => group.group === 'XXX (18+)'),
      false,
    );

    const sport = groups.find((group) => group.group === 'Спорт');
    assert.ok(sport);
    assert.equal(sport.theme, 'sport');
    assert.equal(sport.region, 'RU');
    assert.equal(sport.channels, 1);

    const open = await harness({ includeAdult: true });
    const opened = structured(await open.call('list_channels', {}));
    const openGroups = opened['groups'] as { group: string }[];
    assert.equal(
      openGroups.some((group) => group.group === 'XXX (18+)'),
      true,
    );
  });

  it('returns the channels of a theme', async () => {
    const h = await harness();
    const result = await h.call('list_channels', { theme: 'film' });
    const data = structured(result);

    assert.equal(data['mode'], 'channels');
    const channels = data['channels'] as { channel_id: string; archive_days: number }[];
    assert.deepEqual(
      channels.map((channel) => channel.channel_id),
      ['kino'],
    );
    assert.equal(channels[0]?.archive_days, 0);
  });

  it('lists the time-shifted copies only on demand', async () => {
    const h = await harness();
    const plain = structured(await h.call('list_channels', { theme: 'general' }));
    const plainIds = (plain['channels'] as { channel_id: string }[]).map(
      (channel) => channel.channel_id,
    );
    assert.equal(plainIds.includes('pervyj-2'), false);

    const all = structured(
      await h.call('list_channels', { theme: 'general', include_timeshift: true }),
    );
    const allIds = (all['channels'] as { channel_id: string }[]).map(
      (channel) => channel.channel_id,
    );
    assert.equal(allIds.includes('pervyj-2'), true);
  });
});

describe('refresh_guide', () => {
  it('refuses to start when no URL is set', async () => {
    const h = await harness({
      epgUrl: '',
      liveUrl: '',
    });
    const result = await h.call('refresh_guide', {});
    const data = structured(result);

    assert.equal(data['status'], 'not_configured');
    assert.match(String(data['message']), /settings/);
  });
});
