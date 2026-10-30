/**
 * text-rows.ts - the row of a programme text and its derived fields.
 *
 * The text of a programme is one row of the `program_texts` table, with
 * its keyword-index row, its countries and its queue row. Everything the
 * row holds comes from the text itself (the facts of the description) and
 * from the channels the text airs on (the kind of the theme).
 *
 * A row that is already in the database is written again when the
 * version of the derivation differs or when the kind of the text changed
 * with the channels around it.
 */

import { type Db } from '../shared/db.ts';
import { stemText } from '../shared/text.ts';
import { kindFromTheme } from './kind.ts';
import type { Theme } from './groups.ts';
import { queueText, removeQueuedTexts } from './queue.ts';
import { applyChannelKind, DERIVED_VERSION, type ProgrammeText } from './texts.ts';
import type { ImportOptions } from './import-options.ts';

/**
 * What the database holds about a text that is already there.
 */
export interface KnownText {
  derived_version: number;
  embed_hash: string | null;
  fts_rowid: number | null;
  kind: string;
  kind_source: string;
}

/**
 * The people of a text: the director and the cast, as the keyword index
 * holds them.
 */
function peopleOf(text: ProgrammeText): string {
  return [text.directors, text.castNames]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(', ');
}

/**
 * What one row of a text cost.
 */
export interface TextRowOutcome {
  /** The rows of the keyword index that were written. */
  ftsRows: number;
  /** The country names that the country table does not know. */
  unknownCountries: number;
}

/**
 * Write the row of a text that is new to the guide.
 */
export function insertTextRow(
  db: Db,
  text: ProgrammeText,
  options: ImportOptions,
): TextRowOutcome {
  db.run(
    `INSERT INTO program_texts
       (text_hash, title, title_norm, description, kind, kind_source,
        live_mark, year, directors, cast_names, genres, sport, venue,
        embed_text, embed_hash, derived_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(text_hash) DO NOTHING`,
    text.hash,
    text.title,
    text.titleNorm,
    text.description || null,
    text.kind,
    text.kindSource,
    text.liveMark ? 1 : 0,
    text.year,
    text.directors || null,
    text.castNames || null,
    text.genres.length > 0 ? JSON.stringify(text.genres) : null,
    text.sport,
    text.venue,
    text.embedText,
    text.embedHash,
    DERIVED_VERSION,
  );

  // The keyword index (design: iptv-mcp-servers.md §6.3): the text is
  // stemmed before it goes into the index, because FTS5 has no Russian
  // stemmer.
  const fts = db.run(
    `INSERT INTO program_texts_fts (text_hash, title, people, description)
     VALUES (?, ?, ?, ?)`,
    text.hash,
    stemText(text.titleNorm),
    stemText(peopleOf(text)),
    stemText(text.description),
  );
  // A RETURNING rowid on an FTS5 table answers -1; the rowid of the
  // insert comes from lastInsertRowid instead.
  const rowid = Number(fts.lastInsertRowid) || null;
  db.run('UPDATE program_texts SET fts_rowid = ? WHERE text_hash = ?', rowid, text.hash);

  queueText(db, text.embedHash, text.embedText, options);

  return { ftsRows: 1, unknownCountries: writeCountries(db, text) };
}
/**
 * Write the row of a text again.
 *
 * The facts, the keyword-index row and the queue entry are written again.
 * The vector of the old embedding text stays in the vectors file: it is
 * the vector of another text now, and it is paid for.
 */
export function rewriteTextRow(
  db: Db,
  text: ProgrammeText,
  known: KnownText,
  options: ImportOptions,
): TextRowOutcome {
  db.run(
    `UPDATE program_texts
        SET title = ?, title_norm = ?, description = ?, kind = ?,
            kind_source = ?, live_mark = ?, year = ?, directors = ?,
            cast_names = ?, genres = ?, sport = ?, venue = ?,
            embed_text = ?, embed_hash = ?, derived_version = ?
      WHERE text_hash = ?`,
    text.title,
    text.titleNorm,
    text.description || null,
    text.kind,
    text.kindSource,
    text.liveMark ? 1 : 0,
    text.year,
    text.directors || null,
    text.castNames || null,
    text.genres.length > 0 ? JSON.stringify(text.genres) : null,
    text.sport,
    text.venue,
    text.embedText,
    text.embedHash,
    DERIVED_VERSION,
    text.hash,
  );

  // The row of the keyword index is written again: the title lost its
  // marker, and the people column is filled for the first time. A text
  // whose row is missing (a database of an older version) gets one.
  if (known.fts_rowid !== null) {
    db.run(
      `UPDATE program_texts_fts SET title = ?, people = ?, description = ? WHERE rowid = ?`,
      stemText(text.titleNorm),
      stemText(peopleOf(text)),
      stemText(text.description),
      known.fts_rowid,
    );
  } else {
    const fts = db.run(
      `INSERT INTO program_texts_fts (text_hash, title, people, description)
       VALUES (?, ?, ?, ?)`,
      text.hash,
      stemText(text.titleNorm),
      stemText(peopleOf(text)),
      stemText(text.description),
    );
    const rowid = Number(fts.lastInsertRowid) || null;
    db.run('UPDATE program_texts SET fts_rowid = ? WHERE text_hash = ?', rowid, text.hash);
  }

  // The queue holds the hash of the embedding text: the old one is
  // dropped, the new one is written. A text whose kind changed but whose
  // embedding text did not (the kind is the same, the source of it is
  // not) keeps its queue row: the vector of it is the vector it already
  // has.
  if (known.embed_hash !== null && known.embed_hash !== text.embedHash) {
    removeQueuedTexts(db, options.embeddingModel, [known.embed_hash]);
    queueText(db, text.embedHash, text.embedText, options);
  } else if (known.embed_hash === null) {
    queueText(db, text.embedHash, text.embedText, options);
  }

  return { ftsRows: 1, unknownCountries: writeCountries(db, text) };
}

/**
 * Write the countries of a text.
 *
 * The names that the country table does not know are counted and left
 * out: a name that is not a country ("Сезон 4") would be a country of
 * the production that never was.
 *
 * @returns the number of the names that were not known.
 */
export function writeCountries(db: Db, text: ProgrammeText): number {
  db.run('DELETE FROM text_countries WHERE text_hash = ?', text.hash);

  let unknown = 0;
  for (const country of text.countries) {
    if (country.code === null) {
      unknown += 1;
      continue;
    }
    db.run(
      'INSERT OR IGNORE INTO text_countries (text_hash, raw, code) VALUES (?, ?, ?)',
      text.hash,
      country.raw,
      country.code,
    );
  }
  return unknown;
}

/**
 * Give a text the kind of the theme of its channels.
 *
 * The theme counts only when the channels of the text agree on it: the
 * same text airs on a sports channel and on a general one, and the
 * theme of the general one says nothing about the programme.
 */
export function withChannelKind(
  text: ProgrammeText,
  themes: Set<Theme> | undefined,
): ProgrammeText {
  if (!themes || themes.size !== 1) return text;

  const theme = [...themes][0] as Theme;
  // A film channel gives "film" only when the description carries the
  // film ending: a channel of films carries trailers and talks as well.
  const kind = kindFromTheme(theme, text.hasEnding);
  if (kind === null) return text;

  return applyChannelKind(text, kind);
}
