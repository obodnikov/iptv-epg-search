/**
 * queries.ts - reading the guide.
 *
 * The write side of the guide is in `store.ts`; the programme reads are
 * here: the counts, the schedule of a channel, the programme that is on
 * now, the airings of a title, and the candidate rows of a search. The
 * channel reads are in `channels-read.ts`.
 *
 * The queries read what is in the database and nothing more: what a row
 * means to the model is decided in `items.ts` and `search.ts`.
 */

import { type Db } from '../shared/db.ts';
import { normalizeTitle } from '../shared/text.ts';
import { CHANNEL_COLUMNS, type ChannelRow } from './channels-read.ts';
import { quoteTerms } from './words.ts';

/**
 * One airing, as the candidate rows of a search carry it.
 *
 * The rows are slim on purpose: a search without words and without filters
 * sees every programme of the guide, and the collapse of the repeats works
 * over all of them before a page is cut.
 */
export interface CandidateRow {
  channel_id: string;
  start_utc: number;
  stop_utc: number;
  text_hash: string;
  title_norm: string;
  family_key: string;
  quality: number;
  channel_name: string;
  score: number | null;
}

/** A programme with its text and its channel, as `get_program` needs it. */
export interface ProgramRow {
  channel_id: string;
  start_utc: number;
  stop_utc: number;
  start_raw: string;
  stop_raw: string;
  text_hash: string;
  title: string;
  title_norm: string;
  description: string | null;
  kind: string;
  kind_source: string;
  live_mark: number;
  year: number | null;
  directors: string | null;
  cast_names: string | null;
  genres: string | null;
  sport: string | null;
  venue: string | null;
  name: string;
  playlist_name: string | null;
  group_title: string | null;
  theme: string | null;
  region: string | null;
  quality: number;
  family_key: string;
  stream_url: string | null;
  archive_days: number;
  catchup_type: string | null;
  is_adult: number;
}

/**
 * The numbers of the guide, for `get_status`.
 */
export interface GuideCounts {
  channels: number;
  /** The programmes that are in the guide right now. */
  programmes: number;
  texts: number;
  /** The texts that are waiting for a vector of the active model. */
  queue: number;
  /** The channels that have a stream. */
  with_stream: number;
  /** The channels with an archive deeper than zero days. */
  with_archive: number;
}

/**
 * The counts of the guide.
 */
export function guideCounts(db: Db, model: string): GuideCounts {
  const programmes = db.get<{ found: number }>(
    'SELECT count(*) AS found FROM programmes',
  )?.found ?? 0;
  const channels = db.get<{ found: number }>(
    'SELECT count(*) AS found FROM channels',
  )?.found ?? 0;
  const texts = db.get<{ found: number }>(
    'SELECT count(*) AS found FROM program_texts',
  )?.found ?? 0;
  const queue = db.get<{ found: number }>(
    'SELECT count(*) AS found FROM vector_queue WHERE model = ?',
    model,
  )?.found ?? 0;
  const withStream = db.get<{ found: number }>(
    'SELECT count(*) AS found FROM channels WHERE stream_url IS NOT NULL',
  )?.found ?? 0;
  const withArchive = db.get<{ found: number }>(
    'SELECT count(*) AS found FROM channels WHERE archive_days > 0',
  )?.found ?? 0;

  return {
    channels,
    programmes,
    texts,
    queue,
    with_stream: withStream,
    with_archive: withArchive,
  };
}

/**
 * The first and the last programme start of the guide.
 *
 * @returns the epochs, or nulls when the guide is empty.
 */
export function guideWindow(db: Db): { from: number | null; to: number | null } {
  // `from` and `to` are reserved words in SQL; the aliases stay away from
  // them.
  const row = db.get<{ lo: number | null; hi: number | null }>(
    'SELECT min(start_utc) AS lo, max(start_utc) AS hi FROM programmes',
  );
  return { from: row?.lo ?? null, to: row?.hi ?? null };
}

/**
 * True when the guide holds no programme at all.
 */
export function guideEmpty(db: Db): boolean {
  return guideWindow(db).from === null;
}

/** The columns of a programme row: the programme, its text and its channel. */
const PROGRAM_SELECT = `p.channel_id, p.start_utc, p.stop_utc, p.start_raw, p.stop_raw,
  t.text_hash, t.title, t.title_norm, t.description, t.kind, t.kind_source,
  t.live_mark, t.year, t.directors, t.cast_names, t.genres, t.sport, t.venue,
  c.name, c.playlist_name, c.group_title, c.theme, c.region, c.quality,
  c.family_key, c.stream_url, c.archive_days, c.catchup_type, c.is_adult`;

/**
 * A programme with its text and its channel.
 */
export function programRow(
  db: Db,
  channelId: string,
  startUtc: number,
): ProgramRow | null {
  return (
    db.get<ProgramRow>(
      `SELECT ${PROGRAM_SELECT}
         FROM programmes p
         JOIN program_texts t ON t.text_hash = p.text_hash
         JOIN channels c ON c.channel_id = p.channel_id
        WHERE p.channel_id = ? AND p.start_utc = ?`,
      channelId,
      startUtc,
    ) ?? null
  );
}

