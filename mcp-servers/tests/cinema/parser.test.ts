import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fixture } from '../fixtures/load.ts';
import {
  isAdultCategory,
  parseCinemaCatalog,
  parseRating,
  parseYear,
  splitGenres,
  splitQuality,
} from '../../src/cinema/parser.ts';
import { buildCatalog } from '../../src/cinema/catalog.ts';

const sample = fixture('cinema-sample.m3u');

describe('splitGenres', () => {
  it('trims the genres', () => {
    const { genres } = splitGenres('Комедия , Детектив');
    assert.deepEqual(genres, ['Комедия', 'Детектив']);
  });

  it('keeps the provider tags out of the genres', () => {
    const { genres, tags } = splitGenres('Комедия,Новинки,Сериал');
    assert.deepEqual(genres, ['Комедия']);
    assert.deepEqual(tags, ['Новинки', 'Сериал']);
  });

  it('drops empty parts', () => {
    assert.deepEqual(splitGenres('Комедия,,Драма').genres, ['Комедия', 'Драма']);
  });
});

describe('parseRating', () => {
  it('reads a rating', () => {
    assert.equal(parseRating('7'), 7);
    assert.equal(parseRating('8.5'), 8.5);
  });

  it('reads an empty rating as "not set"', () => {
    assert.equal(parseRating(''), null);
    assert.equal(parseRating('   '), null);
    assert.equal(parseRating(undefined), null);
  });

  it('keeps a real zero', () => {
    assert.equal(parseRating('0'), 0);
  });

  it('rejects a broken value', () => {
    assert.equal(parseRating('high'), null);
    assert.equal(parseRating('7abc'), null);
    assert.equal(parseRating('7.5.1'), null);
  });
});

describe('splitQuality', () => {
  it('takes the quality suffix off the title', () => {
    assert.deepEqual(splitQuality('Кали (4K HDR)'), { title: 'Кали', quality: '4K HDR' });
    assert.deepEqual(splitQuality('Кали (4K)'), { title: 'Кали', quality: '4K' });
    assert.deepEqual(splitQuality('Кали (4K SDR)'), { title: 'Кали', quality: '4K SDR' });
    assert.deepEqual(splitQuality('Кали (4K HD)'), { title: 'Кали', quality: '4K HD' });
    assert.deepEqual(splitQuality('Кали (HDR)'), { title: 'Кали', quality: 'HDR' });
    assert.deepEqual(splitQuality('Кали (UHD)'), { title: 'Кали', quality: 'UHD' });
  });

  it('takes the quality suffix with a Cyrillic К off the title', () => {
    // The provider writes "4К HDR" with a Cyrillic К in some entries.
    assert.deepEqual(splitQuality('Кириллица (4К HDR)'), {
      title: 'Кириллица',
      quality: '4К HDR',
    });
  });

  it('keeps a bracket that only starts like a quality', () => {
    assert.deepEqual(splitQuality('Дети (4Kids)'), { title: 'Дети (4Kids)', quality: 'standard' });
    assert.deepEqual(splitQuality('Шоу (UHDTV)'), { title: 'Шоу (UHDTV)', quality: 'standard' });
    assert.deepEqual(splitQuality('Фильм (4Квест)'), {
      title: 'Фильм (4Квест)',
      quality: 'standard',
    });
  });

  it('calls a title without a suffix standard', () => {
    assert.deepEqual(splitQuality('Kaли'), { title: 'Kaли', quality: 'standard' });
  });

  it('keeps a bracket that is not a quality', () => {
    assert.deepEqual(splitQuality('Kaли (1978)'), { title: 'Kaли (1978)', quality: 'standard' });
  });
});

describe('isAdultCategory', () => {
  it('recognises the 18+ category', () => {
    assert.equal(isAdultCategory('Эротика (18+)'), true);
    assert.equal(isAdultCategory('18+'), true);
    assert.equal(isAdultCategory('Зарубежные фильмы'), false);
  });

  it('does not take a year for a marker', () => {
    assert.equal(isAdultCategory('2018+'), false);
    assert.equal(isAdultCategory('Top 18 hits 2018+'), false);
    assert.equal(isAdultCategory('Фильмы 118+'), false);
  });
});

