/**
 * store.ts - the write path of the cinema catalogue.
 *
 * Everything happens in one transaction (design: cinema-server.md §4 step 7).
 * A reader keeps seeing the old catalogue until the transaction is
 * committed, and a failed import leaves the old catalogue untouched.
 *
 * The steps of a write:
 * 1. the ids are resolved (identity.ts): a title that is already in the
 *    database keeps its id;
 * 2. the title row is written, the first time it was seen is kept;
 * 3. the variants, the episodes, the genres and the countries are written
 *    again when the title changed;
 * 4. the row of the keyword index is written again when the text changed;
 * 5. the titles that did not come back are marked as removed, or deleted
 *    when the changes are not tracked;
 * 6. the texts that have to be embedded are put into the queue.
 */

import { type Db, withTransaction } from '../shared/db.ts';
import { stemText } from '../shared/text.ts';
import {
  findById,
  rekeyTitle,
  resolveTitleId,
  type TitleIdCollision,
} from './identity.ts';
import { contentHash as hashOfParts } from './keys.ts';
import {
  pruneVectorQueue,
  queueMissingVectors,
  queueText,
  reconcileVectorQueue,
} from './queue.ts';

export interface PreparedVariant {
  quality: string;
  streamUrl: string;
  durationMin: number | null;
  category: string;
}

export interface PreparedEpisode {
  season: number;
  episode: number;
  name: string;
  streamUrl: string;
  durationMin: number | null;
}

export interface PreparedCountry {
  raw: string;
  code: string | null;
}

/** A title that is ready to be written. */
export interface PreparedTitle {
  type: 'film' | 'series';
  title: string;
  titleNorm: string;
  year: number | null;
  rating: number | null;
  category: string;
  director: string;
  description: string;
  posterUrl: string;
  durationMin: number | null;
  addedAt: number | null;
  addedRaw: string;
  isAdult: boolean;
  isNewTag: boolean;
  genres: string[];
  countries: PreparedCountry[];
  seasonCount: number | null;
  episodeCount: number | null;
  variants: PreparedVariant[];
  episodes: PreparedEpisode[];
  /** The key the title is looked up by. */
  lookupKey: string;
  /** The seed of the id: `type | title_norm | year`. */
  seed: string;
  /** The text that is embedded (§5). */
  embedText: string;
  /** The hash of the embedding text. */
  textHash: string;
  /** The hash over the whole row set of the title. */
  contentHash: string;
}

export interface WriteOptions {
  /** The moment of the import, in epoch seconds. */
  now: number;
  /** Keep `first_seen_at` and `removed_at`. */
  trackChanges: boolean;
  /** The model the vectors are made for. */
  embeddingModel: string;
  /** Texts shorter than this are only searched by words. */
  minTextChars: number;
}

export interface WriteResult {
  /** The titles of the import. */
  titles: number;
  /** Titles that were not in the database before. */
  inserted: number;
  /** Titles that changed. */
  updated: number;
  /** Titles that did not change at all. */
  unchanged: number;
  /** Titles that got a `removed_at`. */
  removed: number;
  /** Titles that were deleted, because the changes are not tracked. */
  deleted: number;
  /** The rows of the variants that were written. */
  variants: number;
  /** The rows of the episodes that were written. */
  episodes: number;
  /** The rows of the keyword index that were written. */
  ftsRows: number;
  /** The number of texts in the queue when the import was over. */
  queueSize: number;
  /** The queue rows that were removed. */
  queuePruned: number;
  /** The pairs of titles that wanted the same id. */
  collisions: TitleIdCollision[];
}

/**
 * The hash over the whole row set of a title.
 *
 * It covers everything that is written for the title, so that a change of
 * any of it is noticed.
 */
export function computeContentHash(title: PreparedTitle): string {
  const parts: string[] = [
    title.type,
    title.title,
    title.titleNorm,
    title.year === null ? '' : String(title.year),
    title.rating === null ? '' : String(title.rating),
    title.category,
    title.director,
    title.description,
    title.posterUrl,
    title.durationMin === null ? '' : String(title.durationMin),
    title.addedAt === null ? '' : String(title.addedAt),
    title.isAdult ? '1' : '0',
    title.isNewTag ? '1' : '0',
    title.seasonCount === null ? '' : String(title.seasonCount),
    title.episodeCount === null ? '' : String(title.episodeCount),
    title.embedText,
  ];

  for (const genre of title.genres) parts.push(`genre:${genre}`);
  for (const country of title.countries) parts.push(`country:${country.raw}=${country.code ?? ''}`);
  for (const variant of title.variants) {
    parts.push(
      `variant:${variant.quality}|${variant.streamUrl}|${variant.durationMin ?? ''}|${variant.category}`,
    );
  }
  for (const episode of title.episodes) {
    parts.push(
      `episode:${episode.season}-${episode.episode}|${episode.name}|${episode.streamUrl}|${episode.durationMin ?? ''}`,
    );
  }

  return hashOfParts(parts);
}

