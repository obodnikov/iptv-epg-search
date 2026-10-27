/**
 * schema.ts - the tables of the cinema database.
 *
 * The shape comes from the design (cinema-server.md §3.1). Four columns and
 * two tables were added, each for a reason the design asked for:
 *
 * - `titles.lookup_key`: §3.2 derives the id from a hash, but §11.7 wants
 *   the importer to look a title up by its type and its normalised title and
 *   to keep the id the row already has, so that the id of a series never
 *   drifts when its earliest episode year changes. A hash cannot be that
 *   lookup key.
 * - `titles.content_hash`: §4 step 7 rebuilds the variant, episode, genre
 *   and country rows of the *changed* titles. The hash says which titles
 *   changed.
 * - `titles.added_raw`: parent §6.1 keeps the raw source string next to the
 *   time.
 * - `import_staging`: the set of the titles of the running import. The
 *   titles that are not in it are the ones that left the catalogue.
 * - `vector_queue`: the texts the active model has not embedded yet.
 *
 * The migrations are idempotent: they run on every start, on a database of
 * any age (parent §6.1).
 */

import { type Db, addColumnIfMissing } from '../shared/db.ts';

export const SCHEMA_VERSION = 1;

/**
 * The tables of the cinema catalogue.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS titles (
  title_id      TEXT PRIMARY KEY,     -- stable across refreshes (§3.2)
  type          TEXT NOT NULL,        -- 'film' | 'series'
  title         TEXT NOT NULL,        -- display title, quality suffix removed
  title_norm    TEXT NOT NULL,        -- lower case, ё→е, punctuation and spaces collapsed
  year          INTEGER,
  rating        REAL,                 -- provider rating 0–10, NULL if empty
  category      TEXT,                 -- group-title (series: of the first episode seen)
  director      TEXT,
  description   TEXT,
  poster_url    TEXT,
  duration_min  INTEGER,              -- film length; for series the most common episode length
  added_at      INTEGER,              -- provider "added", UTC epoch seconds (series: latest)
  is_adult      INTEGER NOT NULL DEFAULT 0,
  is_new_tag    INTEGER NOT NULL DEFAULT 0,  -- provider tag "Новинки"
  season_count  INTEGER,
  episode_count INTEGER,
  text_hash     TEXT,                 -- hash of the embedding text (§5)
  first_seen_at INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  removed_at    INTEGER,              -- set when absent from the latest catalogue
  lookup_key    TEXT NOT NULL,        -- film|<title_norm>|<year> | series|<title_norm>
  content_hash  TEXT,                 -- hash over the whole row set of the title
  added_raw     TEXT,                 -- the provider's own "added" string
  embed_text    TEXT                  -- the text that is embedded (§5)
);

CREATE TABLE IF NOT EXISTS title_genres (
  title_id TEXT NOT NULL REFERENCES titles(title_id) ON DELETE CASCADE ON UPDATE CASCADE,
  genre    TEXT NOT NULL,             -- trimmed provider genre, tags excluded
  PRIMARY KEY (title_id, genre)
);

CREATE TABLE IF NOT EXISTS title_countries (
  title_id TEXT NOT NULL REFERENCES titles(title_id) ON DELETE CASCADE ON UPDATE CASCADE,
  raw      TEXT NOT NULL,             -- value as in the catalogue
  code     TEXT,                      -- ISO 3166-1 alpha-2, NULL if unknown
  PRIMARY KEY (title_id, raw)
);

CREATE TABLE IF NOT EXISTS variants (          -- films only
  title_id     TEXT NOT NULL REFERENCES titles(title_id) ON DELETE CASCADE ON UPDATE CASCADE,
  quality      TEXT NOT NULL,          -- 'standard', '4K HDR', '4K', '4K SDR', …
  stream_url   TEXT NOT NULL,
  duration_min INTEGER,
  category     TEXT,
  PRIMARY KEY (title_id, quality)
);

CREATE TABLE IF NOT EXISTS episodes (          -- series only
  title_id     TEXT NOT NULL REFERENCES titles(title_id) ON DELETE CASCADE ON UPDATE CASCADE,
  season       INTEGER NOT NULL,
  episode      INTEGER NOT NULL,
  name         TEXT,                   -- full entry title, e.g. "Бабье царство S01E01"
  stream_url   TEXT NOT NULL,
  duration_min INTEGER,
  PRIMARY KEY (title_id, season, episode)
);

CREATE VIRTUAL TABLE IF NOT EXISTS titles_fts USING fts5(
  title_id UNINDEXED,
  title,          -- stemmed
  people,         -- director, stemmed
  description,    -- stemmed
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE INDEX IF NOT EXISTS idx_titles_type_year ON titles(type, year);
CREATE INDEX IF NOT EXISTS idx_titles_rating    ON titles(rating);
CREATE INDEX IF NOT EXISTS idx_titles_added     ON titles(added_at);
CREATE INDEX IF NOT EXISTS idx_genres_genre     ON title_genres(genre);
CREATE INDEX IF NOT EXISTS idx_countries_code   ON title_countries(code);

-- The titles of the running import. A title that is not in this table did
-- not come back from the provider.
CREATE TABLE IF NOT EXISTS import_staging (
  title_id TEXT PRIMARY KEY
);

-- The texts the active model has not embedded yet.
CREATE TABLE IF NOT EXISTS vector_queue (
  text_hash TEXT NOT NULL,
  model     TEXT NOT NULL,
  queued_at INTEGER NOT NULL,
  PRIMARY KEY (text_hash, model)
);
`;

/**
 * Create the tables and bring an old database up to date.
 *
 * Every step is idempotent, so this can run on every start.
 */