describe('parseCinemaCatalog', () => {
  const parsed = parseCinemaCatalog(sample);

  it('accepts the file', () => {
    assert.equal(parsed.hasHeader, true);
  });

  it('reads the attributes of a film', () => {
    const film = parsed.entries.find((entry) => entry.title === 'Кали' && entry.quality === '4K HDR');
    assert.ok(film);
    assert.equal(film.type, 'film');
    assert.equal(film.year, 2024);
    assert.equal(film.rating, 7);
    assert.equal(film.director, 'Julien Seri');
    assert.equal(film.category, 'Ultra HD');
    assert.deepEqual(film.genres, ['Боевик']);
    assert.ok(film.tags.includes('Новинки'));
  });

  it('reads the number after #EXTINF as seconds and turns it into minutes', () => {
    const film = parsed.entries.find((entry) => entry.title === 'Кали');
    assert.equal(film?.durationMin, 96);
  });

  it('reads the duration of an episode from the attribute, in minutes', () => {
    const episode = parsed.entries.find((entry) => entry.seriesTitle === 'Бабье царство');
    assert.equal(episode?.durationMin, 44);
  });

  it('reads the episode pattern in all its forms', () => {
    const episodes = parsed.entries.filter((entry) => entry.seriesTitle === 'Бабье царство');
    assert.equal(episodes.length, 4);
    assert.deepEqual(
      episodes.map((entry) => [entry.season, entry.episode]),
      [
        [1, 1],
        [1, 2],
        [2, 3],
        [2, 3],
      ],
    );
  });

  it('keeps the name after the episode pattern out of the series title', () => {
    const episode = parsed.entries.find((entry) => entry.title === 'Бабье царство s02e03 - Начало');
    assert.equal(episode?.seriesTitle, 'Бабье царство');
  });

  it('reads the added date with its offset', () => {
    const film = parsed.entries.find((entry) => entry.title === 'Кали');
    assert.equal(film?.addedRaw, '2026-05-03 13:08:59+03:00');
    assert.equal(film?.addedAt, Date.UTC(2026, 4, 3, 10, 8, 59) / 1000);
  });

  it('reads the country list', () => {
    const entry = parsed.entries.find((entry) => entry.title === 'Список');
    assert.deepEqual(entry?.countryList, ['Canada', 'United States of America']);
  });

  it('marks a censored entry as adult', () => {
    const adult = parsed.entries.find((entry) => entry.title === 'Что-то для взрослых S01E01');
    assert.equal(adult?.censored, true);
    assert.equal(adult?.isAdult, true);
  });

  it('rejects an entry whose stream line is not an http URL', () => {
    assert.equal(parsed.rejected, 1);
    assert.equal(parsed.entries.some((entry) => entry.title === 'Битый поток'), false);
  });

  it('counts an entry without a stream line', () => {
    assert.equal(parsed.incomplete, 1);
    assert.equal(parsed.entries.some((entry) => entry.title === 'Без потока'), false);
  });

  it('drops a poster that is not an http URL', () => {
    const entry = parsed.entries.find((item) => item.title === 'Плохой постер');
    assert.ok(entry);
    assert.equal(entry.poster, '');
  });

  it('has no length for a film that is shorter than a minute', () => {
    const entry = parsed.entries.find((item) => item.title === 'Короткий');
    assert.ok(entry);
    assert.equal(entry.durationMin, null);
  });

  it('keeps a real zero rating', () => {
    const entry = parsed.entries.find((item) => item.title === 'Все по новой');
    assert.equal(entry?.rating, 0);
  });

  it('rejects a broken rating', () => {
    assert.equal(parseRating('high'), null);
    assert.equal(parseRating('7abc'), null);
    assert.equal(parseRating('7.5.1'), null);
  });

  it('rejects a rating outside 0-10', () => {
    assert.equal(parseRating('-1'), null);
    assert.equal(parseRating('11'), null);
    assert.equal(parseRating('100'), null);
    assert.equal(parseRating('10'), 10);
    assert.equal(parseRating('9.5'), 9.5);
  });

  it('reads the year strictly', () => {
    assert.equal(parseYear('2024'), 2024);
    assert.equal(parseYear(''), null);
    assert.equal(parseYear('2024-25'), null);
    assert.equal(parseYear('20x4'), null);
    assert.equal(parseYear('20245'), null);
  });

  it('reads an empty rating as "not set"', () => {
    const episode = parsed.entries.find((entry) => entry.title === 'Бабье царство S01E01');
    assert.equal(episode?.rating, null);
  });

  it('accepts a file with a byte order mark', () => {
    const withBom = parseCinemaCatalog(`\uFEFF${sample}`);
    assert.equal(withBom.hasHeader, true);
    assert.equal(withBom.entries.length, parsed.entries.length);
  });
});