/**
 * Write a catalogue into the database.
 */
export function writeCatalog(
  db: Db,
  titles: PreparedTitle[],
  options: WriteOptions,
): WriteResult {
  const result: WriteResult = {
    titles: titles.length,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    removed: 0,
    deleted: 0,
    variants: 0,
    episodes: 0,
    ftsRows: 0,
    queueSize: 0,
    queuePruned: 0,
    collisions: [],
  };

  withTransaction(db, () => {
    db.run('DELETE FROM import_staging');

    for (const title of titles) {
      writeTitle(db, title, options, result);
    }

    // The titles that did not come back from the provider.
    removeMissingTitles(db, options, result);

    // The queue rows of texts that are not in the catalogue any more.
    result.queuePruned = pruneVectorQueue(db);

    // The queue holds the texts the active model has not embedded yet.
    queueMissingVectors(db, options);
    result.queuePruned += reconcileVectorQueue(db, options.embeddingModel);

    // The number that is reported is the number of rows in the queue: the
    // rows that were added may have been taken away again by the
    // reconciliation with the vectors.
    result.queueSize =
      db.get<{ found: number }>('SELECT count(*) AS found FROM vector_queue')?.found ?? 0;
  });

  return result;
}

/**
 * Write one title and the rows that belong to it.
 */
function writeTitle(
  db: Db,
  title: PreparedTitle,
  options: WriteOptions,
  result: WriteResult,
): void {
  const resolution = resolveTitleId(
    db,
    {
      type: title.type,
      titleNorm: title.titleNorm,
      year: title.year,
      director: title.director,
      category: title.category,
      lookupKey: title.lookupKey,
      seed: title.seed,
    },
    title.genres,
  );

  if (resolution.collision) {
    // The title that was already in the database gets another id, so that
    // neither of the two holds the id they both wanted.
    const holder = findById(db, resolution.collision.baseId);
    if (holder) {
      rekeyTitle(db, holder.title_id, resolution.collision.existingTitleId);
    }
    result.collisions.push(resolution.collision);
  }

  const titleId = resolution.titleId;
  const existing = resolution.existing;

  db.run('INSERT OR IGNORE INTO import_staging (title_id) VALUES (?)', titleId);

  const contentChanged = existing ? existing.content_hash !== title.contentHash : true;
  const textChanged = existing ? existing.text_hash !== title.textHash : true;

  const rowid = upsertTitle(db, title, titleId, options);

  if (!existing) result.inserted += 1;
  else if (contentChanged) result.updated += 1;
  else result.unchanged += 1;

  if (contentChanged) {
    writeChildRows(db, title, titleId, result);
  }

  if (textChanged) {
    writeFtsRow(db, title, titleId, rowid);
    result.ftsRows += 1;
  }

  if (textChanged || !existing) {
    queueText(db, title, options);
    return;
  }

  // A title that comes back into the catalogue has to be embedded again
  // when its vector is not there: the queue row of a title that left was
  // removed with it.
  if (existing.removed_at !== null) {
    queueText(db, title, options);
  }
}

/**
 * Write the row of the title itself.
 *
 * @returns the rowid of the title, which is the rowid of its row in the
 * keyword index.
 */
function upsertTitle(
  db: Db,
  title: PreparedTitle,
  titleId: string,
  options: WriteOptions,
): number {
  const row = db.get<{ rowid: number }>(
    `INSERT INTO titles (
        title_id, type, title, title_norm, year, rating, category, director,
        description, poster_url, duration_min, added_at, is_adult, is_new_tag,
        season_count, episode_count, text_hash, first_seen_at, last_seen_at,
        removed_at, lookup_key, content_hash, added_raw, embed_text
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
     ON CONFLICT(title_id) DO UPDATE SET
        type = excluded.type,
        title = excluded.title,
        title_norm = excluded.title_norm,
        year = excluded.year,
        rating = excluded.rating,
        category = excluded.category,
        director = excluded.director,
        description = excluded.description,
        poster_url = excluded.poster_url,
        duration_min = excluded.duration_min,
        added_at = excluded.added_at,
        is_adult = excluded.is_adult,
        is_new_tag = excluded.is_new_tag,
        season_count = excluded.season_count,
        episode_count = excluded.episode_count,
        text_hash = excluded.text_hash,
        last_seen_at = excluded.last_seen_at,
        removed_at = NULL,
        lookup_key = excluded.lookup_key,
        content_hash = excluded.content_hash,
        added_raw = excluded.added_raw,
        embed_text = excluded.embed_text
     RETURNING rowid`,
    titleId,
    title.type,
    title.title,
    title.titleNorm,
    title.year,
    title.rating,
    title.category,
    title.director,
    title.description,
    title.posterUrl,
    title.durationMin,
    title.addedAt,
    title.isAdult ? 1 : 0,
    title.isNewTag ? 1 : 0,
    title.seasonCount,
    title.episodeCount,
    title.textHash,
    options.now,
    options.now,
    title.lookupKey,
    title.contentHash,
    title.addedRaw,
    title.embedText,
  );

  return row?.rowid ?? 0;
}

