/**
 * identity.ts - which id a title gets.
 *
 * The id of a title must survive a refresh, so that a title the model
 * mentioned yesterday can still be opened (design: cinema-server.md §3.2).
 *
 * The rules:
 * - the importer looks a title up by its `lookup_key` (the type and the
 *   normalised title, and for a film the year). The id of the row that is
 *   already there is kept. That is what keeps the id of a series stable,
 *   even when an earlier episode changes its earliest year (§11.7);
 * - a title that was not seen before gets the first 16 hex characters of the
 *   sha256 of `type | title_norm | year`;
 * - when two different titles want the same id, the import logs it and
 *   appends the director to the hash input for both of them (§3.2).
 */

import { type Db } from '../shared/db.ts';
import { idSeedFor, titleIdFor } from './keys.ts';

/** A row of the `titles` table, as the identity needs it. */
export interface ExistingTitle {
  title_id: string;
  rowid: number;
  type: string;
  title: string;
  title_norm: string;
  year: number | null;
  director: string | null;
  category: string | null;
  lookup_key: string;
  content_hash: string | null;
  text_hash: string | null;
  first_seen_at: number;
  /** The moment the title left the catalogue, or null when it is live. */
  removed_at: number | null;
}

/** The title the importer wants to write. */
export interface TitleIdentity {
  type: 'film' | 'series';
  titleNorm: string;
  year: number | null;
  director: string;
  category: string;
  /** The key the title is looked up by. */
  lookupKey: string;
  /** The seed of the id: `type | title_norm | year`. */
  seed: string;
}

/** What happened to the id of a title. */
export interface IdentityResolution {
  /** The id the title is written under. */
  titleId: string;
  /** The row that was already there, or null for a new title. */
  existing: ExistingTitle | null;
  /** Set when two different titles wanted the same id. */
  collision: TitleIdCollision | null;
}

/** A pair of titles that wanted the same id. */
export interface TitleIdCollision {
  /** The id both of them wanted. */
  baseId: string;
  /** The lookup key of the title that was already in the database. */
  existingLookupKey: string;
  /** The lookup key of the title that came in with the import. */
  incomingLookupKey: string;
  /** The director of the title that was already there. */
  existingDirector: string;
  /** The director of the title that came in with the import. */
  incomingDirector: string;
  /** The id the title that was already there got. */
  existingTitleId: string;
  /** The id the new title got. */
  incomingTitleId: string;
}

const EXISTING_COLUMNS =
  'rowid, title_id, type, title, title_norm, year, director, category, lookup_key, content_hash, text_hash, first_seen_at, removed_at';

function rowToExisting(row: Record<string, unknown>): ExistingTitle {
  return {
    title_id: String(row['title_id'] ?? ''),
    rowid: Number(row['rowid'] ?? 0),
    type: String(row['type'] ?? 'film'),
    title: String(row['title'] ?? ''),
    title_norm: String(row['title_norm'] ?? ''),
    year: typeof row['year'] === 'number' ? row['year'] : null,
    director: typeof row['director'] === 'string' ? row['director'] : null,
    category: typeof row['category'] === 'string' ? row['category'] : null,
    lookup_key: String(row['lookup_key'] ?? ''),
    content_hash: typeof row['content_hash'] === 'string' ? row['content_hash'] : null,
    text_hash: typeof row['text_hash'] === 'string' ? row['text_hash'] : null,
    first_seen_at: Number(row['first_seen_at'] ?? 0),
    removed_at: typeof row['removed_at'] === 'number' ? row['removed_at'] : null,
  };
}

/**
 * Find a title by its lookup key.
 *
 * The lookup key is unique (the index of the schema is a unique one), so
 * there is only one row. The order is only there to make the result the
 * same on a database of an earlier build, where the index was not unique.
 */
export function findByLookupKey(db: Db, lookupKey: string): ExistingTitle | null {
  const row = db.get<Record<string, unknown>>(
    `SELECT ${EXISTING_COLUMNS} FROM titles WHERE lookup_key = ? ORDER BY first_seen_at, rowid LIMIT 1`,
    lookupKey,
  );
  return row ? rowToExisting(row) : null;
}

/**
 * Find a title by its id.
 */
export function findById(db: Db, titleId: string): ExistingTitle | null {
  const row = db.get<Record<string, unknown>>(
    `SELECT ${EXISTING_COLUMNS} FROM titles WHERE title_id = ? LIMIT 1`,
    titleId,
  );
  return row ? rowToExisting(row) : null;
}

