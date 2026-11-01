/**
 * meaning-tools.test.ts - the search with the meaning, through the tools.
 *
 * The tools are called through the SDK's in-memory transport, the way a
 * client calls them. The tests cover the contract of the meaning
 * (design: iptv-mcp-servers.md §7.1, the decisions of C4 that T4 shares):
 *
 * - `search_mode` is "words" without vectors and "words+meaning" with
 *   them;
 * - the meaning leads when no word matches;
 * - another order falls back to the words;
 * - `get_status` reports the meaning from the vectors in the database,
 *   not from the last run.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TextEmbedder } from '../../src/shared/embeddings.ts';
import { guideHarness, structured, textOf, NOW } from './harness.ts';
import { MEANING_KIND_LABELS } from '../../src/tv-guide/meaning.ts';
import { statusReport } from '../../src/tv-guide/status.ts';
import { searchPrograms } from '../../src/tv-guide/search.ts';
import { fromBlob } from '../../src/shared/vectors.ts';
import {
  readTvGuideSettings,
  TV_GUIDE_SETTINGS_SPEC,
} from '../../src/tv-guide/config.ts';
import { SettingsStore } from '../../src/shared/settings.ts';

function settingsOf(h: { settingsPath: string }) {
  return readTvGuideSettings(new SettingsStore(h.settingsPath, TV_GUIDE_SETTINGS_SPEC).settings());
}

/** The settings of a server with the embeddings on. */
function meaningSettings(): Record<string, unknown> {
  return {
    epgUrl: 'http://example.invalid/xml/guide.gz',
    liveUrl: 'http://example.invalid/playlist.m3u',
    search: { defaultLimit: 20, maxLimit: 50, snippetChars: 200, meaningWeight: 0.7 },
    embeddings: {
      enabled: true,
      // The fake embedder of the harness answers for this model.
      model: 'fake/model',
      apiKeyEnv: 'OPENROUTER_API_KEY',
      batchSize: 50,
      minTextChars: 0,
      groups: 'all',
    },
  };
}

/** A client of the service that is not available (the key is missing). */
function unavailableEmbedder(): TextEmbedder {
  return {
    model: 'fake/model',
    available: false,
    lastError: null,
    embed: async () => null,
    embedMany: async () => null,
  };
}

/** The items of a search answer. */
function items(result: Record<string, unknown>): Record<string, unknown>[] {
  return (result['items'] as Record<string, unknown>[]) ?? [];
}