/**
 * Write the variants, the episodes, the genres and the countries.
 */
function writeChildRows(
  db: Db,
  title: PreparedTitle,
  titleId: string,
  result: WriteResult,
): void {
  db.run('DELETE FROM variants WHERE title_id = ?', titleId);
  db.run('DELETE FROM episodes WHERE title_id = ?', titleId);
  db.run('DELETE FROM title_genres WHERE title_id = ?', titleId);
  db.run('DELETE FROM title_countries WHERE title_id = ?', titleId);

  for (const variant of title.variants) {
    db.run(
      'INSERT OR REPLACE INTO variants (title_id, quality, stream_url, duration_min, category) VALUES (?, ?, ?, ?, ?)',
      titleId,
      variant.quality,
      variant.streamUrl,
      variant.durationMin,
      variant.category,
    );
    result.variants += 1;
  }

  for (const episode of title.episodes) {
    db.run(
      'INSERT OR REPLACE INTO episodes (title_id, season, episode, name, stream_url, duration_min) VALUES (?, ?, ?, ?, ?, ?)',
      titleId,
      episode.season,
      episode.episode,
      episode.name,
      episode.streamUrl,
      episode.durationMin,
    );
    result.episodes += 1;
  }

  for (const genre of title.genres) {
    db.run('INSERT OR IGNORE INTO title_genres (title_id, genre) VALUES (?, ?)', titleId, genre);
  }

  for (const country of title.countries) {
    db.run(
      'INSERT OR IGNORE INTO title_countries (title_id, raw, code) VALUES (?, ?, ?)',
      titleId,
      country.raw,
      country.code,
    );
  }
}

/**
 * Write the row of the keyword index.
 *
 * The text is stemmed before it goes into the index, and the query is
 * stemmed the same way: FTS5 has no Russian stemmer
 * (design: iptv-mcp-servers.md §6.3).
 */
function writeFtsRow(db: Db, title: PreparedTitle, titleId: string, rowid: number): void {
  db.run('DELETE FROM titles_fts WHERE rowid = ?', rowid);
  db.run(
    'INSERT INTO titles_fts (rowid, title_id, title, people, description) VALUES (?, ?, ?, ?, ?)',
    rowid,
    titleId,
    stemText(title.title),
    stemText(title.director),
    stemText(title.description),
  );
}

/**
 * Mark the titles that did not come back, or delete them.
 */
function removeMissingTitles(db: Db, options: WriteOptions, result: WriteResult): void {
  const missing = db.all<{ title_id: string; rowid: number }>(
    `SELECT title_id, rowid FROM titles
      WHERE removed_at IS NULL
        AND title_id NOT IN (SELECT title_id FROM import_staging)`,
  );

  if (missing.length === 0) return;

  if (options.trackChanges) {
    db.run(
      `UPDATE titles SET removed_at = ?
        WHERE removed_at IS NULL
          AND title_id NOT IN (SELECT title_id FROM import_staging)`,
      options.now,
    );
    result.removed = missing.length;
    return;
  }

  // The changes are not tracked: the rows of the titles that left are
  // removed as well.
  for (const row of missing) {
    db.run('DELETE FROM titles_fts WHERE rowid = ?', row.rowid);
  }
  db.run(
    `DELETE FROM titles
      WHERE removed_at IS NULL
        AND title_id NOT IN (SELECT title_id FROM import_staging)`,
  );
  result.deleted = missing.length;
}

/**
 * The titles of the database, for the status of a server.
 */
export interface TitleCounts {
  titles: number;
  films: number;
  series: number;
  removed: number;
  episodes: number;
  variants: number;
}

export function countTitles(db: Db): TitleCounts {
  const row = db.get<{
    titles: number;
    films: number;
    series: number;
    removed: number;
  }>(
    `SELECT count(*) AS titles,
            sum(CASE WHEN type = 'film' THEN 1 ELSE 0 END) AS films,
            sum(CASE WHEN type = 'series' THEN 1 ELSE 0 END) AS series,
            sum(CASE WHEN removed_at IS NOT NULL THEN 1 ELSE 0 END) AS removed
       FROM titles`,
  );

  const episodes = db.get<{ found: number }>('SELECT count(*) AS found FROM episodes');
  const variants = db.get<{ found: number }>('SELECT count(*) AS found FROM variants');

  return {
    titles: row?.titles ?? 0,
    films: row?.films ?? 0,
    series: row?.series ?? 0,
    removed: row?.removed ?? 0,
    episodes: episodes?.found ?? 0,
    variants: variants?.found ?? 0,
  };
}
