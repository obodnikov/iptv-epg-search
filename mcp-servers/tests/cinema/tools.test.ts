/**
 * tools.test.ts - the contract of the tools of the cinema server.
 *
 * The tools are called through the SDK's in-memory transport, the way a
 * client calls them.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fixture } from '../fixtures/load.ts';
import { putVector } from '../../src/shared/vectors.ts';
import { cinemaHarness, structured, textOf, type CinemaHarness } from './harness.ts';

const catalogue = fixture('import-a.m3u');
const withAdult = fixture('cinema-adult.m3u');

/**
 * A catalogue with more titles than a page may hold.
 */
function manyTitles(): string {
  const lines = ['#EXTM3U'];
  for (let i = 1; i <= 60; i++) {
    lines.push(
      `#EXTINF:5760 genres="Драма" rating="7" year="2024" country="France" group-title="Зарубежные фильмы", Фильм ${i}`,
    );
    lines.push(`http://example.invalid/film${i}.m3u8?token=KEY`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * A series with three episodes in its first season.
 */
function seriesWithThreeEpisodes(): string {
  const lines = ['#EXTM3U'];
  for (let episode = 1; episode <= 3; episode++) {
    lines.push(
      `#EXTINF:-1 genres="Драма" rating="8" year="2026" duration="44" country="Россия" added="2026-05-01 03:17:27+03:00" group-title="Сериалы", Сериал S01E0${episode}`,
    );
    lines.push(`http://example.invalid/ep${episode}.m3u8?token=KEY`);
  }
  return `${lines.join('\n')}\n`;
}

/** The settings of a server that has the URL of the provider. */
const configured = { cinemaUrl: 'http://provider.invalid/catalogue.m3u?token=SECRETKEY123' };

async function withServer(
  run: (harness: CinemaHarness) => Promise<void>,
  options: { settings?: Record<string, unknown>; catalogue?: string } = {},
): Promise<void> {
  const harness = await cinemaHarness({
    settings: options.settings ?? configured,
    catalogue: options.catalogue ?? catalogue,
  });
  try {
    await run(harness);
  } finally {
    await harness.cleanup();
  }
}

/** The items of a list answer. */
function items(result: Awaited<ReturnType<CinemaHarness['call']>>): Record<string, unknown>[] {
  const data = structured(result);
  return (data['items'] as Record<string, unknown>[]) ?? [];
}

describe('the tools of the cinema server', () => {
  it('registers the seven tools of the design', async () => {
    await withServer(async (harness) => {
      const tools = await harness.client.listTools();
      const names = tools.tools.map((tool) => tool.name).sort();
      assert.deepEqual(names, [
        'find_similar_titles',
        'get_status',
        'get_title',
        'list_episodes',
        'list_facets',
        'refresh_catalog',
        'search_titles',
      ]);
    });
  });

  it('declares an output schema for every tool', async () => {
    await withServer(async (harness) => {
      const tools = await harness.client.listTools();
      for (const tool of tools.tools) {
        assert.ok(tool.outputSchema, `${tool.name} has no output schema`);
        assert.equal(tool.outputSchema['type'], 'object');
      }
    });
  });

  it('marks the read tools as read-only and the refresh as a write', async () => {
    await withServer(async (harness) => {
      const tools = await harness.client.listTools();
      const byName = new Map(tools.tools.map((tool) => [tool.name, tool]));

      for (const name of [
        'search_titles',
        'find_similar_titles',
        'get_title',
        'list_episodes',
        'list_facets',
        'get_status',
      ]) {
        assert.equal(byName.get(name)?.annotations?.readOnlyHint, true, name);
      }

      const refresh = byName.get('refresh_catalog');
      assert.equal(refresh?.annotations?.readOnlyHint, false);
      assert.equal(refresh?.annotations?.idempotentHint, true);
    });
  });
});

describe('search_titles', () => {
  it('finds a film by the words of the query', async () => {
    await withServer(async (harness) => {
      const result = await harness.call('search_titles', { query: 'Кали' });
      const data = structured(result);

      assert.equal(data['total'], 1);
      assert.equal(data['search_mode'], 'words');

      const found = items(result);
      assert.equal(found.length, 1);
      assert.equal(found[0]?.['title'], 'Кали');
      assert.equal(found[0]?.['type'], 'film');
      assert.equal(found[0]?.['year'], 2024);
      assert.equal(found[0]?.['rating'], 7);
    });
  });

  it('finds the series of the catalogue as well', async () => {
    await withServer(async (harness) => {
      const result = await harness.call('search_titles', { query: 'Бабье царство' });
      const found = items(result);

      assert.equal(found.length, 1);
      assert.equal(found[0]?.['title'], 'Бабье царство');
      assert.equal(found[0]?.['type'], 'series');
      assert.equal(found[0]?.['seasons'], 1);
      assert.equal(found[0]?.['episodes'], 1);
    });
  });

  it('filters by genre, country and rating', async () => {
    await withServer(async (harness) => {
      const result = await harness.call('search_titles', {
        genres: ['Драма'],
        countries: ['FR'],
        min_rating: 7,
      });
      const found = items(result);

      assert.equal(found.length, 1);
      assert.equal(found[0]?.['title'], 'Кали');
      assert.deepEqual(found[0]?.['genres'], ['Боевик', 'Драма']);
      assert.deepEqual(found[0]?.['countries'], ['FR']);
    });
  });

  it('finds a title by the country of the provider, in any language', async () => {
    await withServer(async (harness) => {
      const byName = await harness.call('search_titles', { countries: ['Франция'] });
      const byCode = await harness.call('search_titles', { countries: ['FR'] });

      assert.equal(structured(byName)['total'], 1);
      assert.equal(structured(byCode)['total'], 1);
    });
  });

  it('answers with an error and the valid values for an unknown genre', async () => {
    await withServer(async (harness) => {
      const result = await harness.call('search_titles', { genres: ['фантастика'] });

      assert.equal(result.isError, true);
      const text = textOf(result);
      assert.match(text, /not found/);
      assert.match(text, /Драма/);
    });
  });

  it('answers with an error and the valid values for an unknown category', async () => {
    await withServer(async (harness) => {
      const result = await harness.call('search_titles', { categories: ['Нет такого'] });

      assert.equal(result.isError, true);
      assert.match(textOf(result), /Category .* not found/);
      assert.match(textOf(result), /Зарубежные фильмы/);
    });
  });

  it('never puts a play link into a list', async () => {
    await withServer(async (harness) => {
      const result = await harness.call('search_titles', { query: 'Кали' });
      const text = textOf(result);

      assert.equal(text.includes('play_url'), false);
      assert.equal(text.includes('.m3u8'), false);
      assert.equal(JSON.stringify(structured(result)).includes('play_url'), false);
      assert.equal(JSON.stringify(structured(result)).includes('m3u8'), false);
    });
  });

  it('reads the next page with the cursor', async () => {
    await withServer(async (harness) => {
      const first = await harness.call('search_titles', { limit: 1, sort: 'title' });
      const data = structured(first);

      assert.equal(data['total'], 3);
      assert.equal(items(first).length, 1);

      const cursor = data['next_cursor'];
      assert.ok(cursor, 'the first page has no cursor');

      const second = await harness.call('search_titles', {
        limit: 1,
        sort: 'title',
        cursor,
      });

      const firstTitle = items(first)[0]?.['title'];
      const secondTitle = items(second)[0]?.['title'];
      assert.notEqual(firstTitle, secondTitle);
    });
  });

  it('refuses a cursor of another search', async () => {
    await withServer(async (harness) => {
      const first = await harness.call('search_titles', { limit: 1, sort: 'title' });
      const cursor = structured(first)['next_cursor'];
      assert.ok(cursor);

      const other = await harness.call('search_titles', {
        limit: 1,
        sort: 'rating',
        cursor,
      });

      assert.equal(other.isError, true);
      assert.match(textOf(other), /different query/);
    });
  });

  it('leaves the adult content out unless the setting allows it', async () => {
    await withServer(
      async (harness) => {
        const result = await harness.call('search_titles', {});
        const titles = items(result).map((item) => item['title']);

        assert.equal(titles.includes('Ночной сериал'), false);
        assert.equal(titles.includes('Частые побочные явления'), true);
      },
      { catalogue: withAdult },
    );
  });

  it('shows the adult content when the setting allows it', async () => {
    await withServer(
      async (harness) => {
        const result = await harness.call('search_titles', {});
        const titles = items(result).map((item) => item['title']);

        assert.equal(titles.includes('Ночной сериал'), true);
      },
      { catalogue: withAdult, settings: { ...configured, includeAdult: true } },
    );
  });

  it('sorts by the rating and by the year', async () => {
    await withServer(async (harness) => {
      const byRating = await harness.call('search_titles', { sort: 'rating' });
      const ratings = items(byRating).map((item) => item['rating']);
      assert.deepEqual(ratings, [8, 7, 6]);

      const byYear = await harness.call('search_titles', { sort: 'year_desc' });
      const years = items(byYear).map((item) => item['year']);
      assert.deepEqual(years, [2026, 2024, 2020]);
    });
  });

  it('finds the titles that were added in the last days', async () => {
    await withServer(async (harness) => {
      // The fixture was added on 2026-05-01 and 2026-05-03; the clock of
      // the test is far later, so nothing is inside the window.
      const result = await harness.call('search_titles', { added_within_days: 1 });
      assert.equal(structured(result)['total'], 0);
    });
  });

  it('answers with an error when the URL of the provider is not set', async () => {
    await withServer(
      async (harness) => {
        const result = await harness.call('search_titles', { query: 'Кали' });

        assert.equal(result.isError, true);
        assert.match(textOf(result), /Cinema URL is not set/);
        assert.match(textOf(result), /settings\.json/);
      },
      { settings: { cinemaUrl: '' } },
    );
  });

  it('names the settings file in every tool when the URL is not set', async () => {
    await withServer(
      async (harness) => {
        // The facets of an empty catalogue would send the model into a
        // refresh that cannot work: the URL is what is missing.
        const facets = await harness.call('list_facets');
        assert.equal(facets.isError, true);
        assert.match(textOf(facets), /Cinema URL is not set/);
        assert.match(textOf(facets), /settings\.json/);

        const title = await harness.call('get_title', { title_id: 'a1b2c3d4e5f60718' });
        assert.equal(title.isError, true);
        assert.match(textOf(title), /Cinema URL is not set/);

        const episodes = await harness.call('list_episodes', { title_id: 'a1b2c3d4e5f60718' });
        assert.equal(episodes.isError, true);
        assert.match(textOf(episodes), /Cinema URL is not set/);
      },
      { settings: { cinemaUrl: '' } },
    );
  });

  it('answers with an error when the catalogue is empty', async () => {
    const harness = await cinemaHarness({ settings: configured });
    try {
      const result = await harness.call('search_titles', { query: 'Кали' });

      assert.equal(result.isError, true);
      assert.match(textOf(result), /empty/);
    } finally {
      await harness.cleanup();
    }
  });

  it('answers with an error for an unknown excluded genre', async () => {
    await withServer(async (harness) => {
      const result = await harness.call('search_titles', { exclude_genres: ['фантастика'] });

      assert.equal(result.isError, true);
      assert.match(textOf(result), /Genre .* not found/);
      assert.match(textOf(result), /Драма/);
    });
  });

  it('never returns more titles than the tool promises', async () => {
    // The setting asks for the most the tool may return.
    await withServer(
      async (harness) => {
        const result = await harness.call('search_titles', {});
        const data = structured(result);

        assert.equal(data['total'], 60);
        assert.equal(items(result).length, 50);
      },
      {
        catalogue: manyTitles(),
        settings: {
          ...configured,
          search: { defaultLimit: 50, maxLimit: 50, snippetChars: 200, meaningWeight: 0.7 },
        },
      },
    );
  });

  it('ignores a setting that promises more than the tool returns', async () => {
    // The setting is out of range: the default is used instead of 400.
    await withServer(
      async (harness) => {
        const result = await harness.call('search_titles', {});
        const data = structured(result);

        assert.equal(data['total'], 60);
        assert.equal(items(result).length, 20);
      },
      {
        catalogue: manyTitles(),
        settings: {
          ...configured,
          search: { defaultLimit: 400, maxLimit: 400, snippetChars: 200, meaningWeight: 0.7 },
        },
      },
    );
  });
});

describe('get_title', () => {
  it('returns the details and the play links of a film', async () => {
    await withServer(async (harness) => {
      const found = await harness.call('search_titles', { query: 'Кали' });
      const titleId = items(found)[0]?.['title_id'];
      assert.ok(titleId);

      const result = await harness.call('get_title', { title_id: titleId });
      const data = structured(result);

      assert.equal(data['title'], 'Кали');
      assert.equal(data['type'], 'film');
      assert.equal(data['director'], 'Julien Seri');
      assert.deepEqual(data['genres'], ['Боевик', 'Драма']);

      const variants = data['variants'] as Record<string, unknown>[];
      assert.equal(variants.length, 1);
      assert.equal(variants[0]?.['quality'], 'standard');
      assert.equal(variants[0]?.['duration_min'], 96);
      assert.match(String(variants[0]?.['play_url']), /^http:\/\/example\.invalid\//);
    });
  });

  it('returns the seasons of a series and no play link', async () => {
    await withServer(async (harness) => {
      const found = await harness.call('search_titles', { query: 'Бабье царство' });
      const titleId = items(found)[0]?.['title_id'];
      assert.ok(titleId);

      const result = await harness.call('get_title', { title_id: titleId });
      const data = structured(result);

      assert.equal(data['type'], 'series');
      assert.deepEqual(data['seasons'], [{ season: 1, episodes: 1 }]);
      assert.deepEqual(data['variants'], []);
    });
  });

  it('answers with an error for an unknown id', async () => {
    await withServer(async (harness) => {
      const result = await harness.call('get_title', { title_id: 'nope' });

      assert.equal(result.isError, true);
      assert.match(textOf(result), /No title with the id/);
    });
  });

  it('does not give the adult titles when the setting does not allow them', async () => {
    await withServer(
      async (harness) => {
        const found = await harness.call('search_titles', {
          genres: ['Эротические студии'],
        });
        // The list does not show the adult title at all, so its id is
        // taken from the database.
        const row = harness.db.get<{ title_id: string }>(
          'SELECT title_id FROM titles WHERE is_adult = 1 LIMIT 1',
        );
        assert.ok(row);

        const result = await harness.call('get_title', { title_id: row.title_id });

        assert.equal(result.isError, true);
        assert.match(textOf(result), /adult content/);
        assert.equal(textOf(result).includes('m3u8'), false);
        assert.equal(found.isError, true);
      },
      { catalogue: withAdult },
    );
  });

  it('gives the adult titles when the setting allows them', async () => {
    await withServer(
      async (harness) => {
        const row = harness.db.get<{ title_id: string }>(
          'SELECT title_id FROM titles WHERE is_adult = 1 LIMIT 1',
        );
        assert.ok(row);

        const result = await harness.call('get_title', { title_id: row.title_id });
        assert.equal(result.isError, undefined);
        assert.equal(structured(result)['title'], 'Ночной сериал');
      },
      { catalogue: withAdult, settings: { ...configured, includeAdult: true } },
    );
  });
});

describe('list_episodes', () => {
  it('returns the episodes of a series with their play links', async () => {
    await withServer(async (harness) => {
      const found = await harness.call('search_titles', { query: 'Бабье царство' });
      const titleId = items(found)[0]?.['title_id'];
      assert.ok(titleId);

      const result = await harness.call('list_episodes', { title_id: titleId });
      const data = structured(result);

      assert.equal(data['season'], 1);
      assert.equal(data['total'], 1);

      const episodes = data['items'] as Record<string, unknown>[];
      assert.equal(episodes.length, 1);
      assert.equal(episodes[0]?.['season'], 1);
      assert.equal(episodes[0]?.['episode'], 1);
      assert.match(String(episodes[0]?.['play_url']), /^http:\/\/example\.invalid\//);
    });
  });

  it('answers with an error when the title is a film', async () => {
    await withServer(async (harness) => {
      const found = await harness.call('search_titles', { query: 'Кали' });
      const titleId = items(found)[0]?.['title_id'];
      assert.ok(titleId);

      const result = await harness.call('list_episodes', { title_id: titleId });

      assert.equal(result.isError, true);
      assert.match(textOf(result), /is a film/);
    });
  });

  it('reads the next page with the cursor', async () => {
    await withServer(
      async (harness) => {
        const found = await harness.call('search_titles', { query: 'Сериал' });
        const titleId = items(found)[0]?.['title_id'];
        assert.ok(titleId);

        const first = await harness.call('list_episodes', {
          title_id: titleId,
          limit: 1,
        });
        const firstData = structured(first);

        assert.equal(firstData['total'], 3);
        const cursor = firstData['next_cursor'];
        assert.ok(cursor);

        // The season of the answer is sent back with the cursor: it is the
        // same search, and the cursor fits.
        const second = await harness.call('list_episodes', {
          title_id: titleId,
          season: firstData['season'],
          limit: 1,
          cursor,
        });

        assert.equal(second.isError, undefined);
        const firstEpisode = (structured(first)['items'] as Record<string, unknown>[])[0];
        const secondEpisode = (structured(second)['items'] as Record<string, unknown>[])[0];
        assert.notEqual(firstEpisode?.['episode'], secondEpisode?.['episode']);
      },
      { catalogue: seriesWithThreeEpisodes() },
    );
  });

  it('reads the next page with the cursor alone', async () => {
    await withServer(
      async (harness) => {
        const found = await harness.call('search_titles', { query: 'Сериал' });
        const titleId = items(found)[0]?.['title_id'];
        assert.ok(titleId);

        const first = await harness.call('list_episodes', {
          title_id: titleId,
          limit: 1,
        });
        const cursor = structured(first)['next_cursor'];
        assert.ok(cursor);

        const second = await harness.call('list_episodes', {
          title_id: titleId,
          limit: 1,
          cursor,
        });

        assert.equal(second.isError, undefined);
        assert.equal(structured(second)['total'], 3);
      },
      { catalogue: seriesWithThreeEpisodes() },
    );
  });

  it('refuses a cursor of another series', async () => {
    await withServer(
      async (harness) => {
        const first = await harness.call('search_titles', { keywords: ['Сериал один'] });
        const firstId = items(first)[0]?.['title_id'];
        assert.ok(firstId);

        const second = await harness.call('search_titles', { keywords: ['Сериал два'] });
        const secondId = items(second)[0]?.['title_id'];
        assert.ok(secondId);

        const page = await harness.call('list_episodes', {
          title_id: firstId,
          limit: 1,
        });
        const cursor = structured(page)['next_cursor'];
        assert.ok(cursor);

        // The cursor of the first series does not fit the second one.
        const other = await harness.call('list_episodes', {
          title_id: secondId,
          cursor,
        });

        assert.equal(other.isError, true);
        assert.match(textOf(other), /different query/);
      },
      { catalogue: fixture('cinema-two-series.m3u') },
    );
  });

  it('refuses a cursor of another season', async () => {
    await withServer(
      async (harness) => {
        const found = await harness.call('search_titles', { keywords: ['Сериал один'] });
        const titleId = items(found)[0]?.['title_id'];
        assert.ok(titleId);

        const page = await harness.call('list_episodes', {
          title_id: titleId,
          limit: 1,
        });
        const cursor = structured(page)['next_cursor'];
        assert.ok(cursor);

        const other = await harness.call('list_episodes', {
          title_id: titleId,
          season: 2,
          cursor,
        });

        assert.equal(other.isError, true);
        assert.match(textOf(other), /different query/);
      },
      { catalogue: fixture('cinema-two-series.m3u') },
    );
  });
});

describe('list_facets', () => {
  it('returns the values of the catalogue with their counts', async () => {
    await withServer(async (harness) => {
      const result = await harness.call('list_facets');
      const data = structured(result);

      const totals = data['totals'] as Record<string, unknown>;
      assert.equal(totals['titles'], 3);
      assert.equal(totals['films'], 2);
      assert.equal(totals['series'], 1);

      const genres = data['genres'] as Record<string, unknown>[];
      assert.ok(genres.some((genre) => genre['name'] === 'Драма'));

      const categories = data['categories'] as Record<string, unknown>[];
      assert.ok(categories.some((category) => category['name'] === 'Зарубежные фильмы'));

      const countries = data['countries'] as Record<string, unknown>[];
      assert.ok(countries.some((country) => country['code'] === 'FR'));

      assert.equal(data['year_from'], 2020);
      assert.equal(data['year_to'], 2026);
      assert.equal(data['new_tag_count'], 0);
    });
  });

  it('leaves the adult categories out unless the setting allows it', async () => {
    await withServer(
      async (harness) => {
        const result = await harness.call('list_facets');
        const categories = structured(result)['categories'] as Record<string, unknown>[];
        const names = categories.map((category) => category['name']);

        assert.equal(names.includes('Эротика (18+)'), false);
      },
      { catalogue: withAdult },
    );
  });
});

describe('get_status', () => {
  it('reports the state of the server', async () => {
    await withServer(async (harness) => {
      const result = await harness.call('get_status');
      const data = structured(result);

      assert.equal(data['settings_path'], harness.settingsPath);
      assert.equal(data['configured'], true);
      assert.match(String(data['cinema_url']), /^http:\/\/provider\.invalid/);
      // The URL of the provider carries the access key: it is masked.
      assert.equal(String(data['cinema_url']).includes('SECRETKEY'), false);

      const counts = data['counts'] as Record<string, unknown>;
      assert.equal(counts['titles'], 3);

      assert.equal(data['search_mode'], 'words');
    });
  });

  it('says that the URL is not set', async () => {
    await withServer(
      async (harness) => {
        const result = await harness.call('get_status');
        const data = structured(result);

        assert.equal(data['configured'], false);
        assert.equal(data['cinema_url'], 'not set');
      },
      { settings: { cinemaUrl: '' } },
    );
  });
});

describe('refresh_catalog', () => {
  it('answers with an error and the settings file when the URL is not set', async () => {
    await withServer(
      async (harness) => {
        const result = await harness.call('refresh_catalog', {});
        const data = structured(result);

        assert.equal(data['status'], 'not_configured');
        assert.equal(data['settings_path'], harness.settingsPath);
        assert.match(String(data['message']), /Cinema URL is not set/);
      },
      { settings: { cinemaUrl: '' } },
    );
  });

  it('starts the refresh in the background', async () => {
    await withServer(async (harness) => {
      const result = await harness.call('refresh_catalog', {});
      const data = structured(result);

      // The provider of the test does not exist: the refresh fails in the
      // background, but the answer comes at once.
      assert.equal(data['status'], 'started');
      assert.match(String(data['message']), /background/);

      await harness.waitForRefresh();
    });
  });
});

describe('the search by meaning', () => {
  it('says that it searched by the words when there are no vectors', async () => {
    await withServer(async (harness) => {
      const result = await harness.call('search_titles', { query: 'Кали' });

      assert.equal(structured(result)['search_mode'], 'words');
    });
  });

  it('says that it searched by the words and by the meaning when there are vectors', async () => {
    await withServer(async (harness) => {
      harness.worker.start();
      await harness.waitForEmbedding();

      const result = await harness.call('search_titles', { query: 'Кали' });
      const data = structured(result);

      assert.equal(data['search_mode'], 'words+meaning');
      // The union of the word matches and the titles that have a vector.
      assert.equal(data['total'], 3);
    });
  });

  it('finds a title by the meaning when no word matches', async () => {
    await withServer(async (harness) => {
      harness.worker.start();
      await harness.waitForEmbedding();

      const result = await harness.call('search_titles', {
        query: 'одиночество в космосе',
      });
      const data = structured(result);

      assert.equal(data['search_mode'], 'words+meaning');
      // The words match nothing, but the titles with a vector are there.
      assert.equal(data['total'], 3);
      assert.ok((items(result).length ?? 0) > 0);
    });
  });

  it('keeps the order of the request when another order is asked for', async () => {
    await withServer(async (harness) => {
      harness.worker.start();
      await harness.waitForEmbedding();

      const result = await harness.call('search_titles', {
        query: 'Кали',
        sort: 'rating',
      });

      // Another order asks for something else than the meaning.
      assert.equal(structured(result)['search_mode'], 'words');
      // The words still narrow the result down.
      assert.equal(structured(result)['total'], 1);
      assert.equal(items(result)[0]?.['title'], 'Кали');
    });
  });
});

describe('find_similar_titles', () => {
  it('answers with the titles that are like a title of the catalogue', async () => {
    await withServer(async (harness) => {
      harness.worker.start();
      await harness.waitForEmbedding();

      const search = await harness.call('search_titles', { keywords: ['Кали'] });
      const source = String(items(search)[0]?.['title_id']);

      const result = await harness.call('find_similar_titles', { title_id: source });
      const data = structured(result);

      assert.equal(data['search_mode'], 'words+meaning');
      assert.equal(data['source'], source);
      // The title itself is never in the answer.
      assert.equal(
        (items(result) as Record<string, unknown>[]).some(
          (item) => item['title_id'] === source,
        ),
        false,
      );
    });
  });

  it('answers with the titles that are like a description', async () => {
    await withServer(async (harness) => {
      harness.worker.start();
      await harness.waitForEmbedding();

      const result = await harness.call('find_similar_titles', {
        description: 'a quiet french drama about a family',
      });
      const data = structured(result);

      assert.equal(data['search_mode'], 'words+meaning');
      assert.ok((items(result).length ?? 0) > 0);
    });
  });

  it('asks for a title or a description', async () => {
    await withServer(async (harness) => {
      const result = await harness.call('find_similar_titles', {});

      assert.equal(result.isError, true);
      assert.match(textOf(result), /title_id/);
    });
  });

  it('answers with an error for an unknown title', async () => {
    await withServer(async (harness) => {
      const result = await harness.call('find_similar_titles', {
        title_id: '0000000000000000',
      });

      assert.equal(result.isError, true);
      assert.match(textOf(result), /No title with the id/);
    });
  });

  it('falls back to the genres when there are no vectors', async () => {
    await withServer(async (harness) => {
      const search = await harness.call('search_titles', { keywords: ['Кали'] });
      const source = String(items(search)[0]?.['title_id']);

      const result = await harness.call('find_similar_titles', { title_id: source });
      const data = structured(result);

      assert.equal(data['search_mode'], 'words');
      // Only the series shares a genre with "Кали".
      assert.equal(data['total'], 1);
    });
  });
});

describe('get_status and the embeddings', () => {
  it('tells that the embeddings are switched off', async () => {
    await withServer(async (harness) => {
      const result = await harness.call('get_status');
      const data = structured(result);
      const embedding = data['embedding'] as Record<string, unknown>;

      assert.equal(embedding['enabled'], true);
      assert.equal(embedding['running'], false);
      assert.equal(data['search_mode'], 'words');
    });
  });

  it('tells that the search by meaning is there', async () => {
    await withServer(async (harness) => {
      harness.worker.start();
      await harness.waitForEmbedding();

      const result = await harness.call('get_status');
      const data = structured(result);
      const vectors = data['vectors'] as Record<string, unknown>;

      assert.equal(vectors['done'], 3);
      assert.equal(vectors['meaning'], true);
      assert.equal(data['search_mode'], 'words+meaning');
    });
  });

  it('tells that the search by meaning is there after a restart', async () => {
    await withServer(async (harness) => {
      // The vectors of an earlier run are in the database, but this process
      // has not embedded anything itself.
      const rows = harness.db.all<{ text_hash: string }>(
        'SELECT text_hash FROM titles WHERE text_hash IS NOT NULL',
      );
      for (const row of rows) {
        putVector(harness.db, {
          textHash: row.text_hash,
          model: 'BAAI/bge-m3',
          embedding: new Float32Array([1, 0]),
          createdAt: 1_800_000_000_000,
        });
      }

      const result = await harness.call('get_status');
      const data = structured(result);
      const vectors = data['vectors'] as Record<string, unknown>;

      assert.equal(vectors['done'], 3);
      assert.equal(vectors['meaning'], true);
      assert.equal(data['search_mode'], 'words+meaning');
    });
  });
});
