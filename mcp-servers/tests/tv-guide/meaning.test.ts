/**
 * meaning.test.ts - the kind of a text out of the meaning of it.
 *
 * The fourth source of the kind (tv-guide-server.md §4.3 step 4): the
 * vector of the embedding text is compared with the vectors of the label
 * texts, and the nearest label within the threshold gives the kind. The
 * source has the strength 3: it beats the theme of the channel, and it
 * never touches a kind the provider named itself.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { putVectors, ensureVectorSchema } from '../../src/shared/vectors.ts';
import { applyTvGuideSchema } from '../../src/tv-guide/schema.ts';
import {
  applyMeaningKinds,
  applyMeaningKindsCatchUp,
  cosineDistance,
  MEANING_KIND_LABELS,
  MEANING_KIND_MAX_DISTANCE,
  MEANING_KIND_SOURCES,
  nearestLabel,
  type KindLabel,
} from '../../src/tv-guide/meaning.ts';
import { KINDS, KIND_MARKERS, SOURCE_STRENGTH, type Kind } from '../../src/tv-guide/kind.ts';
import { testDatabase, type TestDatabase } from '../helpers.ts';

/** A unit vector along the i-th axis of 4 dimensions. */
function basis(i: number): Float32Array {
  const vector = new Float32Array(4);
  vector[i] = 1;
  return vector;
}

/** A unit vector that leans towards the first axis. */
function leaning(towardsFirst: number): Float32Array {
  const vector = new Float32Array([towardsFirst, 1 - towardsFirst, 0, 0]);
  const norm = Math.hypot(...vector);
  for (let i = 0; i < vector.length; i += 1) vector[i] = (vector[i] as number) / norm;
  return vector;
}

/** The labels of the tests: film on the first axis, sport on the second. */
function labels(): KindLabel[] {
  return [
    { kind: 'film', text: 'художественный фильм', vector: basis(0) },
    { kind: 'sport', text: 'спортивная трансляция', vector: basis(1) },
  ];
}

describe('cosineDistance', () => {
  it('is 0 for the same direction', () => {
    assert.equal(cosineDistance(basis(0), basis(0)), 0);
  });

  it('is 1 for directions at right angles', () => {
    assert.ok(Math.abs(cosineDistance(basis(0), basis(1)) - 1) < 1e-6);
  });

  it('is 2 for opposite directions', () => {
    assert.ok(Math.abs(cosineDistance(basis(0), new Float32Array([-1, 0, 0, 0])) - 2) < 1e-6);
  });

  it('gives up on a vector of nothing and on different lengths', () => {
    assert.equal(cosineDistance(new Float32Array(4), basis(0)), 2);
    assert.equal(cosineDistance(new Float32Array(2), basis(0)), 2);
  });
});

describe('MEANING_KIND_SOURCES', () => {
  it('holds exactly the sources that are weaker than the meaning', () => {
    for (const source of MEANING_KIND_SOURCES) {
      assert.ok(
        SOURCE_STRENGTH.meaning > SOURCE_STRENGTH[source],
        `${source} must be weaker than meaning`,
      );
    }
    for (const source of Object.keys(SOURCE_STRENGTH) as (keyof typeof SOURCE_STRENGTH)[]) {
      const weaker = SOURCE_STRENGTH[source] < SOURCE_STRENGTH.meaning;
      assert.equal(
        MEANING_KIND_SOURCES.includes(source),
        weaker,
        `${source} is in the wrong place`,
      );
    }
  });
});

describe('MEANING_KIND_LABELS', () => {
  it('names every kind but "other"', () => {
    for (const kind of KINDS) {
      if (kind === 'other') continue;
      const list: readonly string[] = MEANING_KIND_LABELS[kind];
      assert.ok(list.length > 0, `${kind} has no label`);
    }
    assert.equal('other' in MEANING_KIND_LABELS, false);
  });
});

