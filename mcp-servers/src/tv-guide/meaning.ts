/**
 * meaning.ts - the kind of a text, out of the meaning of it.
 *
 * The fourth source of the kind (design: tv-guide-server.md §4.3 step 4):
 * the vector of the embedding text is compared with the vectors of a small
 * set of label texts, one or two per kind ("художественный фильм",
 * "спортивная трансляция"). The nearest label within the threshold gives
 * the text its kind.
 *
 * The source has the strength 3, like the pattern and above the theme of
 * the channel: the order is written down once, in `kind.ts`, and the
 * owner confirmed in T4 that the meaning beats the channel theme. The
 * pass therefore touches only the texts whose stored source is weaker
 * than `meaning` — the ones of the channel, the ending and no source at
 * all. A text that the provider named itself ("х/ф") or that the pattern
 * named ("Футбол. …") is never rewritten.
 *
 * The pass runs in the background worker (`embedder.ts`): after every
 * batch of fresh vectors, and once per run over the texts that already
 * have a vector but whose source was reset — the import writes its own
 * derivation, and the meaning is a layer above it that re-applies. The
 * vectors stay in the database, so the re-application costs no new calls
 * to the service.
 *
 * The label vectors are made by the same client and the same model as the
 * texts, and are kept in the cache of the query vectors: the labels are
 * query-side texts, and the number of the vectors of a model stays the
 * number of the texts of the guide (design: iptv-mcp-servers.md §6.2).
 */

import { type Db } from '../shared/db.ts';
import { type TextEmbedder } from '../shared/embeddings.ts';
import { fromBlob } from '../shared/vectors.ts';
import { type Kind, type KindSource, KINDS } from './kind.ts';

/**
 * The label texts of the kinds.
 *
 * The labels describe the text of a programme, not the channel it airs
 * on. They are written in Russian, the language of the provider's data.
 * The short words beat the long phrases in the measurement of T4: the
 * embedding texts of the guide are long (title, description, facts), and
 * a short label sits nearer to them than a description of the kind.
 * The measurement is recorded in the design document (§10 T4).
 */
export const MEANING_KIND_LABELS: Readonly<Record<Exclude<Kind, 'other'>, readonly string[]>> = {
  film: ['фильм', 'кино'],
  series: ['сериал'],
  animation: ['мультфильм'],
  animated_series: ['мультсериал'],
  documentary: ['документальный фильм'],
  docuseries: ['документальный сериал'],
  sport: ['спорт', 'матч'],
  news: ['новости', 'выпуск новостей'],
  kids: ['детская передача'],
  music: ['музыка'],
  show: ['шоу'],
};

/**
 * The largest cosine distance that still counts as a match.
 *
 * Cosine distance runs from 0 (the same direction) to 2 (the opposite).
 * The measurement of T4 (the June 2026 snapshot, the 11,442 marker texts
 * as the ground truth): the distance to the label of the own kind sits at
 * 0.50 in the median — the short texts of the guide and the labels of the
 * kinds are not near neighbours in the space of the model, and no
 * threshold separates them well. At 0.35 the pass is right on about 91 %
 * of the texts it touches and covers about 1 % of them; the pass is
 * therefore a small, safe addition on the top of the other sources, not a
 * classifier of the guide. The table of the thresholds and the decision
 * are in the design document (§10 T4).
 */
export const MEANING_KIND_MAX_DISTANCE = 0.35;

/**
 * The sources the meaning may overwrite.
 *
 * Every source here is weaker than `meaning` in `kind.ts`, and every
 * source that is weaker is here (the test checks both directions).
 */
export const MEANING_KIND_SOURCES: readonly KindSource[] = [
  'channel',
  'ending',
  'none',
];

/** The sources of the SQL above, as the query binds them. */
const SOURCES_SQL = MEANING_KIND_SOURCES.map(() => '?').join(', ');

/**
 * The cosine distance of two vectors of the same length.
 *
 * This is the value `vec_distance_cosine` computes: 1 − cosine
 * similarity. Two vectors of nothing are nothing alike.
 */