/**
 * True when an id is already taken.
 */
export function idTaken(db: Db, titleId: string, exceptId?: string): boolean {
  const row = db.get<{ found: number }>(
    'SELECT count(*) AS found FROM titles WHERE title_id = ? AND title_id != ?',
    titleId,
    exceptId ?? '',
  );
  return (row?.found ?? 0) > 0;
}

/**
 * The part that tells two titles of the same name apart.
 *
 * The director is the one the design names (§3.2). When it is empty, the
 * category and the genres are used, so that the hash input is still
 * different for two different films.
 */
export function discriminatorOf(title: {
  director?: string | null;
  category?: string | null;
  genres?: readonly string[];
}): string {
  const director = title.director?.trim() ?? '';
  if (director) return director;
  const category = title.category?.trim() ?? '';
  if (category) return category;
  const genres = (title.genres ?? []).map((genre) => genre.trim()).filter(Boolean);
  if (genres.length > 0) return genres.join(', ');
  return 'unknown';
}

/**
 * The id of a title that is not in the database yet, with a discriminator
 * that is not taken either.
 */
export function uniqueId(
  db: Db,
  seed: string,
  discriminator: string,
  exceptId?: string,
): string {
  let candidate = titleIdFor(seed, discriminator);
  let counter = 2;
  while (idTaken(db, candidate, exceptId)) {
    candidate = titleIdFor(seed, `${discriminator} #${counter}`);
    counter += 1;
    if (counter > 1000) {
      // A thousand titles that cannot be told apart: the id cannot be
      // found. The import fails with this message, not with a constraint
      // error of the database.
      throw new Error(
        `no free id was found for the title "${discriminator}" after ${counter} tries`,
      );
    }
  }
  return candidate;
}

/**
 * Give a title its id.
 *
 * When the id of the seed is already held by another title, the two of them
 * are told apart by their director (or by their category, or by their
 * genres). The title that was already in the database is re-keyed, so that
 * neither of the two holds the base id.
 */
export function resolveTitleId(
  db: Db,
  identity: TitleIdentity,
  genres: readonly string[],
): IdentityResolution {
  const byLookup = findByLookupKey(db, identity.lookupKey);
  if (byLookup) {
    return { titleId: byLookup.title_id, existing: byLookup, collision: null };
  }

  const baseId = titleIdFor(identity.seed);
  const holder = findById(db, baseId);
  if (!holder) {
    return { titleId: baseId, existing: null, collision: null };
  }

  // Two different titles want the same id. The design asks for the director
  // to be appended to the hash input for both of them (§3.2).
  const existingDiscriminator = discriminatorOf({
    director: holder.director,
    category: holder.category,
  });
  const existingSeed = idSeedFor(
    holder.type === 'series' ? 'series' : 'film',
    holder.title_norm,
    holder.year,
  );
  const existingTitleId = uniqueId(db, existingSeed, existingDiscriminator, holder.title_id);

  const incomingDiscriminator = discriminatorOf({
    director: identity.director,
    category: identity.category,
    genres,
  });
  const incomingTitleId = uniqueId(db, identity.seed, incomingDiscriminator);

  return {
    titleId: incomingTitleId,
    existing: null,
    collision: {
      baseId,
      existingLookupKey: holder.lookup_key,
      incomingLookupKey: identity.lookupKey,
      existingDirector: holder.director ?? '',
      incomingDirector: identity.director,
      existingTitleId,
      incomingTitleId,
    },
  };
}

/**
 * Move a title to another id.
 *
 * The rows of the title follow it: the genres, the countries, the variants
 * and the episodes are updated with ON UPDATE CASCADE, and the row of the
 * keyword index is updated as well. The staging table of the running import
 * follows too — a title that was staged under the old id would look like a
 * title that left the catalogue.
 */
export function rekeyTitle(db: Db, oldId: string, newId: string): void {
  if (oldId === newId) return;

  // The keyword index holds the id as a plain column.
  db.run('UPDATE titles_fts SET title_id = ? WHERE title_id = ?', newId, oldId);
  // The staging table of the running import has no foreign key.
  db.run('UPDATE import_staging SET title_id = ? WHERE title_id = ?', newId, oldId);
  db.run('UPDATE titles SET title_id = ? WHERE title_id = ?', newId, oldId);
}
