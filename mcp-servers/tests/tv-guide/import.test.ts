/**
 * The import of the guide.
 *
 * The cases of the design (tv-guide-server.md §10 T1): gzipped and plain
 * fixtures, a programme without a description, a channel without a
 * stream, `tvg-rec="0"`, the retention window, the excluded groups, the
 * deduplication of the texts, a second import, and the rollback when the
 * XML is broken.
 */

import { strict as assert } from 'node:assert';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { fixture } from '../fixtures/load.ts';
import { openDatabase, type Db } from '../../src/shared/db.ts';
import { ensureVectorSchema } from '../../src/shared/vectors.ts';
import { stemText } from '../../src/shared/text.ts';
import { applyTvGuideSchema } from '../../src/tv-guide/schema.ts';
import { importTvGuideFiles, importTvGuideTexts } from '../../src/tv-guide/import.ts';
import { validateEpgHead, headIsGzip } from '../../src/tv-guide/epg.ts';
import { DERIVED_VERSION, embedTextHash } from '../../src/tv-guide/texts.ts';
import type { ImportOptions } from '../../src/tv-guide/import-options.ts';

const EPG = fixture('tv-guide-epg.xml');
const BROKEN = fixture('tv-guide-epg-broken.xml');
const PLAYLIST = fixture('tv-guide-playlist.m3u');
const PLAYLIST_BARE = fixture('tv-guide-playlist-bare.m3u');

/** 2026-06-14 12:00 UTC, in the middle of the guide's window. */
const NOW = Math.floor(Date.parse('2026-06-14T12:00:00Z') / 1000);

const dirs: string[] = [];
let gzipPath = '';

before(() => {
  // The gzip fixture is written at test time: a binary file has no place
  // in the repository.
  const dir = mkdtempSync(join(tmpdir(), 'iptv-tv-guide-'));
  dirs.push(dir);
  gzipPath = join(dir, 'epg.xmltv.gz');
  writeFileSync(gzipPath, gzipSync(Buffer.from(EPG, 'utf8')));
});

after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

interface Harness {
  db: Db;
  cleanup(): void;
}

function database(vectors = false): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'iptv-tv-guide-'));
  dirs.push(dir);
  const db = openDatabase({
    path: join(dir, 'data.sqlite'),
    vectorsPath: vectors ? join(dir, 'vectors.sqlite') : null,
  });
  applyTvGuideSchema(db);
  if (vectors) ensureVectorSchema(db);
  return {
    db,
    cleanup(): void {
      db.close();
    },
  };
}

function options(overrides: Partial<ImportOptions> = {}): ImportOptions {
  return {
    epgUrl: '',
    liveUrl: '',
    excludeGroups: [],
    epgDefaultOffset: '+0000',
    pastDays: 7,
    embeddingModel: 'BAAI/bge-m3',
    minTextChars: 0,
    embeddingsEnabled: true,
    now: NOW,
    ...overrides,
  };
}

/** The counts of the guide, for the assertions. */
function counts(db: Db): { channels: number; programmes: number; texts: number } {
  const channels = db.get<{ found: number }>('SELECT count(*) AS found FROM channels');
  const programmes = db.get<{ found: number }>('SELECT count(*) AS found FROM programmes');
  const texts = db.get<{ found: number }>('SELECT count(*) AS found FROM program_texts');
  return {
    channels: channels?.found ?? 0,
    programmes: programmes?.found ?? 0,
    texts: texts?.found ?? 0,
  };
}