export function cosineDistance(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 2;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 2;
  return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * One label: the kind it names and the vector of its text.
 */
export interface KindLabel {
  kind: Kind;
  /** The text the vector was made of. */
  text: string;
  vector: Float32Array;
}

/**
 * The vectors of the label texts.
 *
 * The labels are embedded with the client of the service and kept in the
 * cache of the query vectors, so that a restart does not ask for them
 * again. The labels that are not in the cache are asked for in **one**
 * call, the way a batch of texts is. The function answers null when the
 * service does not answer: the pass then does not run, and the next run
 * tries again.
 */
export async function labelVectors(
  client: TextEmbedder,
  cached: (text: string) => Float32Array | null,
  keep: (text: string, vector: Float32Array) => void,
): Promise<KindLabel[] | null> {
  const texts: string[] = [];
  for (const kind of KINDS) {
    if (kind === 'other') continue;
    texts.push(...MEANING_KIND_LABELS[kind]);
  }

  const vectors = new Map<string, Float32Array>();
  const missing: string[] = [];
  for (const text of texts) {
    const vector = cached(text);
    if (vector) vectors.set(text, vector);
    else missing.push(text);
  }

  if (missing.length > 0) {
    const made = await client.embedMany(missing);
    if (!made || made.length !== missing.length) return null;
    for (let i = 0; i < missing.length; i += 1) {
      const text = missing[i] as string;
      const vector = made[i] as Float32Array;
      vectors.set(text, vector);
      keep(text, vector);
    }
  }

  const labels: KindLabel[] = [];
  for (const text of texts) {
    const vector = vectors.get(text);
    if (!vector) return null;
    labels.push({ kind: kindOfLabel(text), text, vector });
  }
  return labels;
}

/**
 * The kind a label text belongs to.
 */
function kindOfLabel(text: string): Kind {
  for (const kind of KINDS) {
    if (kind === 'other') continue;
    if ((MEANING_KIND_LABELS[kind] as readonly string[]).includes(text)) return kind;
  }
  return 'other';
}

/**
 * The nearest label of a vector, within the threshold.
 */
export function nearestLabel(
  vector: Float32Array,
  labels: readonly KindLabel[],
): { kind: Kind; distance: number } | null {
  let best: { kind: Kind; distance: number } | null = null;
  for (const label of labels) {
    const distance = cosineDistance(vector, label.vector);
    if (distance > MEANING_KIND_MAX_DISTANCE) continue;
    if (best === null || distance < best.distance) {
      best = { kind: label.kind, distance };
    }
  }
  return best;
}

/**
 * Give the texts their meaning kind.
 *
 * A text is keyed by the hash of its embedding text: several texts of the
 * guide can share one embedding text, and all of them take the kind. The
 * SQL guards the source: only the texts whose stored source is weaker
 * than `meaning` are rewritten, so the pass is idempotent and never
 * touches the words of the provider.
 *
 * @returns The number of the texts that were rewritten.
 */
export function applyMeaningKinds(
  db: Db,
  entries: readonly { embedHash: string; vector: Float32Array }[],
  labels: readonly KindLabel[],
): number {
  if (labels.length === 0) return 0;

  let changed = 0;
  for (const entry of entries) {
    const near = nearestLabel(entry.vector, labels);
    if (!near) continue;

    changed += db.run(
      `UPDATE program_texts SET kind = ?, kind_source = 'meaning'
        WHERE embed_hash = ? AND kind_source IN (${SOURCES_SQL})`,
      near.kind,
      entry.embedHash,
      ...MEANING_KIND_SOURCES,
    ).changes;
  }

  return changed;
}

/**
 * How many texts a pass of the catch-up reads at once.
 *
 * The vectors are read out of the database in portions: the whole set of
 * the guide is hundreds of megabytes, and the process must not hold it.
 * The portion walks by `text_hash`, so that rewriting a text cannot make
 * the walk skip one.
 */
const CATCH_UP_BATCH = 1_000;

/**
 * Apply the meaning kind to the texts that already have a vector.
 *
 * This is the pass that runs once per worker run: the import has written
 * its own derivation, and the texts whose source is weaker than
 * `meaning` take the kind of their vector again. The vectors are already
 * in the database, so the pass asks the service for nothing.
 *
 * @returns The number of the texts that were rewritten.
 */
export function applyMeaningKindsCatchUp(
  db: Db,
  model: string,
  labels: readonly KindLabel[],
): number {
  if (labels.length === 0) return 0;
  if (!db.hasVectors) return 0;

  let changed = 0;
  let cursor = '';

  for (;;) {
    const rows = db.all<{
      text_hash: string;
      embed_hash: string;
      embedding: Uint8Array;
    }>(
      `SELECT t.text_hash AS text_hash, t.embed_hash AS embed_hash,
              v.embedding AS embedding
         FROM program_texts t
         JOIN vec.vectors v ON v.text_hash = t.embed_hash AND v.model = ?
        WHERE t.text_hash > ? AND t.kind_source IN (${SOURCES_SQL})
          AND EXISTS (SELECT 1 FROM programmes p WHERE p.text_hash = t.text_hash)
        ORDER BY t.text_hash LIMIT ?`,
      model,
      cursor,
      ...MEANING_KIND_SOURCES,
      CATCH_UP_BATCH,
    );
    if (rows.length === 0) break;

    const entries = rows.map((row) => {
      cursor = row.text_hash;
      return {
        embedHash: row.embed_hash,
        vector: fromBlob(row.embedding),
      };
    });

    changed += applyMeaningKinds(db, entries, labels);
  }

  return changed;
}