describe('search_programs with the meaning', () => {
  it('runs on the words alone while the vectors are not built', async () => {
    const h = await guideHarness({ settings: meaningSettings() });
    try {
      const result = structured(await h.call('search_programs', { query: 'драма о быке' }));
      assert.equal(result['search_mode'], 'words');
      assert.ok((result['total'] as number) > 0);
    } finally {
      await h.cleanup();
    }
  });

  it('mixes the words and the meaning when the vectors are there', async () => {
    const h = await guideHarness({ settings: meaningSettings() });
    try {
      // The worker of the harness embeds the texts of the import.
      assert.equal(h.worker.start(), 'started');
      await h.waitForEmbedding();

      const result = structured(await h.call('search_programs', { query: 'драма о быке' }));
      assert.equal(result['search_mode'], 'words+meaning');

      const list = items(result);
      assert.ok(list.length > 0);
      assert.ok((result['total'] as number) >= list.length);
      // The score of a blended item is between 0 and 1.
      for (const item of list) {
        const score = item['score'] as number;
        assert.ok(score >= 0 && score <= 1, `score ${score} out of range`);
      }
    } finally {
      await h.cleanup();
    }
  });

  it('answers by the meaning alone when no word matches', async () => {
    const h = await guideHarness({ settings: meaningSettings() });
    try {
      assert.equal(h.worker.start(), 'started');
      await h.waitForEmbedding();

      // "ффф" matches no word of the guide; the meaning answers.
      const result = structured(await h.call('search_programs', { query: 'ффф' }));
      assert.equal(result['search_mode'], 'words+meaning');
      assert.ok((result['total'] as number) > 0);
    } finally {
      await h.cleanup();
    }
  });

  it('falls back to the words on another order', async () => {
    const h = await guideHarness({ settings: meaningSettings() });
    try {
      assert.equal(h.worker.start(), 'started');
      await h.waitForEmbedding();

      const result = structured(
        await h.call('search_programs', { query: 'драма о быке', sort: 'time' }),
      );
      assert.equal(result['search_mode'], 'words');
    } finally {
      await h.cleanup();
    }
  });

  it('falls back to the words when the key of the service is missing', async () => {
    const h = await guideHarness({
      settings: meaningSettings(),
      embedder: unavailableEmbedder(),
    });
    try {
      // The worker of the harness cannot run without the key: the search
      // falls back to the words.
      assert.equal(h.worker.start(), 'disabled');
      await h.waitForEmbedding();

      const result = structured(await h.call('search_programs', { query: 'драма о быке' }));
      assert.equal(result['search_mode'], 'words');
    } finally {
      await h.cleanup();
    }
  });

  it('keeps the moment and the model across the pages', async () => {
    const h = await guideHarness({ settings: meaningSettings() });
    try {
      assert.equal(h.worker.start(), 'started');
      await h.waitForEmbedding();

      const first = structured(
        await h.call('search_programs', { query: 'выпуск города', limit: 1 }),
      );
      assert.equal(first['search_mode'], 'words+meaning');
      const cursor = first['next_cursor'] as string | null;
      assert.ok(cursor, 'the search has more than one page');

      const second = structured(
        await h.call('search_programs', { query: 'выпуск города', limit: 1, cursor }),
      );
      assert.equal(second['search_mode'], 'words+meaning');
      const firstId = (items(first)[0] as Record<string, unknown>)?.['program_id'];
      const secondId = (items(second)[0] as Record<string, unknown>)?.['program_id'];
      assert.notEqual(firstId, secondId);
    } finally {
      await h.cleanup();
    }
  });

  it('collapses the repeats over the union, not per source', async () => {
    const h = await guideHarness({ settings: meaningSettings() });
    try {
      assert.equal(h.worker.start(), 'started');
      await h.waitForEmbedding();

      // The query matches only the farther airing of «Вести» by its words
      // («гостем» is in the description of both, «позавчерашнего» only in
      // «Вчера в городе» — a different title). The collapse of
      // `hide_repeats` must run over the union of the two sources: a
      // collapse over the words side alone would keep its own airing, the
      // vector side another one, and the answer would hold two copies of
      // one title on one channel family.
      const result = structured(
        await h.call('search_programs', { query: 'Вести гость студия', hide_repeats: true }),
      );
      assert.equal(result['search_mode'], 'words+meaning');
      // «Вести» airs twice on Первый канал (11:00 and 12:00, one channel
      // family) and once on the film channel — a different family, a
      // legal copy. One family, one airing.
      const onFirst = items(result).filter(
        (item) => item['title'] === 'Вести' &&
          (item['channel'] as Record<string, unknown>)['id'] === 'pervyj',
      );
      assert.equal(onFirst.length, 1, JSON.stringify(items(result).map((i) => i['program_id'])));
    } finally {
      await h.cleanup();
    }
  });

  it('blends both scores of a programme that both sides found', async () => {
    const h = await guideHarness({ settings: meaningSettings() });
    try {
      assert.equal(h.worker.start(), 'started');
      await h.waitForEmbedding();

      // The meaning of the query is the vector of the text itself: the
      // distance of the surviving airing is 0, the meaning side of the
      // blend is 1. With the weight 0.7 the score must be strictly above
      // 0.7 — if the merge lost the meaning (or the words), the score
      // would sit at or under 0.7 (the bug the second review of T4
      // caught: the collapse used to keep one arbitrary score).
      const row = h.db.get<{ embedding: Uint8Array }>(
        `SELECT v.embedding AS embedding
           FROM program_texts t
           JOIN vec.vectors v ON v.text_hash = t.embed_hash
          WHERE t.title = 'Вести'`,
      );
      assert.ok(row, 'the fixture text has a vector');
      const vector = fromBlob(row.embedding);
      const outcome = searchPrograms(
        h.db,
        {
          query: 'Вести гость',
          keywords: [],
          person: '',
          kinds: [],
          window: { field: 'start', from: null, to: null, onAir: false, onAirFrom: null },
          themes: [],
          regions: [],
          channelIds: [],
          productionCountries: { codes: [], raws: [] },
          yearFrom: null,
          yearTo: null,
          onlyCatchup: false,
          hideRepeats: true,
          preferHd: true,
          sort: 'relevance',
        },
        {
          now: NOW,
          timezone: 'Europe/Moscow',
          snippetChars: 200,
          includeAdult: false,
          meaning: { vector, model: 'fake/model' },
          meaningWeight: 0.7,
        },
        20,
        0,
      );
      assert.equal(outcome.mode, 'words+meaning');
      const vesti = outcome.items.find(
        (item) => item.title === 'Вести' && item.channel.id === 'pervyj',
      );
      assert.ok(vesti, 'Вести is in the answer');
      assert.ok(
        vesti.score > 0.7,
        `the blend must carry both scores, got ${vesti.score}`,
      );
    } finally {
      await h.cleanup();
    }
  });

  it('collapses the quality copies of one moment by prefer_hd', async () => {
    const h = await guideHarness({ settings: meaningSettings() });
    try {
      assert.equal(h.worker.start(), 'started');
      await h.waitForEmbedding();

      // «х/ф Бык» airs at the same moment on Первый канал and on Первый
      // канал HD — one channel family, one moment. The collapse of
      // prefer_hd keeps the best quality; the channel names compare
      // case-insensitively, the way the words-only path compares them in
      // SQL (the review of T4). The 15:00 airing on Первый канал +2 is a
      // different moment and stays.
      const result = structured(
        await h.call('search_programs', {
          query: 'драма о быке',
          hide_repeats: false,
          prefer_hd: true,
        }),
      );
      assert.equal(result['search_mode'], 'words+meaning');
      const ids = items(result).map((item) => item['program_id']);
      assert.ok(ids.includes('pervyj-hd@1781431200'), 'the HD copy stays');
      assert.ok(!ids.includes('pervyj@1781431200'), 'the SD copy of the same moment leaves');
    } finally {
      await h.cleanup();
    }
  });

  it('says in the text what the search ran on', async () => {
    const h = await guideHarness({ settings: meaningSettings() });
    try {
      assert.equal(h.worker.start(), 'started');
      await h.waitForEmbedding();

      const text = textOf(await h.call('search_programs', { query: 'драма о быке' }));
      assert.ok(text.split('\n')[0]?.includes('word and meaning search'), text);
    } finally {
      await h.cleanup();
    }
  });
});