describe('nearestLabel', () => {
  it('takes the nearest label within the threshold', () => {
    const near = nearestLabel(leaning(0.9), labels());
    assert.equal(near?.kind, 'film');
    assert.ok((near?.distance ?? 1) < MEANING_KIND_MAX_DISTANCE);
  });

  it('answers nothing above the threshold', () => {
    // The sport axis is at the distance 1 from the film label.
    assert.equal(nearestLabel(basis(2), labels()), null);
    assert.equal(nearestLabel(basis(1), [{ ...labels()[0] } as KindLabel]), null);
  });
});

/**
 * A database with one channel, texts and programmes.
 */
function withTexts(
  texts: { hash: string; title: string; source: string; embedHash?: string }[],
): TestDatabase {
  const test = testDatabase(true);
  applyTvGuideSchema(test.db);
  ensureVectorSchema(test.db);

  test.db.run(
    `INSERT INTO channels (channel_id, name, family_key) VALUES ('ch1', 'Канал', 'канал')`,
  );

  let start = 1000;
  for (const text of texts) {
    test.db.run(
      `INSERT INTO program_texts (text_hash, title, title_norm, kind, kind_source, embed_text, embed_hash)
       VALUES (?, ?, ?, 'other', ?, ?, ?)`,
      text.hash,
      text.title,
      text.title.toLowerCase(),
      text.source,
      text.title,
      text.embedHash ?? text.hash,
    );
    test.db.run(
      `INSERT INTO programmes (channel_id, start_utc, stop_utc, start_raw, stop_raw, text_hash)
       VALUES ('ch1', ?, ?, '20260614120000 +0300', '20260614130000 +0300', ?)`,
      start,
      start + 500,
      text.hash,
    );
    start += 1000;
  }

  return test;
}

describe('applyMeaningKinds', () => {
  it('gives a text of a weak source the kind of its nearest label', () => {
    const test = withTexts([
      { hash: 't1', title: 'Просто передача', source: 'none' },
    ]);
    try {
      putVectors(test.db, [
        { textHash: 't1', model: 'm', embedding: leaning(0.9), createdAt: 1 },
      ]);

      const changed = applyMeaningKinds(
        test.db,
        [{ embedHash: 't1', vector: leaning(0.9) }],
        labels(),
      );

      assert.equal(changed, 1);
      const row = test.db.get<{ kind: string; kind_source: string }>(
        'SELECT kind, kind_source FROM program_texts WHERE text_hash = ?',
        't1',
      );
      assert.equal(row?.kind, 'film');
      assert.equal(row?.kind_source, 'meaning');
    } finally {
      test.cleanup();
    }
  });

  it('overrides the theme of the channel and never the words of the provider', () => {
    const test = withTexts([
      { hash: 'channel', title: 'Текст канала', source: 'channel' },
      { hash: 'ending', title: 'Текст конца', source: 'ending' },
      { hash: 'marker', title: 'х/ф Названный', source: 'marker' },
      { hash: 'pattern', title: 'Футбол. Игра', source: 'pattern' },
      { hash: 'meaning', title: 'Уже названный', source: 'meaning' },
    ]);
    try {
      const vector = leaning(0.9);
      for (const hash of ['channel', 'ending', 'marker', 'pattern', 'meaning']) {
        putVectors(test.db, [{ textHash: hash, model: 'm', embedding: vector, createdAt: 1 }]);
      }

      applyMeaningKinds(
        test.db,
        ['channel', 'ending', 'marker', 'pattern', 'meaning'].map((hash) => ({
          embedHash: hash,
          vector,
        })),
        labels(),
      );

      const sources = test.db.all<{ text_hash: string; kind_source: string }>(
        'SELECT text_hash, kind_source FROM program_texts',
      );
      const byHash = new Map(sources.map((row) => [row.text_hash, row.kind_source]));

      // Weaker than meaning: rewritten.
      assert.equal(byHash.get('channel'), 'meaning');
      assert.equal(byHash.get('ending'), 'meaning');
      // As strong or stronger: the words of the provider win.
      assert.equal(byHash.get('marker'), 'marker');
      assert.equal(byHash.get('pattern'), 'pattern');
      assert.equal(byHash.get('meaning'), 'meaning');
    } finally {
      test.cleanup();
    }
  });

  it('leaves a text alone when no label is near enough', () => {
    const test = withTexts([
      { hash: 'far', title: 'Далёкий текст', source: 'none' },
    ]);
    try {
      putVectors(test.db, [
        { textHash: 'far', model: 'm', embedding: basis(3), createdAt: 1 },
      ]);

      const changed = applyMeaningKinds(
        test.db,
        [{ embedHash: 'far', vector: basis(3) }],
        labels(),
      );

      assert.equal(changed, 0);
      const row = test.db.get<{ kind: string }>(
        'SELECT kind FROM program_texts WHERE text_hash = ?',
        'far',
      );
      assert.equal(row?.kind, 'other');
    } finally {
      test.cleanup();
    }
  });

  it('gives every text that shares the embedding text the kind', () => {
    const test = withTexts([
      { hash: 'a', title: 'Первый текст', source: 'none', embedHash: 'shared' },
      { hash: 'b', title: 'Второй текст', source: 'channel', embedHash: 'shared' },
    ]);
    try {
      putVectors(test.db, [
        { textHash: 'shared', model: 'm', embedding: leaning(0.9), createdAt: 1 },
      ]);

      const changed = applyMeaningKinds(
        test.db,
        [{ embedHash: 'shared', vector: leaning(0.9) }],
        labels(),
      );

      assert.equal(changed, 2);
      const rows = test.db.all<{ kind_source: string }>(
        'SELECT kind_source FROM program_texts',
      );
      assert.deepEqual(
        rows.map((row) => row.kind_source).sort(),
        ['meaning', 'meaning'],
      );
    } finally {
      test.cleanup();
    }
  });
});

