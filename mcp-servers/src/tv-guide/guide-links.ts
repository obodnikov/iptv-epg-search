/**
 * guide-links.ts - the Watch Live and Catch-up links of the guide.
 *
 * The rule of the catch-up is ported from the web app
 * (`public/scripts/components/results.js`, `showProgramModal`, the catch-up
 * button) and follows the behaviour probed at the provider
 * (docs/design/live-tv-playback-plan.md §5):
 *
 * - only the `shift` type is supported, the type the provider sends in the
 *   playlist header (`catchup-type="shift"`);
 * - a link carries `utc=<start>` and `lutc=<now>`; the query parameters the
 *   stream URL already has are kept;
 * - no stop time is sent: the external player rolls on into the next
 *   programme (plan §3.2);
 * - every URL passes the http(s) check before it leaves, and the built URL
 *   passes it again - the check is never relaxed.
 *
 * The link is built at call time, in `get_program` only: the provider was
 * probed with `lutc` of the moment of the request, and the archive window
 * moves with the day.
 */

import { sanitizeUrl } from '../shared/links.ts';

/** The catch-up type the links are built for. */
export const SUPPORTED_CATCHUP_TYPE = 'shift';

/**
 * Why there is no catch-up link.
 *
 * The reasons are sentences for the model: they name what is missing and
 * what could be done about it.
 */
export type CatchupReason =
  | 'no_stream'
  | 'no_archive'
  | 'unsupported_type'
  | 'not_ended'
  | 'outside_window'
  | 'url_rejected';

/** The sentence of a reason, for the answers. */
export const CATCHUP_REASONS: Record<CatchupReason, string> = {
  no_stream: 'The channel has no stream, so there is no live or catch-up link.',
  no_archive: 'The channel has no archive (tvg-rec is 0).',
  unsupported_type: 'Archive exists, but this catch-up type is not supported.',
  not_ended: 'The programme has not ended yet, so there is no catch-up link.',
  outside_window: 'The programme is older than the archive window of the channel.',
  url_rejected: 'The stream URL was refused: it is not an http(s) URL.',
};

/** The facts of a channel that a link needs. */
export interface ChannelLinkFacts {
  /** The stream URL, or null when the channel has none. */
  stream_url: string | null;
  /** The depth of the archive, in days. */
  archive_days: number;
  /** The catch-up type of the channel, else of the playlist header. */
  catchup_type: string | null;
}

/** A built catch-up link, or the reason there is none. */
export type CatchupLink =
  | { ok: true; url: string; built_at: number }
  | { ok: false; reason: CatchupReason };

/**
 * True when a programme on this channel can be watched on catch-up at the
 * moment `now`.
 *
 * The same conditions the URL building below applies; the lists use this
 * test for `has_catchup`, and `only_catchup` uses it as a filter.
 */
export function catchupPossible(
  channel: ChannelLinkFacts,
  startUtc: number,
  stopUtc: number,
  now: number,
): boolean {
  if (!channel.stream_url) return false;
  if (channel.archive_days <= 0) return false;
  if (channel.catchup_type !== SUPPORTED_CATCHUP_TYPE) return false;
  if (stopUtc > now) return false;
  if (now - startUtc > channel.archive_days * 86400) return false;
  return true;
}

/**
 * Why a catch-up link cannot be built, as a reason.
 *
 * The order of the checks is the order of the ported rule: the stream, the
 * archive, the type, the times.
 */
export function catchupRefusal(
  channel: ChannelLinkFacts,
  startUtc: number,
  stopUtc: number,
  now: number,
): CatchupReason | null {
  if (!channel.stream_url) return 'no_stream';
  if (channel.archive_days <= 0) return 'no_archive';
  if (channel.catchup_type !== SUPPORTED_CATCHUP_TYPE) return 'unsupported_type';
  // A programme that reaches its stop at `now` is live (statusOf draws
  // the same line), so the last second is still not an archive case.
  if (stopUtc > now) return 'not_ended';
  if (now - startUtc > channel.archive_days * 86400) return 'outside_window';
  return null;
}

/**
 * Build the catch-up URL of a programme.
 *
 * The rule of the web app (`results.js`, showProgramModal): parse the
 * stream URL with the URL API, set `utc` and `lutc` as query parameters -
 * existing ones are kept - and check the result again.
 */
export function buildCatchupUrl(
  channel: ChannelLinkFacts,
  startUtc: number,
  stopUtc: number,
  now: number,
): CatchupLink {
  const refusal = catchupRefusal(channel, startUtc, stopUtc, now);
  if (refusal) return { ok: false, reason: refusal };

  const stream = sanitizeUrl(channel.stream_url);
  if (!stream) return { ok: false, reason: 'url_rejected' };

  // The stream URL of the provider is absolute; a URL that cannot be
  // parsed is refused, the way the web app wraps `new URL` in a try.
  let url: URL;
  try {
    url = new URL(stream);
  } catch {
    return { ok: false, reason: 'url_rejected' };
  }

  url.searchParams.set('utc', String(startUtc));
  url.searchParams.set('lutc', String(now));

  const built = sanitizeUrl(url.href);
  if (!built) return { ok: false, reason: 'url_rejected' };

  return { ok: true, url: built, built_at: now };
}

/**
 * The Watch Live URL of a channel.
 *
 * It is valid for any programme on a channel that has a stream, as the web
 * app decided (live-tv-playback-plan.md §4.3).
 */
export function buildWatchLiveUrl(streamUrl: string | null): string | null {
  if (!streamUrl) return null;
  return sanitizeUrl(streamUrl);
}