describe('get_status with the vectors', () => {
  it('reports the meaning from the vectors in the database', async () => {
    const h = await guideHarness({ settings: meaningSettings() });
    try {
      const before = structured(await h.call('get_status'));
      let vectors = before['vectors'] as Record<string, unknown>;
      assert.equal(vectors['meaning'], false);
      assert.equal(before['search_mode'], 'words');

      assert.equal(h.worker.start(), 'started');
      await h.waitForEmbedding();

      const after = structured(await h.call('get_status'));
      vectors = after['vectors'] as Record<string, unknown>;
      assert.equal(vectors['meaning'], true);
      assert.equal(after['search_mode'], 'words+meaning');

      const embedding = after['embedding'] as Record<string, unknown>;
      assert.equal(embedding['running'], false);
      assert.equal(embedding['phase'], 'done');
      assert.equal(embedding['done'], (vectors['done'] as number));
      assert.equal(embedding['pending'], 0);
      assert.equal(embedding['enabled'], true);
      assert.equal(embedding['available'], true);
    } finally {
      await h.cleanup();
    }
  });

  it('reports the meaning from the database after a restart of the server', async () => {
    const h = await guideHarness({ settings: meaningSettings() });
    try {
      assert.equal(h.worker.start(), 'started');
      await h.waitForEmbedding();

      // The vectors are in the database; a restarted server has a worker
      // that has embedded nothing yet. The report is built with the state
      // of such a worker (done 0): the meaning must still be there — the
      // vectors are counted in the database, not in the run (the bug the
      // cinema smoke test found, C4).
      const settings = settingsOf(h);
      const restarted = statusReport(h.db, {
        settingsPath: h.settingsPath,
        epgUrl: settings.epgUrl,
        liveUrl: settings.liveUrl,
        epgUrlSource: 'settings',
        timezone: settings.timezone,
        model: settings.embeddings.model,
        progress: { running: false, phase: 'done', startedAt: null, elapsedMs: 0 },
        lastError: null,
        embedding: {
          running: false,
          phase: 'done',
          done: 0,
          pending: 0,
          last_error: null,
          started_at_ms: null,
          elapsed_ms: 0,
          model: settings.embeddings.model,
          enabled: true,
          available: true,
          key_present: true,
        },
      });
      assert.ok(restarted.vectors.done > 0);
      assert.equal(restarted.vectors.meaning, true);
      assert.equal(restarted.search_mode, 'words+meaning');
      assert.equal(restarted.embedding.done, 0);

      // And the tool of the running server says the same.
      const after = structured(await h.call('get_status'));
      const vectors = after['vectors'] as Record<string, unknown>;
      assert.ok((vectors['done'] as number) > 0);
      assert.equal(vectors['meaning'], true);
      assert.equal(after['search_mode'], 'words+meaning');
    } finally {
      await h.cleanup();
    }
  });

  it('reports a run that could not embed', async () => {
    const h = await guideHarness({
      settings: meaningSettings(),
      embedder: unavailableEmbedder(),
    });
    try {
      // The worker cannot run: the queue stays, the vectors do not come.
      assert.equal(h.worker.start(), 'disabled');
      await h.waitForEmbedding();

      const after = structured(await h.call('get_status'));
      const vectors = after['vectors'] as Record<string, unknown>;
      assert.equal(vectors['meaning'], false);
      assert.equal(after['search_mode'], 'words');
      const embedding = after['embedding'] as Record<string, unknown>;
      assert.equal(embedding['available'], false);
      assert.ok((vectors['pending'] as number) > 0);
    } finally {
      await h.cleanup();
    }
  });
});