export function applyCinemaSchema(db: Db): void {
  db.exec(SCHEMA_SQL);

  // The columns that came with the design after the first version of the
  // schema was written. On a fresh database they are already there.
  addColumnIfMissing(db, 'titles', 'lookup_key', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'titles', 'content_hash', 'TEXT');
  addColumnIfMissing(db, 'titles', 'added_raw', 'TEXT');
  addColumnIfMissing(db, 'titles', 'embed_text', 'TEXT');

  // A database of an earlier build has an empty lookup key in every row.
  // The key is built again from the columns of the title.
  db.exec(
    `UPDATE titles SET lookup_key =
       CASE WHEN type = 'series'
            THEN 'series|' || title_norm
            ELSE 'film|' || title_norm || '|' || COALESCE(year, '')
       END
     WHERE lookup_key = '' OR lookup_key IS NULL`,
  );

  // The index over the added columns comes after the columns themselves:
  // an index over a column that does not exist yet cannot be created.
  db.exec('CREATE INDEX IF NOT EXISTS idx_titles_removed ON titles(removed_at);');

  // The lookup key has to be unique: it is how the importer finds the row
  // of a title. Two rows with the same key would send the rows of a new
  // catalogue to the wrong title. The unique index makes the import fail
  // instead of that.
  const duplicates = db.get<{ found: number }>(
    'SELECT count(*) AS found FROM (SELECT lookup_key FROM titles GROUP BY lookup_key HAVING count(*) > 1)',
  );

  if ((duplicates?.found ?? 0) > 0) {
    // The identity of the titles cannot be trusted any more. The database
    // has to be repaired; the import must not paper over it.
    throw new Error(
      `the catalogue database holds titles with the same lookup key (${duplicates?.found ?? 0} of them); the identity of the titles cannot be trusted and the database has to be repaired`,
    );
  }

  // An index of an earlier build was not unique: it is built again.
  const indexes = db.all<{ name: string; unique: number }>("PRAGMA index_list('titles')");
  const existing = indexes.find((index) => index.name === 'idx_titles_lookup');
  if (existing && existing.unique === 0) {
    db.exec('DROP INDEX IF EXISTS idx_titles_lookup;');
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_titles_lookup ON titles(lookup_key);');

  // The version of the schema is written down, so that a migration of a
  // later version knows what it is looking at.
  db.setMeta('schema_version', String(SCHEMA_VERSION));
}
