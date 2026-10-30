/**
 * channel-rows.ts - the row of a channel and its derived fields.
 *
 * The channel of the guide is one row of the `channels` table, and its
 * derived fields come from two places: the **group** of the playlist
 * (the theme and the region) and the **name** of the channel (the
 * quality, the time shift and the family key).
 */

import { type Db } from '../shared/db.ts';
import { channelQuality, timeshiftHours } from './channel-facts.ts';
import { resolveGroup, type GroupFacts, type Theme } from './groups.ts';
import type { ImportOptions } from './import-options.ts';

/**
 * Groups and channel names that mark an adult channel.
 *
 * The sample carries the group "XXX (18+)"; the mark of the provider is
 * the "(18+)" (design §2.2). The channels are stored and marked; the
 * filter is a question of the search, not of the import — the same
 * decision the cinema server took in phase C2.
 */
const ADULT_MARK = /\(18\+\)/i;

/**
 * One channel, ready to be written.
 */
export interface MergedChannel {
  channelId: string;
  /** EPG display-name, else playlist name. */
  name: string;
  playlistName: string | null;
  groupTitle: string | null;
  streamUrl: string | null;
  archiveDays: number;
  catchupType: string | null;
  logoUrl: string | null;
  isAdult: boolean;
  /**
   * The name without the quality and the time-shift marks, normalised.
   *
   * Phase T1 wrote the normalised name; phase T2 writes the family key
   * (the name without the marks of the copies).
   */
  familyKey: string;
}

/**
 * True when a group or a name marks an adult channel.
 */
export function isAdultChannel(group: string | null, name: string): boolean {
  return ADULT_MARK.test(group ?? '') || ADULT_MARK.test(name);
}

/**
 * What the group of a channel says.
 *
 * The answer is kept: the guide holds a few dozen groups and a thousand
 * channels, and the group of a channel is asked for every programme of
 * the import.
 */
export class GroupFactsCache {
  private readonly facts = new Map<string, GroupFacts>();
  private readonly options: ImportOptions;

  constructor(options: ImportOptions) {
    this.options = options;
  }

  /**
   * What the group of a channel says.
   */
  of(group: string | null): GroupFacts {
    const key = group ?? '';
    const cached = this.facts.get(key);
    if (cached !== undefined) return cached;

    const facts = resolveGroup(group, this.options.groupMap);
    this.facts.set(key, facts);
    return facts;
  }

  /**
   * The theme of a channel, from its group.
   */
  themeOf(group: string | null): Theme | null {
    return this.of(group).theme;
  }
}

/**
 * Write the channels of the import.
 *
 * The groups that are not loaded at all are left out, and the theme, the
 * region, the quality, the time shift and the family key of the rest are
 * written with them.
 *
 * @returns the number of the channels that were left out.
 */
export function writeChannelRows(
  db: Db,
  channels: Iterable<MergedChannel>,
  groups: GroupFactsCache,
  isExcluded: (group: string | null) => boolean,
): number {
  const statement = db.statement(
    `INSERT INTO channels (
       channel_id, name, playlist_name, group_title, theme, region,
       timeshift_h, quality, family_key, stream_url, archive_days,
       catchup_type, logo_url, is_adult
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let dropped = 0;

  for (const channel of channels) {
    if (isExcluded(channel.groupTitle)) {
      dropped += 1;
      continue;
    }

    const group = groups.of(channel.groupTitle);
    // The time shift comes from the group ("Россия +2ч") or from the
    // name of the channel ("Первый канал (+2)").
    const shift = Math.max(group.timeshiftHours, timeshiftHours(channel.name));

    statement.run(
      channel.channelId,
      channel.name,
      channel.playlistName,
      channel.groupTitle,
      group.theme,
      group.region,
      shift,
      channelQuality(channel.name),
      channel.familyKey,
      channel.streamUrl,
      channel.archiveDays,
      channel.catchupType,
      channel.logoUrl,
      channel.isAdult ? 1 : 0,
    );
  }

  return dropped;
}