/**
 * The programmes of a page of (channel, start) pairs, in one query.
 *
 * The search and the now-and-next need the full rows of the few
 * programmes of an answer; one query per programme would be dozens of
 * round-trips where one is enough.
 *
 * @returns the rows, keyed by `<channel_id>@<start_utc>`.
 */
export function programRowsForPairs(
  db: Db,
  pairs: { channel_id: string; start_utc: number }[],
): Map<string, ProgramRow> {
  const result = new Map<string, ProgramRow>();
  if (pairs.length === 0) return result;

  const values = pairs.map(() => '(?, ?)').join(', ');
  const flat: unknown[] = [];
  for (const pair of pairs) {
    flat.push(pair.channel_id, pair.start_utc);
  }
  for (const row of db.all<ProgramRow>(
    `SELECT ${PROGRAM_SELECT}
       FROM programmes p
       JOIN program_texts t ON t.text_hash = p.text_hash
       JOIN channels c ON c.channel_id = p.channel_id
      WHERE (p.channel_id, p.start_utc) IN (VALUES ${values})`,
    ...flat,
  )) {
    result.set(`${row.channel_id}@${row.start_utc}`, row);
  }
  return result;
}

/**
 * The countries of a page of texts.
 */
export function countriesOfTexts(
  db: Db,
  hashes: string[],
): Map<string, { raw: string; code: string | null }[]> {
  const result = new Map<string, { raw: string; code: string | null }[]>();
  if (hashes.length === 0) return result;

  const marks = hashes.map(() => '?').join(', ');
  for (const row of db.all<{ text_hash: string; raw: string; code: string | null }>(
    `SELECT text_hash, raw, code FROM text_countries
      WHERE text_hash IN (${marks}) ORDER BY raw`,
    ...hashes,
  )) {
    const list = result.get(row.text_hash) ?? [];
    list.push({ raw: row.raw, code: row.code });
    result.set(row.text_hash, list);
  }
  return result;
}

/**
 * The next airings of a title, for `get_program` and `find_airings`.
 *
 * Adult channels are left out unless the setting lets them in: the
 * airings carry times and channel names.
 *
 * @param params.upcoming How many future airings to take, oldest first.
 * @param params.archived How many past airings to take, newest first.
 */
export function airingsOfTitle(
  db: Db,
  titleNorm: string,
  params: {
    upcoming: number;
    archived: number;
    now: number;
    year?: number | null;
    includeAdult?: boolean;
  },
): { upcoming: ProgramRow[]; archived: ProgramRow[]; total: number } {
  const yearClause = params.year ? 'AND t.year = ?' : '';
  const yearValues = params.year ? [params.year] : [];
  const adultClause = params.includeAdult ? '' : 'AND c.is_adult = 0';

  const upcoming = db.all<ProgramRow>(
    `SELECT ${PROGRAM_SELECT}
       FROM programmes p
       JOIN program_texts t ON t.text_hash = p.text_hash
       JOIN channels c ON c.channel_id = p.channel_id
      WHERE t.title_norm = ? AND p.stop_utc > ? ${yearClause} ${adultClause}
      ORDER BY p.start_utc ASC
      LIMIT ?`,
    titleNorm,
    params.now,
    ...yearValues,
    params.upcoming,
  );

  const archived = db.all<ProgramRow>(
    `SELECT ${PROGRAM_SELECT}
       FROM programmes p
       JOIN program_texts t ON t.text_hash = p.text_hash
       JOIN channels c ON c.channel_id = p.channel_id
      WHERE t.title_norm = ? AND p.stop_utc <= ? ${yearClause} ${adultClause}
      ORDER BY p.stop_utc DESC
      LIMIT ?`,
    titleNorm,
    params.now,
    ...yearValues,
    params.archived,
  );

  const total = db.get<{ found: number }>(
    `SELECT count(*) AS found
       FROM programmes p
       JOIN program_texts t ON t.text_hash = p.text_hash
       JOIN channels c ON c.channel_id = p.channel_id
      WHERE t.title_norm = ? ${yearClause} ${adultClause}`,
    titleNorm,
    ...yearValues,
  )?.found ?? 0;

  return { upcoming, archived, total };
}

/**
 * A title by an exact normalised match, else by the words of the FTS
 * title column.
 *
 * @returns the normalised title that was found, or null.
 */
