/**
 * playlist.ts - the live-channel playlist (M3U).
 *
 * The provider's live playlist is an M3U with a header that carries the
 * attributes of the whole file (`url-tvg`, `x-tvg-url`, `catchup-type`)
 * and one `#EXTINF` block per channel: `group-title`, `tvg-id`,
 * `tvg-logo`, `tvg-rec`, the name after the last comma, an `#EXTGRP` line
 * and the stream URL (design: tv-guide-server.md §2.2).
 *
 * The web app's `parseLiveM3u` (public/scripts/utils/m3uParser.js:418) is
 * the reference: it skips the header and `#EXTGRP` and reads neither
 * `group-title` nor `catchup-type`. This reader keeps them, because the
 * server needs the groups, the archive depth and the catch-up type
 * (design §5 step 1).
 *
 * Variants of the playlist that have to keep working:
 * - `tmp/list.m3u` has no `#EXTGRP` lines;
 * - `tmp/playlist_mpegts.m3u` has a bare `#EXTM3U` header (no attributes)
 *   and MPEG-TS URLs.
 */

import {
  hasM3uHeader,
  parseAttributeString,
  parseExtInfLine,
  parseM3uText,
  stripBom,
} from '../shared/m3u.ts';

/** One channel of the playlist. */
export interface PlaylistChannel {
  /** The `tvg-id`: the key the EPG is joined on. */
  tvgId: string;
  /** The name after the last comma of the `#EXTINF` line. */
  name: string;
  /** The `group-title` attribute, else the `#EXTGRP` line. */
  group: string;
  /** The `tvg-logo`. */
  logo: string;
  /** The `tvg-rec`: the archive depth in days. */
  tvgRec: number;
  /** The stream line, as it was written. */
  streamUrl: string;
  /** A per-channel `catchup-type` attribute, when the channel carries one. */
  catchupType: string;
}

/** The parsed playlist. */
export interface ParsedPlaylist {
  /** Attributes of the `#EXTM3U` header line. */
  header: Record<string, string>;
  channels: PlaylistChannel[];
  /** Blocks without a `tvg-id`: they cannot be joined to the guide. */
  skippedNoTvgId: number;
  /** Blocks with a `tvg-id` that was already seen: the first one wins. */
  duplicates: number;
  /** Blocks that had no stream line. */
  incomplete: number;
}

/**
 * True when the text starts with the `#EXTM3U` header.
 *
 * The content check of the download (design §9) uses the same rule.
 */
export function validatePlaylistText(text: string): string | null {
  if (!hasM3uHeader(text)) {
    return 'the file does not start with #EXTM3U';
  }
  return null;
}

/**
 * Read a live-channel playlist.
 */
export function parsePlaylist(text: string): ParsedPlaylist {
  const document = parseM3uText(text);
  const playlist: ParsedPlaylist = {
    header: document.header,
    channels: [],
    skippedNoTvgId: 0,
    duplicates: 0,
    incomplete: document.incomplete,
  };

  const seen = new Set<string>();

  for (const entry of document.entries) {
    const attributes = entry.attributes;
    const tvgId = (attributes['tvg-id'] ?? '').trim();

    if (!tvgId) {
      playlist.skippedNoTvgId += 1;
      continue;
    }
    if (seen.has(tvgId)) {
      playlist.duplicates += 1;
      continue;
    }
    seen.add(tvgId);

    // The name is the part of the `#EXTINF` line after the last comma
    // outside quotes; the shared reader has already split it.
    const rec = Number.parseInt(attributes['tvg-rec'] ?? '', 10);

    playlist.channels.push({
      tvgId,
      name: entry.title,
      // When `group-title` is missing, the `#EXTGRP` line gives the group
      // (design §5 step 1). The cinema reader keeps both separately.
      group: (attributes['group-title'] ?? entry.group ?? '').trim(),
      logo: (attributes['tvg-logo'] ?? '').trim(),
      tvgRec: Number.isFinite(rec) && rec > 0 ? rec : 0,
      streamUrl: entry.streamLine ?? '',
      catchupType: (attributes['catchup-type'] ?? '').trim(),
    });
  }

  return playlist;
}

/**
 * The EPG URL that the header of the playlist offers.
 *
 * The setting `epgUrl` wins; when it is empty, the first http/https value
 * of `url-tvg` or `x-tvg-url` is used (design §5 step 2). The function
 * returns the header candidates in their order; the caller decides.
 */
export function epgUrlsFromHeader(header: Record<string, string>): string[] {
  const candidates: string[] = [];
  for (const key of ['url-tvg', 'x-tvg-url']) {
    const raw = header[key] ?? '';
    const trimmed = stripBom(raw).trim();
    if (!trimmed) continue;
    // A header may carry several URLs separated by commas; every
    // http/https candidate is a possible source, the first one wins.
    for (const part of trimmed.split(',')) {
      const url = part.trim();
      if (/^https?:\/\//i.test(url)) candidates.push(url);
    }
  }
  return candidates;
}

/**
 * The catch-up type that the header of the playlist declares.
 */
export function catchupTypeFromHeader(header: Record<string, string>): string {
  return (header['catchup-type'] ?? '').trim();
}

/**
 * Parse the header line of an M3U file without reading the rest.
 *
 * The EPG URL may be resolved from the header before the whole file is in;
 * the caller of the import reads the file anyway, so this is only used by
 * the tests and by the real-data script.
 */
export function parseM3uHeader(text: string): Record<string, string> {
  const withoutBom = stripBom(text);
  const firstLine = withoutBom.split(/\r?\n/, 1)[0]?.trim() ?? '';
  if (!firstLine.startsWith('#EXTM3U')) return {};
  return parseAttributeString(firstLine);
}

/**
 * The attributes of one `#EXTINF` line, for tests and tooling.
 */
export function parsePlaylistEntryLine(line: string): {
  attributes: Record<string, string>;
  title: string;
} {
  const parsed = parseExtInfLine(line);
  return { attributes: parsed.attributes, title: parsed.title };
}
