/**
 * derived.test.ts - the derived fields of the programme texts.
 *
 * The cases of the design (tv-guide-server.md §10, phase T2): the
 * endings with several countries, without genres and without a year, the
 * "Трансляция из США" of the title, the markers after the live mark, the
 * family key of "Первый HD" and "Первый канал (+2)".
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  buildProgrammeText,
  applyChannelKind,
  embedTextHash,
  programmeTextHash,
} from '../../src/tv-guide/texts.ts';
import { extractFilmEnding, extractSport, extractVenue } from '../../src/tv-guide/extract.ts';
import { kindFromGenres, kindFromTheme, kindFromTitle, markerOf } from '../../src/tv-guide/kind.ts';
import { resolveGroup } from '../../src/tv-guide/groups.ts';
import { channelQuality, familyKey, timeshiftHours } from '../../src/tv-guide/channel-facts.ts';

describe('the title of a programme', () => {
  it('takes the type marker off', () => {
    const text = buildProgrammeText('х/ф Бык', 'Драма о трудовых буднях.');
    assert.equal(text.title, 'Бык');
    assert.equal(text.marker, 'х/ф');
    assert.equal(text.liveMark, false);
    assert.equal(text.kind, 'film');
    assert.equal(text.kindSource, 'marker');
  });

  it('takes the live mark off and keeps it as a flag', () => {
    const text = buildProgrammeText('⋗ ЧМ-2026. Швеция – Тунис. Трансляция из Мексики', '');
    assert.equal(text.title, 'ЧМ-2026. Швеция – Тунис. Трансляция из Мексики');
    assert.equal(text.liveMark, true);
    assert.equal(text.marker, null);
  });

  it('takes the marker off when it comes after the live mark', () => {
    const text = buildProgrammeText('⋗ х/ф Бык', 'Описание.');
    assert.equal(text.title, 'Бык');
    assert.equal(text.liveMark, true);
    assert.equal(text.marker, 'х/ф');
    assert.equal(text.kind, 'film');
  });

  it('normalises the title', () => {
    const text = buildProgrammeText('Х/Ф  Ёлка', '');
    assert.equal(text.titleNorm, 'елка');
  });

  it('names the marker of a title', () => {
    assert.equal(markerOf('м/с Три кота'), 'м/с');
    assert.equal(markerOf('Бык'), null);
  });
});

describe('the kind of a programme', () => {
  it('names the kind of every marker', () => {
    const cases: [string, string][] = [
      ['х/ф Бык', 'film'],
      ['к/ф Бык', 'film'],
      ['т/с Аллигатор', 'series'],
      ['м/ф Три кота', 'animation'],
      ['м/с Три кота', 'animated_series'],
      ['д/ф Земля', 'documentary'],
      ['д/с Вторжение', 'docuseries'],
    ];
    for (const [title, kind] of cases) {
      const text = buildProgrammeText(title, '');
      assert.equal(text.kind, kind, title);
      assert.equal(text.kindSource, 'marker', title);
    }
  });

  it('names a sport programme by its title', () => {
    const text = buildProgrammeText(
      'Футбол. ЧМ-2026. Нидерланды – Швеция. Трансляция из США',
      '',
    );
    assert.equal(text.kind, 'sport');
    assert.equal(text.kindSource, 'pattern');
    assert.equal(text.sport, 'Футбол');
  });

  it('names a sport programme by the place of the broadcast', () => {
    const text = buildProgrammeText('Матч по хоккею. Прямая трансляция', '');
    assert.equal(text.kind, 'sport');
    assert.equal(text.kindSource, 'pattern');
  });

  it('names a talk show by its genre', () => {
    const text = buildProgrammeText(
      'Пусть говорят',
      '… Реж.: Роман Бутовский. Вед.: Дмитрий Борисов. Россия, 2005, ток-шоу',
    );
    assert.equal(text.kind, 'show');
    assert.equal(text.kindSource, 'pattern');
  });

  it('names a documentary by its genre', () => {
    assert.equal(kindFromGenres(['документальный фильм']), 'documentary');
    assert.equal(kindFromGenres(['анимация']), 'animation');
    assert.equal(kindFromGenres(['драма', 'комедия']), null);
  });

  it('names nothing when the title says nothing', () => {
    assert.equal(kindFromTitle('Бык'), null);
    assert.equal(buildProgrammeText('Бык', 'Описание без фактов.').kind, 'other');
  });

  it('gives the theme of the channel a kind', () => {
    assert.equal(kindFromTheme('sport', false), 'sport');
    assert.equal(kindFromTheme('news', false), 'news');
    assert.equal(kindFromTheme('documentary', false), 'documentary');
    // A film channel gives "film" only with the film ending.
    assert.equal(kindFromTheme('film', false), null);
    assert.equal(kindFromTheme('film', true), 'film');
    assert.equal(kindFromTheme('general', true), null);
  });

  it('lets the theme of the channel win over the film ending', () => {
    // The description names a production, the text is a film because of
    // it; the channel says it is a documentary.
    const text = buildProgrammeText('Уроки рисования', '… Реж.: Ким Райт. Россия, 2015, драма');
    assert.equal(text.kind, 'film');
    assert.equal(text.kindSource, 'ending');
    const applied = applyChannelKind(text, 'documentary');
    assert.equal(applied.kind, 'documentary');
    assert.equal(applied.kindSource, 'channel');
  });

  it('keeps the pattern of the title over the theme of the channel', () => {
    // A sports broadcast on a news channel is a sport programme: the
    // provider names the sport in the title.
    const sport = buildProgrammeText(
      'Футбол. ЧМ-2026. Нидерланды – Швеция. Трансляция из США',
      '',
    );
    assert.equal(sport.kind, 'sport');
    assert.equal(sport.kindSource, 'pattern');
    const onNews = applyChannelKind(sport, 'news');
    assert.equal(onNews.kind, 'sport');
    assert.equal(onNews.kindSource, 'pattern');

    // A talk show on a film channel is a talk show: the genre of the
    // description names it.
    const show = buildProgrammeText(
      'Пусть говорят',
      '… Реж.: Роман Бутовский. Вед.: Дмитрий Борисов. Россия, 2005, ток-шоу',
    );
    assert.equal(show.kind, 'show');
    assert.equal(show.kindSource, 'pattern');
    const onFilm = applyChannelKind(show, 'film');
    assert.equal(onFilm.kind, 'show');
    assert.equal(onFilm.kindSource, 'pattern');
  });

  it('keeps the marker of the provider over the theme of the channel', () => {
    const text = buildProgrammeText('х/ф Бык', '… Россия, 2019, драма');
    const applied = applyChannelKind(text, 'documentary');
    assert.equal(applied.kind, 'film');
    assert.equal(applied.kindSource, 'marker');
  });
});

describe('the ending of a description', () => {
  it('reads the director, the cast, the countries, the year and the genres', () => {
    const ending = extractFilmEnding(
      'Драма о трудовых буднях. Реж.: Борис Хлебников. В ролях: Александр Яценко. Россия, 2019, драма',
    );
    assert.ok(ending);
    assert.equal(ending.directors, 'Борис Хлебников');
    assert.equal(ending.cast, 'Александр Яценко');
    assert.equal(ending.year, 2019);
    assert.deepEqual(ending.genres, ['драма']);
    assert.deepEqual(
      ending.countries.map((country) => [country.raw, country.code]),
      [['Россия', 'RU']],
    );
  });

  it('reads several countries', () => {
    const ending = extractFilmEnding(
      '… Реж.: Ким Райт. В ролях: Том Харди. США, Великобритания, 2016, драма, криминал',
    );
    assert.ok(ending);
    assert.equal(ending.year, 2016);
    assert.deepEqual(ending.genres, ['драма', 'криминал']);
    assert.deepEqual(
      ending.countries.map((country) => country.code),
      ['US', 'GB'],
    );
  });

  it('reads the countries the provider joins with a hyphen', () => {
    const ending = extractFilmEnding(
      '… Великобритания-Германия-Ирландия-США, 2011, комедия, фантазия',
    );
    assert.ok(ending);
    assert.deepEqual(
      ending.countries.map((country) => country.code),
      ['GB', 'DE', 'IE', 'US'],
    );
  });

  it('reads an ending without genres', () => {
    const ending = extractFilmEnding('… Реж.: Ким Райт. Россия, 2016');
    assert.ok(ending);
    assert.equal(ending.year, 2016);
    assert.deepEqual(ending.genres, []);
  });

  it('reads an ending without a year as no ending', () => {
    const ending = extractFilmEnding('… Реж.: Ким Райт. В ролях: Том Харди.');
    assert.ok(ending);
    assert.equal(ending.year, null);
    assert.deepEqual(ending.countries, []);
    assert.equal(ending.directors, 'Ким Райт');
  });

  it('does not take the cast for a country', () => {
    const ending = extractFilmEnding(
      '… В ролях: Квеси Боакье, Кайла Рэй Ковалевски, Тереза Галлахер, Дэн Расселл. Великобритания, 2011, комедия',
    );
    assert.ok(ending);
    assert.deepEqual(
      ending.countries.map((country) => country.raw),
      ['Великобритания'],
    );
  });

  it('does not take the host of a show for a country', () => {
    const ending = extractFilmEnding(
      '… Реж.: Роман Бутовский. Вед.: Дмитрий Борисов. Россия, 2005, ток-шоу',
    );
    assert.ok(ending);
    assert.equal(ending.year, 2005);
    assert.deepEqual(
      ending.countries.map((country) => country.raw),
      ['Россия'],
    );
  });

  it('does not take a year of a sentence for the year of a film', () => {
    const ending = extractFilmEnding(
      'В 2005, 2007, 2015 и 2017 году программа получила ТЭФИ как лучшая из информационно-аналитических программ',
    );
    assert.equal(ending, null);
  });

  it('keeps a country with a hyphen in its name', () => {
    // "Коста-Рика" is one country; it is not two countries joined by a
    // hyphen.
    const ending = extractFilmEnding('… Реж.: Ким Райт. Коста-Рика, 2019, драма');
    assert.ok(ending);
    assert.deepEqual(
      ending.countries.map((country) => [country.raw, country.code]),
      [['Коста-Рика', 'CR']],
    );
  });

  it('reads the country of a film in the genitive', () => {
    // The provider writes the country in the genitive: the lookup has to
    // compare the stems, not the names.
    const ending = extractFilmEnding('… Реж.: Алешандр Оpekк. Франции, 2015, драма');
    assert.ok(ending);
    assert.equal(ending.countries[0]?.code, 'FR');
  });

  it('does not cut a credit at an initial', () => {
    const ending = extractFilmEnding(
      '… Реж.: А. Иванов. В ролях: Дж. Смит, Том Харди. Россия, 2019, драма',
    );
    assert.ok(ending);
    assert.equal(ending.directors, 'А. Иванов');
    assert.equal(ending.cast, 'Дж. Смит, Том Харди');
    assert.equal(ending.year, 2019);
  });
});

describe('the venue of an event', () => {
  it('reads the place of the broadcast', () => {
    assert.equal(extractVenue('ЧМ-2026. Швеция – Тунис. Трансляция из Мексики'), 'Мексики');
  });

  it('does not cut the place at the full stop of an abbreviation', () => {
    assert.equal(extractVenue('Трансляция из г. Москвы'), 'г. Москвы');
    assert.equal(extractVenue('Трансляция из С. Петербурга'), 'С. Петербурга');
  });

  it('cuts the place at the end of its sentence', () => {
    assert.equal(extractVenue('Футбол. Матч. Трансляция из США. Прямая трансляция'), 'США');
  });

  it('takes the mark of the age off', () => {
    assert.equal(extractVenue('Хоккей. Матч. Трансляция из Казани (12+)'), 'Казани');
  });

  it('takes a broken mark of the age off', () => {
    assert.equal(extractVenue('Хоккей. Матч. Трансляция из Канады (1'), 'Канады');
  });

  it('reads nothing when the title names no place', () => {
    assert.equal(extractVenue('Бык'), null);
  });
});

describe('the sport of an event', () => {
  it('reads the sport of the title', () => {
    assert.equal(extractSport('Футбол. ЧМ-2026. Нидерланды – Швеция'), 'Футбол');
    assert.equal(extractSport('Биатлон. Кубок мира'), 'Биатлон');
    assert.equal(extractSport('Бык'), null);
  });
});

describe('the group of a channel', () => {
  it('knows the groups of the provider', () => {
    assert.deepEqual(resolveGroup('Кино'), { theme: 'film', region: 'RU', timeshiftHours: 0 });
    assert.deepEqual(resolveGroup('Israel'), { theme: 'general', region: 'IL', timeshiftHours: 0 });
    assert.deepEqual(resolveGroup('Ultra HD'), { theme: null, region: null, timeshiftHours: 0 });
    assert.deepEqual(resolveGroup('Baltic'), { theme: 'general', region: 'BALTIC', timeshiftHours: 0 });
  });

  it('knows the Russian time shifts', () => {
    const group = resolveGroup('Россия +4ч');
    assert.equal(group.theme, 'general');
    assert.equal(group.region, 'RU');
    assert.equal(group.timeshiftHours, 4);
  });

  it('lets the overrides of the settings win', () => {
    const group = resolveGroup('Кино', { Кино: { theme: 'sport', region: 'DE' } });
    assert.equal(group.theme, 'sport');
    assert.equal(group.region, 'DE');
  });

  it('takes the region of an unknown group from the country table', () => {
    // "France" is not a group of the playlist; the fallback reads the
    // region from the country table.
    assert.equal(resolveGroup('France').region, 'FR');
    // The groups of the playlist come from the table.
    assert.equal(resolveGroup('Deutschland').region, 'DE');
    assert.equal(resolveGroup('Türkiye').region, 'TR');
  });

  it('takes the theme of an unknown group from the words of its name', () => {
    // The groups of the playlist come from the table.
    assert.equal(resolveGroup('Мультфильмы').theme, 'kids');
    // The names below are not in the table: the fallback reads them.
    assert.equal(resolveGroup('Кинотеатры').theme, 'film');
    assert.equal(resolveGroup('Детские каналы').theme, 'kids');
    // "мультфильмы" holds "фильм" in the middle of it: it is a cartoon,
    // not a film.
    assert.equal(resolveGroup('Мультфильмы мира').theme, 'kids');
    assert.equal(resolveGroup('Детские мультфильмы').theme, 'kids');
    assert.equal(resolveGroup('Фильмы').theme, 'film');
  });

  it('looks the groups up without the case', () => {
    assert.equal(resolveGroup('кино').theme, 'film');
    assert.equal(resolveGroup('ИЗРАИЛЬ').region, 'IL');
    assert.equal(resolveGroup('россия +4ч').timeshiftHours, 4);
    assert.equal(resolveGroup('россия +4ч').region, 'RU');
  });

  it('keeps what the table says when the table says nothing', () => {
    // The group "Ultra HD" holds films and sport: nothing can be said
    // about it, and the fallback must not guess.
    const group = resolveGroup('Ultra HD');
    assert.equal(group.theme, null);
    assert.equal(group.region, null);
  });

  it('says nothing about an empty group', () => {
    assert.deepEqual(resolveGroup(null), { theme: null, region: null, timeshiftHours: 0 });
  });
});

describe('the name of a channel', () => {
  it('reads the quality', () => {
    assert.equal(channelQuality('Первый HD'), 2);
    assert.equal(channelQuality('Первый UHD'), 3);
    assert.equal(channelQuality('Канал 4K'), 4);
    assert.equal(channelQuality('Первый SD'), 0);
    assert.equal(channelQuality('Первый канал'), 1);
    // The mark has to be a word of its own.
    assert.equal(channelQuality('4Kids'), 1);
  });

  it('reads the time shift', () => {
    assert.equal(timeshiftHours('Россия +2ч'), 2);
    assert.equal(timeshiftHours('Первый канал (+4)'), 4);
    assert.equal(timeshiftHours('Первый канал'), 0);
  });

  it('builds the family key without the quality and the time shift', () => {
    assert.equal(familyKey('Первый канал (+2)'), 'первый канал');
    assert.equal(familyKey('Россия 1 HD'), 'россия 1');
    assert.equal(familyKey('Россия 1 (+2)'), 'россия 1');
    assert.equal(familyKey('Первый HD'), 'первый');
  });

  it('keeps the letter next to the quality mark of the name', () => {
    // The mark comes off, the letter next to it stays.
    assert.equal(familyKey('ПервыйHD'), 'первый');
    // The case of the mark does not matter.
    assert.equal(familyKey('первый hd'), 'первый');
    assert.equal(familyKey('Первый 4K'), 'первый');
  });

  it('takes the time shift with the hour suffix off the name', () => {
    // The suffix is written in Cyrillic, and the copy of the channel has
    // to share the family key with the original.
    assert.equal(familyKey('Россия +2ч'), familyKey('Россия'));
    assert.equal(familyKey('Первый +2ч'), 'первый');
    assert.equal(familyKey('Первый +2часа'), 'первый');
    assert.equal(familyKey('Первый +2часов'), 'первый');
    assert.equal(timeshiftHours('Россия +2ч'), 2);
    assert.equal(timeshiftHours('Россия +2часа'), 2);
  });

  it('takes a plus that is not a time shift for what it is', () => {
    // The channel "1+1" of the group "Украина" is not a copy of another
    // channel, and the number in the name is not a shift.
    assert.equal(timeshiftHours('1+1'), 0);
    assert.equal(familyKey('1+1'), '1 1');
  });

  it('takes a number in the name for what it is', () => {
    // Only the form with the plus marks the copy.
    assert.equal(timeshiftHours('Discovery (2)'), 0);
    assert.equal(familyKey('Discovery (2)'), 'discovery 2');
    assert.equal(timeshiftHours('Первый канал (+4)'), 4);
  });
});

describe('the text that is embedded', () => {
  it('carries the facts of the text', () => {
    const text = buildProgrammeText(
      'х/ф Бык',
      'Драма о трудовых буднях. Реж.: Борис Хлебников. В ролях: Александр Яценко. Россия, 2019, драма',
    );
    assert.match(text.embedText, /Бык \(2019\)/);
    assert.match(text.embedText, /Фильм/);
    assert.match(text.embedText, /Жанры: драма/);
    assert.match(text.embedText, /Страна: Россия/);
    assert.match(text.embedText, /Режиссер: Борис Хлебников/);
    assert.match(text.embedText, /Драма о трудовых буднях/);
  });

  it('hashes the text that is embedded', () => {
    const text = buildProgrammeText('Бык', 'Описание.');
    assert.equal(text.embedHash, embedTextHash(text.embedText));
    // The hash of the source pair is a different thing: it is the
    // identity of the text.
    assert.equal(text.hash, programmeTextHash('Бык', 'Описание.'));
    assert.notEqual(text.hash, text.embedHash);
  });

  it('keeps the hash of the source pair when only the facts change', () => {
    const text = buildProgrammeText('Бык', 'Описание.');
    // The kind of the text changes with the channels around it: the
    // identity of the text does not change with it.
    const applied = applyChannelKind(text, 'documentary');
    assert.equal(applied.hash, text.hash);
    assert.equal(applied.kind, 'documentary');
  });

  it('gives another hash to another pair of the source', () => {
    const first = buildProgrammeText('Бык', 'Описание.');
    const second = buildProgrammeText('Бык', 'Другое описание.');
    assert.notEqual(first.hash, second.hash);
    assert.notEqual(first.embedHash, second.embedHash);
  });
});