export function resolveTitleNorm(db: Db, title: string): string | null {
  // The exact path compares the normalised forms: the column holds the
  // normalisation of the cleaned title (texts.ts), and the raw request is
  // normalised the same way here.
  const wanted = normalizeTitle(title);
  const exact = db.get<{ title_norm: string }>(
    'SELECT title_norm FROM program_texts WHERE title_norm = ? LIMIT 1',
    wanted,
  );
  if (exact) return exact.title_norm;

  const terms = quoteTerms(title);
  if (terms.length === 0) return null;

  const fts = db.get<{ title_norm: string }>(
    `SELECT t.title_norm AS title_norm
       FROM program_texts t
       JOIN program_texts_fts f ON f.text_hash = t.text_hash
      WHERE program_texts_fts MATCH ?
      ORDER BY bm25(program_texts_fts, 0, 3.0, 1.0, 1.0)
      LIMIT 1`,
    terms.join(' '),
  );
  return fts?.title_norm ?? null;
}

/**
 * The programmes of one channel, for `get_channel_schedule`.
 */
export function channelSchedule(
  db: Db,
  channelId: string,
  from: number,
  to: number,
): ProgramRow[] {
  return db.all<ProgramRow>(
    `SELECT ${PROGRAM_SELECT}
       FROM programmes p
       JOIN program_texts t ON t.text_hash = p.text_hash
       JOIN channels c ON c.channel_id = p.channel_id
      WHERE p.channel_id = ? AND p.start_utc >= ? AND p.start_utc < ?
      ORDER BY p.start_utc ASC`,
    channelId,
    from,
    to,
  );
}

/**
 * What every channel of a filter is showing now and next.
 *
 * @returns one row per channel: the channel, the current programme and the
 *   next one, either of them null when the guide has none.
 */
export interface NowAndNextRow {
  channel: ChannelRow;
  current: ProgramRow | null;
  next: ProgramRow | null;
}

export function nowAndNext(
  db: Db,
  params: {
    themes: string[];
    regions: string[];
    channelIds: string[];
    includeTimeshift: boolean;
    includeAdult: boolean;
    now: number;
  },
): NowAndNextRow[] {
  const where: string[] = [];
  const values: unknown[] = [];

  if (!params.includeAdult) {
    where.push('c.is_adult = 0');
  }
  if (params.themes.length > 0) {
    where.push(`c.theme IN (${params.themes.map(() => '?').join(', ')})`);
    values.push(...params.themes);
  }
  if (params.regions.length > 0) {
    where.push(`upper(c.region) IN (${params.regions.map(() => 'upper(?)').join(', ')})`);
    values.push(...params.regions);
  }
  if (params.channelIds.length > 0) {
    where.push(`c.channel_id IN (${params.channelIds.map(() => '?').join(', ')})`);
    values.push(...params.channelIds);
  }
  if (!params.includeTimeshift) {
    where.push('c.timeshift_h = 0');
  }

  const clause = where.length > 0 ? `AND ${where.join(' AND ')}` : '';

  const rows = db.all<{
    channel_id: string;
    current_start: number | null;
    next_start: number | null;
  }>(
    `SELECT c.channel_id AS channel_id,
            max(CASE WHEN p.start_utc <= ? AND p.stop_utc > ?
                     THEN p.start_utc END) AS current_start,
            min(CASE WHEN p.start_utc > ? THEN p.start_utc END) AS next_start
       FROM channels c
       LEFT JOIN programmes p
              ON p.channel_id = c.channel_id
             AND p.stop_utc > ? AND p.start_utc < ?
      WHERE 1 = 1 ${clause}
      GROUP BY c.channel_id
      ORDER BY c.name COLLATE NOCASE, c.channel_id`,
    params.now,
    params.now,
    params.now,
    params.now,
    params.now + 3 * 86400,
    ...values,
  );

  const result: NowAndNextRow[] = [];

  // The channels and the programme rows are fetched in two batched
  // queries: a row per channel would be thousands of round-trips on a
  // real playlist.
  const channelIds = [...new Set(rows.map((row) => row.channel_id))];
  const channels = new Map<string, ChannelRow>(
    channelIds.length === 0
      ? []
      : db
          .all<ChannelRow>(
            `SELECT ${CHANNEL_COLUMNS} FROM channels
              WHERE channel_id IN (${channelIds.map(() => '?').join(', ')})`,
            ...channelIds,
          )
          .map((channel) => [channel.channel_id, channel]),
  );

  const pairs: { channel_id: string; start_utc: number }[] = [];
  for (const row of rows) {
    if (row.current_start !== null) {
      pairs.push({ channel_id: row.channel_id, start_utc: row.current_start });
    }
    if (row.next_start !== null) {
      pairs.push({ channel_id: row.channel_id, start_utc: row.next_start });
    }
  }
  const programmes = programRowsForPairs(db, pairs);

  for (const row of rows) {
    const channel = channels.get(row.channel_id);
    if (!channel) continue;
    const current =
      row.current_start === null
        ? null
        : (programmes.get(`${row.channel_id}@${row.current_start}`) ?? null);
    const next =
      row.next_start === null
        ? null
        : (programmes.get(`${row.channel_id}@${row.next_start}`) ?? null);
    if (!current && !next) continue;
    result.push({ channel, current, next });
  }
  return result;
}
