/**
 * channels-read.ts - reading the channels of the guide.
 *
 * The queries behind `list_channels`, the resolution of the channel
 * filter of a search, and the mapping of a region value to the codes and
 * raw names the SQL compares. The programme reads are in `queries.ts`.
 */

import { type Db } from '../shared/db.ts';
import { countryCode, normalizeCountryName } from '../shared/countries.ts';

export const CHANNEL_COLUMNS = `channel_id, name, playlist_name, group_title, theme, region,
  timeshift_h, quality, family_key, stream_url, archive_days, catchup_type, is_adult`;

/** A channel, as the tools show it. */
export interface ChannelRow {
  channel_id: string;
  name: string;
  playlist_name: string | null;
  group_title: string | null;
  theme: string | null;
  region: string | null;
  timeshift_h: number;
  quality: number;
  family_key: string;
  stream_url: string | null;
  archive_days: number;
  catchup_type: string | null;
  is_adult: number;
}

/**
 * A channel by its id.
 */
export function channelById(db: Db, channelId: string): ChannelRow | null {
  return (
    db.get<ChannelRow>(
      `SELECT ${CHANNEL_COLUMNS} FROM channels WHERE channel_id = ?`,
      channelId,
    ) ?? null
  );
}

/**
 * Resolve the channels of a filter.
 *
 * A value may be an id, a name or a playlist name. The case of the names
 * does not matter - and it is folded in JavaScript, not in SQL: SQLite's
 * `lower()` knows the Latin letters only, and the names of the channels
 * are mostly Cyrillic.
 *
 * @returns the ids that were found and the values that were not.
 */
export function resolveChannels(
  db: Db,
  values: string[],
): { ids: string[]; unknown: string[] } {
  const ids: string[] = [];
  const unknown: string[] = [];

  const cleaned = values.map((value) => value.trim()).filter(Boolean);
  if (cleaned.length === 0) return { ids, unknown };

  const rows = db.all<{
    channel_id: string;
    name: string;
    playlist_name: string | null;
  }>('SELECT channel_id, name, playlist_name FROM channels');

  for (const value of cleaned) {
    const lower = value.toLowerCase();
    const hit = rows.find(
      (row) =>
        row.channel_id === value ||
        row.channel_id.toLowerCase() === lower ||
        row.name.toLowerCase() === lower ||
        (row.playlist_name ?? '').toLowerCase() === lower,
    );
    if (hit) {
      if (!ids.includes(hit.channel_id)) ids.push(hit.channel_id);
    } else {
      unknown.push(value);
    }
  }

  return { ids, unknown };
}

/**
 * One row of the group summary of `list_channels`.
 */
export interface GroupSummary {
  group: string | null;
  channels: number;
  theme: string | null;
  region: string | null;
  /** The channels of the group that have an archive. */
  with_archive: number;
  /** The deepest archive a channel of the group has. */
  archive_days: number;
}

/**
 * The groups of the guide, with their numbers.
 *
 * Adult channels are left out unless the setting lets them in: the group
 * summary names groups, and a group name is content.

/**
 * The groups of the guide, with their numbers.
 *
 * Adult channels are left out unless the setting lets them in: the group
 * summary names groups, and a group name is content.
 */
export function groupSummaries(db: Db, includeAdult: boolean): GroupSummary[] {
  // The theme and the region of a group are shown only when every
  // channel of the group agrees: a mixed group (Ultra HD holds films and
  // sport) answers null, which the rendering reads as "mixed".
  const rows = db.all<{
    grp: string | null;
    channels: number;
    theme: string | null;
    region: string | null;
    with_archive: number;
    archive_days: number;
  }>(
    `SELECT group_title AS grp, count(*) AS channels,
            CASE WHEN min(theme) = max(theme) THEN min(theme) END AS theme,
            CASE WHEN min(region) = max(region) THEN min(region) END AS region,
            sum(CASE WHEN archive_days > 0 THEN 1 ELSE 0 END) AS with_archive,
            coalesce(max(archive_days), 0) AS archive_days
       FROM channels
      WHERE ${includeAdult ? '1 = 1' : 'is_adult = 0'}
      GROUP BY group_title
      ORDER BY channels DESC, group_title`,
  );
  return rows.map((row) => ({
    group: row.grp,
    channels: row.channels,
    theme: row.theme,
    region: row.region,
    with_archive: row.with_archive,
    archive_days: row.archive_days,
  }));
}

/**
 * The channels of a filter, for `list_channels`.
 *
 * @param params The filters: theme, region, a part of a name, whether the
 *   time-shifted channels and the channels without a stream are listed.

/**
 * The channels of a filter, for `list_channels`.
 *
 * @param params The filters: theme, region, a part of a name, whether the
 *   time-shifted channels and the channels without a stream are listed.
 */
export function channelList(
  db: Db,
  params: {
    theme?: string;
    regions: string[];
    query?: string;
    includeTimeshift: boolean;
    onlyWithStream: boolean;
    includeAdult: boolean;
  },
): ChannelRow[] {
  const where: string[] = [];
  const values: unknown[] = [];

  if (!params.includeAdult) {
    where.push('is_adult = 0');
  }
  if (params.theme) {
    where.push('theme = ?');
    values.push(params.theme);
  }
  if (params.regions.length > 0) {
    const marks = params.regions.map(() => 'upper(?)').join(', ');
    where.push(`upper(region) IN (${marks})`);
    values.push(...params.regions);
  }
  if (params.query) {
    where.push(
      "(name LIKE ? ESCAPE '\\' OR playlist_name LIKE ? ESCAPE '\\' OR channel_id LIKE ? ESCAPE '\\')",
    );
    const like = `%${params.query.replace(/[\\%_]/g, '\\$&')}%`;
    values.push(like, like, like);
  }
  if (!params.includeTimeshift) {
    where.push('timeshift_h = 0');
  }
  if (params.onlyWithStream) {
    where.push('stream_url IS NOT NULL');
  }

  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  return db.all<ChannelRow>(
    `SELECT ${CHANNEL_COLUMNS} FROM channels ${clause}
      ORDER BY name COLLATE NOCASE, channel_id`,
    ...values,
  );
}

/**
 * The ISO codes and raw names of a country filter.
 *
 * A value may be an ISO code ("DE"), a name in any language
 * ("Deutschland") or a group code of the guide ("BALTIC"). A name that the
 * country table does not know keeps its normalised value, so that a region
 * written that way is still found.
 */
export function regionValues(values: string[]): { codes: string[]; raws: string[] } {
  const codes: string[] = [];
  const raws: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;

    if (/^[A-Za-z]{2}$/.test(trimmed)) {
      const code = trimmed.toUpperCase();
      if (!codes.includes(code)) codes.push(code);
      continue;
    }

    const code = countryCode(trimmed);
    if (code) {
      if (!codes.includes(code)) codes.push(code);
      continue;
    }

    const raw = (normalizeCountryName(trimmed) ?? trimmed).toUpperCase();
    if (!raws.includes(raw)) raws.push(raw);
  }

  return { codes, raws };
}
