import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  hasM3uHeader,
  lastCommaOutsideQuotes,
  parseAttributeString,
  parseExtInfLine,
  parseM3uText,
  stripBom,
} from '../../src/shared/m3u.ts';

describe('stripBom', () => {
  it('removes a byte order mark', () => {
    assert.equal(stripBom('\uFEFF#EXTM3U'), '#EXTM3U');
    assert.equal(stripBom('#EXTM3U'), '#EXTM3U');
  });
});

describe('hasM3uHeader', () => {
  it('accepts the header with and without attributes', () => {
    assert.equal(hasM3uHeader('#EXTM3U\n'), true);
    assert.equal(hasM3uHeader('#EXTM3U url-tvg="http://example.invalid/a"\n'), true);
    assert.equal(hasM3uHeader('\uFEFF#EXTM3U\n'), true);
  });

  it('rejects a file without the header', () => {
    assert.equal(hasM3uHeader('#EXTINF:1, x\n'), false);
    assert.equal(hasM3uHeader(''), false);
  });
});

describe('parseAttributeString', () => {
  it('reads every key="value" pair', () => {
    const attributes = parseAttributeString('genres="Комедия,Драма" rating="7" year="2024"');
    assert.equal(attributes['genres'], 'Комедия,Драма');
    assert.equal(attributes['rating'], '7');
    assert.equal(attributes['year'], '2024');
  });

  it('reads an empty value', () => {
    assert.equal(parseAttributeString('rating=""')['rating'], '');
  });
});

describe('lastCommaOutsideQuotes', () => {
  it('ignores a comma inside a quoted value', () => {
    const content = 'genres="Комедия ,Детектив", Название';
    assert.equal(lastCommaOutsideQuotes(content), content.indexOf(', Название'));
  });

  it('returns -1 when there is no comma', () => {
    assert.equal(lastCommaOutsideQuotes('no comma here'), -1);
  });
});

describe('parseExtInfLine', () => {
  it('reads the number, the attributes and the title', () => {
    const parsed = parseExtInfLine(
      '#EXTINF:5760 genres="Боевик" rating="7" year="2024" group-title="Ultra HD", Кали (4K HDR)',
    );
    assert.equal(parsed.number, 5760);
    assert.equal(parsed.attributes['genres'], 'Боевик');
    assert.equal(parsed.attributes['rating'], '7');
    assert.equal(parsed.attributes['group-title'], 'Ultra HD');
    assert.equal(parsed.title, 'Кали (4K HDR)');
  });

  it('reads a negative number', () => {
    assert.equal(parseExtInfLine('#EXTINF:-1, Бабье царство S01E01').number, -1);
  });

  it('keeps a comma inside an attribute value out of the title', () => {
    const parsed = parseExtInfLine(
      '#EXTINF:-1 genres="Комедия ,Детектив" country="Canada, United States of America", Название',
    );
    assert.equal(parsed.title, 'Название');
    assert.equal(parsed.attributes['country'], 'Canada, United States of America');
  });
});

describe('parseM3uText', () => {
  const text = [
    '#EXTM3U url-tvg="http://example.invalid/epg.xml"',
    '#EXTINF:100 a="1", First',
    '#EXTIMG:http://example.invalid/a.jpg',
    '#EXTDESC:Description of the first entry',
    '#EXTGRP:Group one',
    'http://example.invalid/1.m3u8',
    '#EXTINF:200, Second',
    'http://example.invalid/2.m3u8',
    '#EXTINF:300, Third',
  ].join('\n');

  it('reads the header attributes', () => {
    const document = parseM3uText(text);
    assert.equal(document.hasHeader, true);
    assert.equal(document.header['url-tvg'], 'http://example.invalid/epg.xml');
  });

  it('reads every entry', () => {
    const document = parseM3uText(text);
    assert.equal(document.entries.length, 2);
    assert.equal(document.entries[0]?.title, 'First');
    assert.equal(document.entries[1]?.title, 'Second');
  });

  it('reads the poster, the description and the group', () => {
    const document = parseM3uText(text);
    const first = document.entries[0];
    assert.equal(first?.poster, 'http://example.invalid/a.jpg');
    assert.equal(first?.description, 'Description of the first entry');
    assert.equal(first?.group, 'Group one');
  });

  it('counts a block without a stream line', () => {
    const document = parseM3uText(text);
    assert.equal(document.incomplete, 1);
  });

  it('counts a block that is followed by another #EXTINF', () => {
    const document = parseM3uText('#EXTINF:1, First\n#EXTINF:2, Second\nhttp://example.invalid/2.m3u8');
    assert.equal(document.incomplete, 1);
    assert.equal(document.entries.length, 1);
    assert.equal(document.entries[0]?.title, 'Second');
  });

  it('ignores comments and other # lines', () => {
    const document = parseM3uText('#EXTINF:1, x\n#EXTVLCOPT:http-user-agent=Mozilla\nhttp://example.invalid/a');
    assert.equal(document.entries.length, 1);
  });
});
