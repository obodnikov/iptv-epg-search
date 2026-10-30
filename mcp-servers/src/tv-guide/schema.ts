/**
 * schema.ts - the tables of the TV Guide database.
 *
 * The shape comes from the design (tv-guide-server.md §4.1). Three things
 * were added, each for a reason the phases asked for:
 *
 * - `program_texts.fts_rowid`: the row of the keyword index is written when
 *   a text arrives and is removed when the text leaves the guide. The FTS5
 *   row is deleted by its rowid, so the id is kept on the text row (the
 *   cinema keeps the rowid the other way round: its index row points at the
 *   title row, which never moves).
 * - `program_texts.embed_text`: the text that is embedded. The design keeps
 *   it implicit; the queue of the embedding worker reads the text from the
 *   row it belongs to (the cinema keeps it on the title row for the same
 *   reason).
 * - `vector_queue`: the texts the active model has not embedded yet. It is
 *   filled by the import (§5 step 8) and consumed by the embedding worker
 *   of phase T4; the shape is the one of the cinema server.
 *
 * The classification and extraction columns of `program_texts` (`kind`,
 * `year`, `directors`, …) arrive with phase T2; the import of T1 writes
 * their neutral values (`kind = 'other'`, `kind_source = 'none'`).
 *
 * The migrations are idempotent: they run on every start, on a database of
 * any age (iptv-mcp-servers.md §6.1).
 */

import { type Db, addColumnIfMissing } from '../shared/db.ts';

export const SCHEMA_VERSION = 1;

/**
 * The tables of the TV Guide.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS channels (
  channel_id    TEXT PRIMARY KEY,     -- EPG channel id = playlist tvg-id
  name          TEXT NOT NULL,        -- EPG display-name, else playlist name
  playlist_name TEXT,
  group_title   TEXT,                 -- playlist group-title as written
  theme         TEXT,                 -- film | sport | news | kids | documentary | music | general | adult | NULL (mixed)
  region        TEXT,                 -- ISO 3166-1 alpha-2, or a group code such as 'BALTIC'
  timeshift_h   INTEGER NOT NULL DEFAULT 0,
  quality       INTEGER NOT NULL DEFAULT 1,  -- 0 SD, 1 regular, 2 HD, 3 UHD, 4 4K (web app scale, search.js:80-91)
  family_key    TEXT NOT NULL,        -- name without quality and time-shift marks
  stream_url    TEXT,                 -- NULL when the channel is not in the playlist
  archive_days  INTEGER NOT NULL DEFAULT 0,  -- tvg-rec
  catchup_type  TEXT,                 -- channel attribute, else playlist header, else NULL
  logo_url      TEXT,
  is_adult      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS program_texts (   -- one row per distinct (title, description)
  text_hash    TEXT PRIMARY KEY,
  title        TEXT NOT NULL,        -- type marker and "⋗" removed (phase T2)
  title_norm   TEXT NOT NULL,
  description  TEXT,
  kind         TEXT NOT NULL DEFAULT 'other',       -- §4.3 (values arrive with T2)
  kind_source  TEXT NOT NULL DEFAULT 'none',        -- marker | pattern | channel | meaning | none
  live_mark    INTEGER NOT NULL DEFAULT 0,  -- title started with "⋗"
  year         INTEGER,              -- §4.4 (phase T2)
  directors    TEXT,
  cast_names   TEXT,
  genres       TEXT,                 -- JSON array
  sport        TEXT,                 -- "Футбол"
  venue        TEXT,                 -- "Мексика"
  embed_text   TEXT,                 -- the text that is embedded (the queue reads it here)
  fts_rowid    INTEGER               -- row in program_texts_fts, for removals
);

CREATE TABLE IF NOT EXISTS text_countries (
  text_hash TEXT NOT NULL REFERENCES program_texts(text_hash) ON DELETE CASCADE,
  raw       TEXT NOT NULL,
  code      TEXT,
  PRIMARY KEY (text_hash, raw)
);

CREATE TABLE IF NOT EXISTS programmes (
  channel_id TEXT NOT NULL REFERENCES channels(channel_id),
  start_utc  INTEGER NOT NULL,       -- from start_raw with its offset
  stop_utc   INTEGER NOT NULL,
  start_raw  TEXT NOT NULL,
  stop_raw   TEXT NOT NULL,
  text_hash  TEXT NOT NULL REFERENCES program_texts(text_hash),
  PRIMARY KEY (channel_id, start_utc)
);

CREATE INDEX IF NOT EXISTS idx_prog_start ON programmes(start_utc);
CREATE INDEX IF NOT EXISTS idx_prog_text  ON programmes(text_hash);
CREATE INDEX IF NOT EXISTS idx_text_kind  ON program_texts(kind);
CREATE INDEX IF NOT EXISTS idx_text_title ON program_texts(title_norm);
CREATE INDEX IF NOT EXISTS idx_channels_group ON channels(group_title);

CREATE VIRTUAL TABLE IF NOT EXISTS program_texts_fts USING fts5(
  text_hash UNINDEXED,
  title,        -- stemmed
  people,       -- directors + cast, stemmed (phase T2)
  description,  -- stemmed
  tokenize = 'unicode61 remove_diacritics 2'
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
 * Bring the schema of the TV Guide database up to date.
 *
 * The statements run on every start; a database of any age ends up with
 * the tables and columns above.
 */
export function applyTvGuideSchema(db: Db): void {
  db.exec(SCHEMA_SQL);

  // Columns that a database of an older version may miss.
  addColumnIfMissing(db, 'program_texts', 'fts_rowid', 'INTEGER');

  db.setMeta('schema_version', String(SCHEMA_VERSION));
}