describe('applyMeaningKindsCatchUp', () => {
  it('applies the kind to the texts that have a vector already', () => {
    const test = withTexts([
      { hash: 'a', title: 'Текст раз', source: 'channel' },
      { hash: 'b', title: 'Текст два', source: 'marker' },
      { hash: 'c', title: 'Текст три', source: 'none' },
    ]);
    try {
      for (const hash of ['a', 'b', 'c']) {
        putVectors(test.db, [
          { textHash: hash, model: 'm', embedding: leaning(0.9), createdAt: 1 },
        ]);
      }

      const changed = applyMeaningKindsCatchUp(test.db, 'm', labels());

      // The marker text is never rewritten; the two weak ones are.
      assert.equal(changed, 2);
      const sources = test.db
        .all<{ text_hash: string; kind_source: string }>(
          'SELECT text_hash, kind_source FROM program_texts ORDER BY text_hash',
        )
        .map((row) => ({ ...row }));
      assert.deepEqual(sources, [
        { text_hash: 'a', kind_source: 'meaning' },
        { text_hash: 'b', kind_source: 'marker' },
        { text_hash: 'c', kind_source: 'meaning' },
      ]);

      // A second pass has nothing to do: the meaning does not rewrite
      // itself.
      assert.equal(applyMeaningKindsCatchUp(test.db, 'm', labels()), 0);
    } finally {
      test.cleanup();
    }
  });

  it('ignores the vectors of another model', () => {
    const test = withTexts([
      { hash: 'a', title: 'Текст раз', source: 'none' },
    ]);
    try {
      putVectors(test.db, [
        { textHash: 'a', model: 'other', embedding: leaning(0.9), createdAt: 1 },
      ]);

      assert.equal(applyMeaningKindsCatchUp(test.db, 'm', labels()), 0);
    } finally {
      test.cleanup();
    }
  });
});

describe('the marker table and the labels agree with the kinds', () => {
  it('every marker names a kind that has labels', () => {
    for (const kind of Object.values(KIND_MARKERS)) {
      const labels: readonly string[] | undefined =
        MEANING_KIND_LABELS[kind as Exclude<Kind, 'other'>];
      assert.ok(labels, `${kind} has no label`);
    }
  });
});
