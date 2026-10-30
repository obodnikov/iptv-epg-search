/**
 * The live-channel playlist.
 *
 * The cases of the design (tv-guide-server.md §10 T1): header and channel
 * attributes, the `#EXTGRP` fallback, `tvg-rec="0"`, a playlist with a
 * bare header, an entry without a stream line, an entry without a
 * `tvg-id`, a duplicated `tvg-id`.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { fixture } from '../fixtures/load.ts';
import {
  catchupTypeFromHeader,
  epgUrlsFromHeader,
  parseM3uHeader,
  parsePlaylist,
  validatePlaylistText,
} from '../../src/tv-guide/playlist.ts';

test('the header attributes are read', () => {
  const playlist = parsePlaylist(fixture('tv-guide-playlist.m3u'));

  assert.equal(playlist.header['url-tvg'], 'http://example.invalid/xml/guide.gz');
  assert.equal(playlist.header['x-tvg-url'], 'http://example.invalid/xml/guide.gz');
  assert.equal(playlist.header['catchup-type'], 'shift');
});

test('the channels carry their playlist fields', () => {
  const playlist = parsePlaylist(fixture('tv-guide-playlist.m3u'));
  assert.equal(playlist.channels.length, 4);

  const pervyj = playlist.channels.find((channel) => channel.tvgId === 'pervyj');
  assert.ok(pervyj !== undefined);
  assert.equal(pervyj.name, 'Первый канал');
  assert.equal(pervyj.group, 'Общероссийские');
  assert.equal(pervyj.tvgRec, 7);
  assert.equal(pervyj.logo, 'http://example.invalid/streams/pervyj.png');
  assert.equal(pervyj.streamUrl, 'http://example.invalid/s/KEY/pervyj.m3u8');
  assert.equal(pervyj.catchupType, '');
});

test('the #EXTGRP line gives the group when group-title is missing', () => {
  const playlist = parsePlaylist(fixture('tv-guide-playlist.m3u'));
  const kino = playlist.channels.find((channel) => channel.tvgId === 'kino-no-group');

  assert.ok(kino !== undefined);
  assert.equal(kino.group, 'Кино');
  assert.equal(kino.tvgRec, 0);
});

test('an entry without a tvg-id is skipped and counted', () => {
  const playlist = parsePlaylist(fixture('tv-guide-playlist.m3u'));
  assert.equal(playlist.skippedNoTvgId, 1);
  assert.equal(playlist.channels.some((channel) => channel.name === 'Без идентификатора'), false);
});

test('a duplicated tvg-id is skipped; the first channel wins', () => {
  const playlist = parsePlaylist(fixture('tv-guide-playlist.m3u'));
  assert.equal(playlist.duplicates, 1);

  const pervyj = playlist.channels.find((channel) => channel.tvgId === 'pervyj');
  assert.ok(pervyj !== undefined);
  assert.equal(pervyj.streamUrl, 'http://example.invalid/s/KEY/pervyj.m3u8');
});

test('a block without a stream line is counted as incomplete', () => {
  const playlist = parsePlaylist(
    [
      '#EXTM3U',
      '#EXTINF:0 group-title="Спорт" tvg-id="sport" tvg-rec="7",Спорт',
      '#EXTINF:0 group-title="Спорт" tvg-id="sport2" tvg-rec="7",Спорт 2',
      'http://example.invalid/s/KEY/sport2.m3u8',
    ].join('\n'),
  );

  assert.equal(playlist.incomplete, 1);
  assert.equal(playlist.channels.length, 1);
  const sport2 = playlist.channels[0];
  assert.ok(sport2 !== undefined);
  assert.equal(sport2.tvgId, 'sport2');
});

test('a playlist with a bare header parses without attributes', () => {
  const playlist = parsePlaylist(fixture('tv-guide-playlist-bare.m3u'));

  assert.deepEqual(playlist.header, {});
  assert.equal(playlist.channels.length, 1);
  const sport = playlist.channels[0];
  assert.ok(sport !== undefined);
  assert.equal(sport.group, 'Спорт');
  assert.equal(sport.streamUrl, 'http://example.invalid/s/KEY/sport.ts');
});

test('the content check refuses a file that is not a playlist', () => {
  // A bare header is a valid playlist (the MPEG-TS variant).
  assert.equal(validatePlaylistText('#EXTM3U'), null);
  assert.equal(validatePlaylistText('#EXTM3U url-tvg="http://example.invalid/x.gz"'), null);
  assert.equal(validatePlaylistText('\uFEFF#EXTM3U\n#EXTINF:0 tvg-id="a",A'), null);
  assert.notEqual(validatePlaylistText('<?xml version="1.0"?>'), null);
  assert.notEqual(validatePlaylistText(''), null);
});

test('the EPG URL candidates come from the header, url-tvg first', () => {
  const urls = epgUrlsFromHeader({
    'url-tvg': 'http://example.invalid/one.gz',
    'x-tvg-url': 'http://example.invalid/two.gz',
  });
  assert.deepEqual(urls, ['http://example.invalid/one.gz', 'http://example.invalid/two.gz']);
});

test('an EPG URL header without http is not a candidate', () => {
  assert.deepEqual(epgUrlsFromHeader({ 'url-tvg': 'ftp://example.invalid/x.gz' }), []);
});

test('the catch-up type of the header is read', () => {
  assert.equal(
    catchupTypeFromHeader(parseM3uHeader(fixture('tv-guide-playlist.m3u'))),
    'shift',
  );
  assert.equal(catchupTypeFromHeader(parseM3uHeader(fixture('tv-guide-playlist-bare.m3u'))), '');
});

test('a BOM before the header is allowed', () => {
  const playlist = parsePlaylist('\uFEFF#EXTM3U\n#EXTINF:0 tvg-id="a",A\nhttp://example.invalid/a.m3u8');
  assert.equal(playlist.channels.length, 1);
  const channel = playlist.channels[0];
  assert.ok(channel !== undefined);
  assert.equal(channel.tvgId, 'a');
});