describe('the import of the guide', () => {
  it('imports a plain guide with a playlist', async () => {
    const h = database();
    try {
      const outcome = await importTvGuideTexts(
        h.db,
        { playlistText: PLAYLIST, epgText: EPG },
        options(),
      );

      assert.equal(outcome.ok, true);
      assert.equal(outcome.error, undefined);
      assert.equal(outcome.write?.programmes, 6);
      assert.equal(outcome.write?.channels, 5);
      // The programmes 3 and 4 carry the same (title, description).
      assert.equal(outcome.write?.texts, 5);
      assert.equal(outcome.write?.newTexts, 5);
      assert.equal(outcome.write?.ftsRows, 5);
      assert.deepEqual(counts(h.db), { channels: 5, programmes: 6, texts: 5 });
    } finally {
      h.cleanup();
    }
  });

  it('imports a gzipped guide from a file', async () => {
    const h = database();
    try {
      const outcome = await importTvGuideFiles(
        h.db,
        { playlistPath: join(import.meta.dirname ?? '.', '../fixtures/tv-guide-playlist.m3u'), epgPath: gzipPath },
        options(),
      );

      assert.equal(outcome.ok, true);
      assert.equal(outcome.error, undefined);
      assert.equal(outcome.write?.programmes, 6);
    } finally {
      h.cleanup();
    }
  });

  it('reads the times with their offset and keeps the raw strings', async () => {
    const h = database();
    try {
      await importTvGuideTexts(h.db, { playlistText: PLAYLIST, epgText: EPG }, options());

      const row = h.db.get<{ start_utc: number; stop_utc: number; start_raw: string }>(
        `SELECT p.start_utc, p.stop_utc, p.start_raw FROM programmes p
          JOIN channels c ON c.channel_id = p.channel_id
         WHERE c.name = 'Первый канал' AND p.start_raw LIKE '20260614091000%'`,
      );
      assert.notEqual(row, undefined);
      assert.equal(row?.start_utc, Date.parse('2026-06-14T06:10:00Z') / 1000);
      assert.equal(row?.stop_utc, Date.parse('2026-06-14T07:10:00Z') / 1000);
      assert.equal(row?.start_raw, '20260614091000 +0300');
    } finally {
      h.cleanup();
    }
  });

  it('merges the playlist and the guide channels', async () => {
    const h = database();
    try {
      await importTvGuideTexts(h.db, { playlistText: PLAYLIST, epgText: EPG }, options());

      // The display-name of the guide wins over the playlist name.
      const pervyj = h.db.get<{ name: string; playlist_name: string; stream_url: string }>(
        "SELECT name, playlist_name, stream_url FROM channels WHERE channel_id = 'pervyj'",
      );
      assert.equal(pervyj?.name, 'Первый канал');
      assert.equal(pervyj?.playlist_name, 'Первый канал');
      assert.equal(pervyj?.stream_url, 'http://example.invalid/s/KEY/pervyj.m3u8');

      // The channel of the guide without a playlist entry has no stream.
      const epgOnly = h.db.get<{ name: string; playlist_name: string | null; stream_url: string | null }>(
        "SELECT name, playlist_name, stream_url FROM channels WHERE channel_id = 'kino-epg-only'",
      );
      assert.equal(epgOnly?.name, 'Кино без потока');
      assert.equal(epgOnly?.playlist_name, null);
      assert.equal(epgOnly?.stream_url, null);

      // The group comes from #EXTGRP when group-title is missing, and the
      // catch-up type comes from the header.
      const kino = h.db.get<{ group_title: string; catchup_type: string; archive_days: number }>(
        "SELECT group_title, catchup_type, archive_days FROM channels WHERE channel_id = 'kino-no-group'",
      );
      assert.equal(kino?.group_title, 'Кино');
      assert.equal(kino?.catchup_type, 'shift');
      assert.equal(kino?.archive_days, 0);
    } finally {
      h.cleanup();
    }
  });

  it('stores the adult channels and marks them', async () => {
    const h = database();
    try {
      await importTvGuideTexts(h.db, { playlistText: PLAYLIST, epgText: EPG }, options());

      const adult = h.db.get<{ is_adult: number }>(
        "SELECT is_adult FROM channels WHERE channel_id = 'xxx-adult'",
      );
      assert.equal(adult?.is_adult, 1);

      const regular = h.db.get<{ is_adult: number }>(
        "SELECT is_adult FROM channels WHERE channel_id = 'pervyj'",
      );
      assert.equal(regular?.is_adult, 0);
    } finally {
      h.cleanup();
    }
  });

  it('deduplicates the texts: one row for the same title and description', async () => {
    const h = database();
    try {
      const outcome = await importTvGuideTexts(h.db, { epgText: EPG }, options());

      assert.equal(outcome.write?.programmes, 6);
      assert.equal(outcome.write?.texts, 5);

      const byk = h.db.get<{ found: number }>(
        'SELECT count(*) AS found FROM programmes WHERE text_hash IN (SELECT text_hash FROM program_texts WHERE title LIKE \'%Бык%\')',
      );
      assert.equal(byk?.found, 2);
    } finally {
      h.cleanup();
    }
  });

  it('keeps a programme without a description', async () => {
    const h = database();
    try {
      await importTvGuideTexts(h.db, { epgText: EPG }, options());

      const row = h.db.get<{ description: string | null }>(
        "SELECT description FROM program_texts WHERE title = 'Жить здорово'",
      );
      assert.equal(row?.description, null);
    } finally {
      h.cleanup();
    }
  });

  it('writes the keyword index of the new texts', async () => {
    const h = database();
    try {
      await importTvGuideTexts(h.db, { epgText: EPG }, options());

      // "вести" and "вестям" share the stem.
      const found = h.db.get<{ found: number }>(
        'SELECT count(*) AS found FROM program_texts_fts WHERE program_texts_fts MATCH ?',
        stemText('вести'),
      );
      assert.equal(found?.found, 1);
    } finally {
      h.cleanup();
    }
  });

  it('writes the derived fields of the texts', async () => {
    const h = database();
    try {
      await importTvGuideTexts(h.db, { playlistText: PLAYLIST, epgText: EPG }, options());

      const bull = h.db.get<{
        title: string;
        kind: string;
        kind_source: string;
        year: number | null;
        directors: string | null;
        cast_names: string | null;
        genres: string | null;
        embed_text: string | null;
        embed_hash: string | null;
        derived_version: number;
      }>(
        `SELECT title, kind, kind_source, year, directors, cast_names, genres,
                embed_text, embed_hash, derived_version
           FROM program_texts WHERE title = 'Бык'`,
      );

      assert.ok(bull);
      // The marker came off the title and became the kind.
      assert.equal(bull.title, 'Бык');
      assert.equal(bull.kind, 'film');
      assert.equal(bull.kind_source, 'marker');
      // The facts of the description.
      assert.equal(bull.year, 2019);
      assert.equal(bull.directors, 'Борис Хлебников');
      assert.equal(bull.cast_names, 'Александр Яценко');
      assert.deepEqual(JSON.parse(bull.genres ?? '[]'), ['драма']);
      // The vector is keyed by the hash of the embedding text.
      assert.ok(bull.embed_text);
      assert.equal(bull.embed_hash, embedTextHash(bull.embed_text));
      assert.equal(bull.derived_version, DERIVED_VERSION);

      // The countries of the production.
      const countries = h.db.all<{ raw: string; code: string }>(
        'SELECT raw, code FROM text_countries WHERE text_hash IN (SELECT text_hash FROM program_texts WHERE title = ?)',
        'Бык',
      );
      assert.deepEqual(
        countries.map((country) => ({ raw: country.raw, code: country.code })),
        [{ raw: 'Россия', code: 'RU' }],
      );
    } finally {
      h.cleanup();
    }
  });

  it('writes the derived fields of the channels', async () => {
    const h = database();
    try {
      await importTvGuideTexts(h.db, { playlistText: PLAYLIST, epgText: EPG }, options());

      const channel = h.db.get<{
        theme: string | null;
        region: string | null;
        quality: number;
        family_key: string;
        timeshift_h: number;
      }>(
        `SELECT theme, region, quality, family_key, timeshift_h
           FROM channels WHERE channel_id = 'pervyj-hd'`,
      );

      assert.ok(channel);
      // The group "Кино" of the playlist.
      assert.equal(channel.theme, 'film');
      assert.equal(channel.region, 'RU');
      // The quality comes from the name of the channel.
      assert.equal(channel.quality, 2);
      assert.equal(channel.family_key, 'первый');
      assert.equal(channel.timeshift_h, 0);
    } finally {
      h.cleanup();
    }
  });

  it('puts the people of a text into the keyword index', async () => {
    const h = database();
    try {
      await importTvGuideTexts(h.db, { epgText: EPG }, options());

      // The director of the film is in the index.
      const found = h.db.get<{ found: number }>(
        'SELECT count(*) AS found FROM program_texts_fts WHERE program_texts_fts MATCH ?',
        stemText('Хлебников'),
      );
      assert.equal(found?.found, 1);
    } finally {
      h.cleanup();
    }
  });

  it('keys the queue of the embeddings on the hash of the embedding text', async () => {
    const h = database(true);
    try {
      await importTvGuideTexts(h.db, { epgText: EPG }, options());

      const queued = h.db.all<{ embed_hash: string }>('SELECT embed_hash FROM vector_queue');
      assert.ok(queued.length > 0);

      const hashes = h.db.all<{ embed_hash: string }>(
        'SELECT embed_hash FROM program_texts WHERE embed_hash IS NOT NULL',
      );
      const known = new Set(hashes.map((row) => row.embed_hash));
      for (const row of queued) {
        assert.ok(known.has(row.embed_hash), row.embed_hash);
      }
    } finally {
      h.cleanup();
    }
  });

  it('rewrites the derived fields when the version of the derivation changes', async () => {
    const h = database();
    try {
      await importTvGuideTexts(h.db, { epgText: EPG }, options());

      // The row of a text of phase T1: the neutral values and the old
      // version of the derivation.
      h.db.run(
        'UPDATE program_texts SET kind = ?, kind_source = ?, derived_version = 0',
        'other',
        'none',
      );

      const second = await importTvGuideTexts(h.db, { epgText: EPG }, options());
      assert.equal(second.ok, true);
      // The text is not new, but its facts are written again.
      assert.equal(second.write?.newTexts, 0);
      assert.equal(second.write?.derivedTexts, 5);

      const bull = h.db.get<{ kind: string }>(
        'SELECT kind FROM program_texts WHERE title = ?',
        'Бык',
      );
      assert.equal(bull?.kind, 'film');
    } finally {
      h.cleanup();
    }
  });

  it('writes the text again when the kind changed with the channels', async () => {
    const h = database();
    try {
      // The programme has no marker; the kind comes from the theme of its
      // channel (the group "Кино") and from the film ending.
      const withFilm = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<tv>',
        '<channel id="pervyj-hd"><display-name lang="ru">Первый HD</display-name></channel>',
        '<programme start="20260614120000 +0300" stop="20260614134000 +0300" channel="pervyj-hd">',
        '<title lang="ru">Уроки рисования</title>',
        '<desc lang="ru">Реж.: Ким Райт. Россия, 2015, драма</desc>',
        '</programme>',
        '</tv>',
      ].join('\n');

      const first = await importTvGuideTexts(
        h.db,
        { playlistText: PLAYLIST, epgText: withFilm },
        options(),
      );
      assert.equal(first.ok, true);
      const before = h.db.get<{ kind: string; kind_source: string }>(
        'SELECT kind, kind_source FROM program_texts LIMIT 1',
      );
      // The theme of the channel of the programme wins over the ending.
      assert.equal(before?.kind, 'film');
      assert.equal(before?.kind_source, 'channel');

      // The same programme, now on a general channel: the theme says
      // nothing, and the kind comes from the film ending.
      const withGeneral = withFilm.replace('channel="pervyj-hd"', 'channel="pervyj"');
      const second = await importTvGuideTexts(
        h.db,
        { playlistText: PLAYLIST, epgText: withGeneral },
        options(),
      );
      assert.equal(second.ok, true);
      // The text is not new, but its kind changed.
      assert.equal(second.write?.newTexts, 0);
      assert.equal(second.write?.derivedTexts, 1);

      const after = h.db.get<{ kind: string; kind_source: string }>(
        'SELECT kind, kind_source FROM program_texts LIMIT 1',
      );
      assert.equal(after?.kind, 'film');
      assert.equal(after?.kind_source, 'ending');
    } finally {
      h.cleanup();
    }
  });

  it('keeps the queue of a text whose embedding text did not change', async () => {
    const h = database(true);
    try {
      // The programme has no marker; the kind comes from the theme of its
      // channel and from the film ending.
      const withFilm = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<tv>',
        '<channel id="pervyj-hd"><display-name lang="ru">Первый HD</display-name></channel>',
        '<programme start="20260614120000 +0300" stop="20260614134000 +0300" channel="pervyj-hd">',
        '<title lang="ru">Уроки рисования</title>',
        '<desc lang="ru">Реж.: Ким Райт. Россия, 2015, драма</desc>',
        '</programme>',
        '</tv>',
      ].join('\n');

      await importTvGuideTexts(
        h.db,
        { playlistText: PLAYLIST, epgText: withFilm },
        options(),
      );
      const before = h.db.all<{ embed_hash: string }>('SELECT embed_hash FROM vector_queue');
      assert.ok(before.length > 0);

      // The same programme, now on a general channel: the kind is the
      // same, the source of it is not.
      const withGeneral = withFilm.replace('channel="pervyj-hd"', 'channel="pervyj"');
      const second = await importTvGuideTexts(
        h.db,
        { playlistText: PLAYLIST, epgText: withGeneral },
        options(),
      );
      assert.equal(second.ok, true);

      // The embedding text did not change, so the vector of it did not
      // change either: the queue holds the same rows.
      const after = h.db.all<{ embed_hash: string }>('SELECT embed_hash FROM vector_queue');
      assert.deepEqual(
        after.map((row) => row.embed_hash).sort(),
        before.map((row) => row.embed_hash).sort(),
      );
    } finally {
      h.cleanup();
    }
  });

  it('takes the overrides of the groups from the settings', async () => {
    const h = database();
    try {
      const outcome = await importTvGuideTexts(
        h.db,
        { playlistText: PLAYLIST, epgText: EPG },
        options({ groupMap: { Кино: { theme: 'sport', region: 'DE' } } }),
      );

      assert.equal(outcome.ok, true);
      const channel = h.db.get<{ theme: string | null; region: string | null }>(
        `SELECT theme, region FROM channels WHERE channel_id = 'pervyj-hd'`,
      );
      // The group "Кино" of the playlist, with the overrides of the
      // settings.
      assert.equal(channel?.theme, 'sport');
      assert.equal(channel?.region, 'DE');
    } finally {
      h.cleanup();
    }
  });

  it('a second import of the same guide writes no new texts', async () => {
    const h = database();
    try {
      const first = await importTvGuideTexts(h.db, { playlistText: PLAYLIST, epgText: EPG }, options());
      assert.equal(first.write?.newTexts, 5);

      const second = await importTvGuideTexts(h.db, { playlistText: PLAYLIST, epgText: EPG }, options());
      assert.equal(second.ok, true);
      assert.equal(second.error, undefined);
      assert.equal(second.write?.newTexts, 0);
      assert.equal(second.write?.ftsRows, 0);
      assert.equal(second.write?.removedTexts, 0);
      assert.deepEqual(counts(h.db), { channels: 5, programmes: 6, texts: 5 });
    } finally {
      h.cleanup();
    }
  });

  it('a smaller second guide removes the texts that left', async () => {
    const h = database();
    try {
      await importTvGuideTexts(h.db, { epgText: EPG }, options());

      const smaller = EPG.replace(
        /<programme start="20260615120000[\s\S]*?<\/programme>\n/,
        '',
      );
      const outcome = await importTvGuideTexts(h.db, { epgText: smaller }, options());

      assert.equal(outcome.ok, true);
      assert.equal(outcome.error, undefined);
      assert.equal(outcome.write?.removedTexts, 1);
      assert.deepEqual(counts(h.db), { channels: 3, programmes: 5, texts: 4 });

      // The keyword-index row of the removed text is gone as well.
      const fts = h.db.get<{ found: number }>(
        'SELECT count(*) AS found FROM program_texts_fts WHERE program_texts_fts MATCH ?',
        stemText('трансляция'),
      );
      assert.equal(fts?.found, 0);
    } finally {
      h.cleanup();
    }
  });

  it('a broken guide fails the import and leaves the old data', async () => {
    const h = database();
    try {
      await importTvGuideTexts(h.db, { playlistText: PLAYLIST, epgText: EPG }, options());
      const before = counts(h.db);

      const outcome = await importTvGuideTexts(h.db, { playlistText: PLAYLIST, epgText: BROKEN }, options());

      assert.equal(outcome.ok, false);
      assert.match(outcome.error ?? '', /could not be read/);
      assert.deepEqual(counts(h.db), before);
    } finally {
      h.cleanup();
    }
  });

  it('drops the programmes of the excluded groups', async () => {
    const h = database();
    try {
      const outcome = await importTvGuideTexts(
        h.db,
        { playlistText: PLAYLIST, epgText: EPG },
        options({ excludeGroups: ['Кино', 'XXX (18+)'] }),
      );

      assert.equal(outcome.ok, true);
      assert.equal(outcome.error, undefined);
      // pervyj-hd (Кино) and kino-no-group (Кино) and xxx-adult are gone;
      // pervyj, pervyj-epg-only… wait: pervyj (Общероссийские) and
      // kino-epg-only (no group) stay.
      assert.equal(outcome.write?.droppedGroupChannels, 3);
      assert.equal(outcome.write?.droppedGroupProgrammes, 1);
      // The film programmes share their text with the guide-only channel.
      assert.deepEqual(counts(h.db), { channels: 2, programmes: 5, texts: 5 });
    } finally {
      h.cleanup();
    }
  });

  it('applies the retention window to the ended programmes', async () => {
    const h = database();
    try {
      // 2026-06-21: only the programme of 2026-06-15 is in the window of
      // seven days.
      const outcome = await importTvGuideTexts(
        h.db,
        { epgText: EPG },
        options({ now: Math.floor(Date.parse('2026-06-21T12:00:00Z') / 1000) }),
      );

      assert.equal(outcome.ok, true);
      assert.equal(outcome.error, undefined);
      assert.equal(outcome.write?.droppedOld, 5);
      assert.equal(outcome.write?.programmes, 1);
    } finally {
      h.cleanup();
    }
  });

  it('counts the programmes that repeat a (channel, start) pair', async () => {
    const h = database();
    try {
      const twice = EPG.replace(
        '</tv>',
        [
          '<programme start="20260614091000 +0300" stop="20260614101000 +0300" channel="pervyj">',
          '<title lang="ru">Вести (повтор)</title>',
          '</programme>',
          '</tv>',
        ].join('\n'),
      );
      const outcome = await importTvGuideTexts(h.db, { epgText: twice }, options());

      assert.equal(outcome.ok, true);
      assert.equal(outcome.error, undefined);
      assert.equal(outcome.write?.duplicates, 1);
      assert.equal(outcome.write?.programmes, 6);
    } finally {
      h.cleanup();
    }
  });

  it('counts the programmes whose times cannot be read', async () => {
    const h = database();
    try {
      const bad = EPG.replace(
        '</tv>',
        [
          '<programme start="20261314091000 +0300" stop="20260614101000 +0300" channel="pervyj">',
          '<title lang="ru">Сломанное время</title>',
          '</programme>',
          '</tv>',
        ].join('\n'),
      );
      const outcome = await importTvGuideTexts(h.db, { epgText: bad }, options());

      assert.equal(outcome.ok, true);
      assert.equal(outcome.error, undefined);
      assert.equal(outcome.write?.badTimes, 1);
      assert.equal(outcome.write?.programmes, 6);
    } finally {
      h.cleanup();
    }
  });

  it('applies the default offset to times without one and counts them', async () => {
    const h = database();
    try {
      const withoutOffset = EPG.replace(/20260614091000 \+0300/g, '20260614091000');
      const outcome = await importTvGuideTexts(
        h.db,
        { epgText: withoutOffset },
        options({ epgDefaultOffset: '+0300' }),
      );

      assert.equal(outcome.ok, true);
      assert.equal(outcome.error, undefined);
      assert.equal(outcome.write?.defaultOffsetTimes, 1);

      // The converted time is the one the offset says.
      const row = h.db.get<{ start_utc: number }>(
        "SELECT start_utc FROM programmes WHERE start_raw = '20260614091000'",
      );
      assert.equal(row?.start_utc, Date.parse('2026-06-14T06:10:00Z') / 1000);
    } finally {
      h.cleanup();
    }
  });

  it('queues the long texts and leaves the short ones out', async () => {
    const h = database();
    try {
      const outcome = await importTvGuideTexts(
        h.db,
        { epgText: EPG },
        options({ minTextChars: 40 }),
      );

      assert.equal(outcome.ok, true);
      assert.equal(outcome.error, undefined);
      // "Жить здорово" has no description; its text is the title only.
      assert.equal(outcome.write?.queueSize, 4);
    } finally {
      h.cleanup();
    }
  });

  it('leaves an empty embedding text out of the queue', async () => {
    const h = database(true);
    try {
      // A programme with an empty title and an empty description: there is
      // nothing to embed, even when the minimum length is zero.
      const empty = EPG.replace(
        '<title lang="ru">Жить здорово</title>',
        '<title lang="ru"></title>',
      );
      const outcome = await importTvGuideTexts(
        h.db,
        { epgText: empty },
        options({ minTextChars: 0 }),
      );

      assert.equal(outcome.ok, true);

      // The text without anything to say.
      const text = h.db.get<{ text_hash: string; embed_text: string | null; embed_hash: string | null }>(
        `SELECT text_hash, embed_text, embed_hash
           FROM program_texts WHERE description IS NULL`,
      );
      assert.ok(text);
      assert.equal(text.embed_text, '');

      // It is not in the queue: its vector would be the vector of every
      // other text without anything.
      const queued = h.db.get<{ found: number }>(
        'SELECT count(*) AS found FROM vector_queue WHERE embed_hash = ?',
        text.embed_hash ?? '',
      );
      assert.equal(queued?.found, 0);
    } finally {
      h.cleanup();
    }
  });

  it('a playlist without a guide writes the channels only', async () => {
    const h = database();
    try {
      const outcome = await importTvGuideFiles(h.db, {
        playlistPath: join(import.meta.dirname ?? '.', '../fixtures/tv-guide-playlist.m3u'),
      }, options());

      assert.equal(outcome.ok, true);
      assert.equal(outcome.error, undefined);
      assert.deepEqual(counts(h.db), { channels: 4, programmes: 0, texts: 0 });
    } finally {
      h.cleanup();
    }
  });

  it('refuses a playlist that does not start with #EXTM3U', async () => {
    const h = database();
    try {
      const outcome = await importTvGuideTexts(
        h.db,
        { playlistText: '<?xml version="1.0"?>', epgText: EPG },
        options(),
      );
      assert.equal(outcome.ok, false);
      assert.match(outcome.error ?? '', /#EXTM3U/);
    } finally {
      h.cleanup();
    }
  });

  it('joins the guide ids with the playlist ids when the XML carries whitespace', async () => {
    const h = database();
    try {
      const padded = EPG
        .replace('<channel id="pervyj">', '<channel id=" pervyj ">')
        .replace('channel="pervyj"', 'channel=" pervyj "');
      const outcome = await importTvGuideTexts(
        h.db,
        { playlistText: PLAYLIST, epgText: padded },
        options(),
      );

      assert.equal(outcome.ok, true);
      assert.equal(outcome.error, undefined);
      assert.equal(outcome.write?.unknownChannel, 0);
      assert.equal(outcome.write?.programmes, 6);
    } finally {
      h.cleanup();
    }
  });

  it('a corrupt gzip file fails the import without touching the old data', async () => {
    const h = database();
    try {
      await importTvGuideTexts(h.db, { epgText: EPG }, options());
      const before = counts(h.db);

      // The gzip magic passes the download check; the inflate fails.
      writeFileSync(join(dirs[0] ?? '.', 'corrupt.gz'), Buffer.from([0x1f, 0x8b, 0xde, 0xad, 0xbe, 0xef]));
      const outcome = await importTvGuideFiles(h.db, { epgPath: join(dirs[0] ?? '.', 'corrupt.gz') }, options());

      assert.equal(outcome.ok, false);
      assert.match(outcome.error ?? '', /could not be read/);
      assert.deepEqual(counts(h.db), before);
    } finally {
      h.cleanup();
    }
  });

  it('leaves the queue empty when the embeddings are switched off', async () => {
    const h = database(true);
    try {
      const outcome = await importTvGuideTexts(
        h.db,
        { epgText: EPG },
        options({ minTextChars: 0, embeddingsEnabled: false }),
      );

      assert.equal(outcome.ok, true);
      assert.equal(outcome.error, undefined);
      assert.equal(outcome.write?.queueSize, 0);

      const rows = h.db.get<{ found: number }>('SELECT count(*) AS found FROM vector_queue');
      assert.equal(rows?.found, 0);
    } finally {
      h.cleanup();
    }
  });

  it('accepts a guide that lists its programmes before its channels', async () => {
    const h = database();
    try {
      // XMLTV wants the channels first; a generator that interleaves them
      // must still import, because the writer reads the whole guide
      // before it writes.
      const head = EPG.indexOf('<programme');
      const channels = EPG.slice(EPG.indexOf('<channel'), head);
      const programmes = EPG.slice(head, EPG.lastIndexOf('</tv>'));
      const interleaved = `<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n${programmes}${channels}</tv>\n`;

      const outcome = await importTvGuideTexts(h.db, { epgText: interleaved }, options());

      assert.equal(outcome.ok, true);
      assert.equal(outcome.error, undefined);
      assert.equal(outcome.write?.unknownChannel, 0);
      assert.equal(outcome.write?.programmes, 6);
    } finally {
      h.cleanup();
    }
  });

  it('the EPG content check accepts gzip magic and plain XML, and refuses the rest', () => {
    const gz = gzipSync(Buffer.from(EPG, 'utf8'));
    assert.equal(headIsGzip(gz.subarray(0, 64)), true);
    assert.equal(validateEpgHead('', gz.subarray(0, 64)), null);

    assert.equal(validateEpgHead(EPG, Buffer.from(EPG, 'utf8').subarray(0, 64)), null);
    assert.equal(validateEpgHead('\uFEFF<tv>', Buffer.from('<tv>')), null);
    assert.equal(validateEpgHead('<?xml version="1.0"?><tv>', Buffer.from('<?xml')), null);

    assert.notEqual(validateEpgHead('<html><body>login</body></html>', Buffer.from('<html>')), null);
    assert.notEqual(validateEpgHead('', Buffer.alloc(0)), null);
  });
});