describe('the labels and the kinds of the fixture', () => {
  it('the fixture texts take their kinds from the vectors where they may', async () => {
    const h = await guideHarness({ settings: meaningSettings() });
    try {
      assert.equal(h.worker.start(), 'started');
      await h.waitForEmbedding();

      // The texts the provider named are never rewritten; the rest carry
      // the kind of their meaning. The deterministic fake embedder of the
      // harness gives every text its own vector, so only the kinds are
      // asserted here, not which kind.
      const rows = h.db
        .all<{ title: string; kind_source: string }>(
          'SELECT title, kind_source FROM program_texts',
        )
        .map((row) => ({ ...row }));
      const sources = new Map(rows.map((row) => [row.title, row.kind_source]));
      assert.equal(sources.get('Бык'), 'marker');
      assert.equal(sources.get('Утренний сеанс'), 'marker');
      assert.equal(sources.get('Футбол. ЧМ-2026. Нидерланды – Швеция. Трансляция из США'), 'pattern');
      for (const source of sources.values()) {
        assert.ok(
          ['marker', 'pattern', 'channel', 'ending', 'meaning', 'none'].includes(source),
          `unknown source ${source}`,
        );
      }
      // The labels are not the texts of the guide: they ride in the cache
      // of the query vectors.
      const labelCount = h.db.get<{ found: number }>(
        'SELECT count(*) AS found FROM vec.query_vectors',
      )?.found;
      const expected = Object.values(MEANING_KIND_LABELS).reduce(
        (sum, list) => sum + list.length,
        0,
      );
      assert.ok((labelCount ?? 0) >= expected);
      assert.equal(typeof NOW, 'number');
    } finally {
      await h.cleanup();
    }
  });
});
