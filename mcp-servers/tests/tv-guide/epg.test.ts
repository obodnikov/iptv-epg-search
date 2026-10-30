/**
 * The reader of the guide: the details that the import tests do not
 * cover.
 *
 * CDATA arrives as its own saxes event; a guide that wraps its titles in
 * `<![CDATA[...]]>` has to round-trip like a plain-text one.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { parseEpgText } from '../../src/tv-guide/epg.ts';

test('a title and a description in CDATA are captured', () => {
  const seen: Array<{ title: string; description: string }> = [];

  parseEpgText(
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<tv>',
      '<channel id="a"><display-name lang="ru">A</display-name></channel>',
      '<programme start="20260614091000 +0300" stop="20260614101000 +0300" channel="a">',
      '<title lang="ru"><![CDATA[х/ф Фильм из CDATA]]></title>',
      '<desc lang="ru"><![CDATA[Описание с & и <тегами> внутри.]]></desc>',
      '</programme>',
      '</tv>',
    ].join('\n'),
    {
      onChannel: () => {},
      onProgramme: (programme) => {
        seen.push({ title: programme.title, description: programme.description });
      },
    },
  );

  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.title, 'х/ф Фильм из CDATA');
  assert.equal(seen[0]?.description, 'Описание с & и <тегами> внутри.');
});

test('text and CDATA mixed in one element are joined', () => {
  const seen: Array<{ title: string; description: string }> = [];

  parseEpgText(
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<tv>',
      '<channel id="a"><display-name lang="ru">A</display-name></channel>',
      '<programme start="20260614091000 +0300" stop="20260614101000 +0300" channel="a">',
      '<title lang="ru">Начало <![CDATA[середина]]> конец</title>',
      '<desc lang="ru">с &amp; сущностью</desc>',
      '</programme>',
      '</tv>',
    ].join('\n'),
    {
      onChannel: () => {},
      onProgramme: (programme) => {
        seen.push({ title: programme.title, description: programme.description });
      },
    },
  );

  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.title, 'Начало середина конец');
  assert.equal(seen[0]?.description, 'с & сущностью');
});

test('the reader stops at the first broken place of the document', () => {
  const seen: string[] = [];

  // The second programme is broken: its title is never closed. The third
  // one is well-formed, but it comes after the break and must not be read.
  assert.throws(
    () =>
      parseEpgText(
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<tv>',
          '<channel id="a"><display-name lang="ru">A</display-name></channel>',
          '<programme start="20260614091000 +0300" stop="20260614101000 +0300" channel="a">',
          '<title lang="ru">Первый</title>',
          '</programme>',
          '<programme start="20260614101000 +0300" stop="20260614111000 +0300" channel="a">',
          '<title lang="ru">Сломанный',
          '</programme>',
          '<programme start="20260614111000 +0300" stop="20260614121000 +0300" channel="a">',
          '<title lang="ru">Третий</title>',
          '</programme>',
          '</tv>',
        ].join('\n'),
        {
          onChannel: () => {},
          onProgramme: (programme) => {
            seen.push(programme.title);
          },
        },
      ),
    /could not be parsed/,
  );

  // The programme before the break was read; the one after it was not.
  assert.deepEqual(seen, ['Первый']);
});