describe('buildCatalog', () => {
  const { titles, stats } = buildCatalog(parseCinemaCatalog(sample).entries);

  it('merges a film and its 4K twin into one title with two variants', () => {
    const film = titles.find((title) => title.titleNorm === 'кали');
    assert.ok(film);
    assert.equal(film.type, 'film');
    assert.equal(film.variants.length, 2);
    assert.deepEqual(
      film.variants.map((variant) => variant.quality).sort(),
      ['4K HDR', 'standard'],
    );
  });

  it('groups the episodes of a series and drops the duplicate', () => {
    const series = titles.find((title) => title.type === 'series' && title.titleNorm === 'бабье царство');
    assert.ok(series);
    assert.equal(series.episodeCount, 3);
    assert.equal(series.seasonCount, 2);
    assert.deepEqual(
      series.episodes.map((episode) => [episode.season, episode.episode]),
      [
        [1, 1],
        [1, 2],
        [2, 3],
      ],
    );
  });

  it('takes the earliest year of a series', () => {
    const series = titles.find((title) => title.type === 'series' && title.titleNorm === 'бабье царство');
    assert.equal(series?.year, 2025);
  });

  it('takes the latest added date of a series', () => {
    const series = titles.find((title) => title.type === 'series' && title.titleNorm === 'бабье царство');
    // 2026-05-01 03:17:27+03:00 is 00:17:27 UTC.
    assert.equal(series?.addedAt, Date.UTC(2026, 4, 1, 0, 17, 27) / 1000);
  });

  it('unions the genres of a series', () => {
    const series = titles.find((title) => title.type === 'series' && title.titleNorm === 'бабье царство');
    // The provider tag "Новинки" is not a genre.
    assert.deepEqual(series?.genres.slice().sort(), ['Детектив', 'Драма', 'Комедия']);
  });

  it('uses the most common episode length of a series', () => {
    const series = titles.find((title) => title.type === 'series' && title.titleNorm === 'бабье царство');
    assert.equal(series?.durationMin, 44);
  });

  it('builds the id seed from type, normalised title and year', () => {
    const film = titles.find((title) => title.titleNorm === 'кали');
    assert.equal(film?.idSeed, 'film | кали | 2024');
    const series = titles.find((title) => title.type === 'series' && title.titleNorm === 'бабье царство');
    assert.equal(series?.idSeed, 'series | бабье царство | 2025');
  });

  it('counts the titles', () => {
    assert.equal(stats.films, 8);
    assert.equal(stats.series, 3);
    assert.equal(stats.episodes, 6);
  });

  it('reports a series whose episodes name more than one director', () => {
    const collision = stats.seriesCollisions.find((item) => item.title === 'одинаковое имя');
    assert.ok(collision);
    assert.deepEqual(collision.directors.sort(), ['Второй Режиссер', 'Первый Режиссер']);
  });

  it('names a collision by the series title, not by the id seed', () => {
    for (const collision of stats.seriesCollisions) {
      assert.ok(!collision.title.includes('|'), collision.title);
      assert.ok(!collision.title.includes('series'), collision.title);
    }
  });

  it('keeps every country of the attribute apart', () => {
    const film = titles.find((title) => title.title === 'Список');
    assert.deepEqual(film?.countries, ['Canada', 'United States of America']);
  });

  it('takes the length of a variant when the first one has none', () => {
    // The first "Двойной" has no length (20 seconds), the 4K variant has one.
    const film = titles.find((title) => title.title === 'Двойной');
    assert.equal(film?.durationMin, 60);
    assert.equal(film?.variants.length, 2);
  });

  it('keeps a bracket that only starts like a quality', () => {
    const film = titles.find((title) => title.title === 'Дети (4Kids)');
    assert.ok(film);
    assert.deepEqual(film.variants.map((variant) => variant.quality), ['standard']);
  });

  it('takes the quality with a Cyrillic К off the title', () => {
    const film = titles.find((title) => title.title === 'Кириллица');
    assert.ok(film);
    assert.deepEqual(film.variants.map((variant) => variant.quality), ['4К HDR']);
  });

  it('marks the adult series as adult', () => {
    const adult = titles.find((title) => title.titleNorm === 'что то для взрослых');
    assert.equal(adult?.isAdult, true);
  });
});
