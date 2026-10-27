/**
 * links.ts - URL sanitizing and masking.
 *
 * `sanitizeUrl` is a port of the web app's helper
 * (public/scripts/utils/sanitize.js:43). The rule is never relaxed: a link
 * that does not start with http:// or https:// is dropped, not rewritten.
 *
 * `maskUrl` hides the access key that the provider puts in the path or the
 * query of every stream URL (design: iptv-mcp-servers.md §5.4).
 */

/**
 * Sanitize a URL - only http:// and https:// are allowed.
 *
 * Ported from public/scripts/utils/sanitize.js:43 (web app). The one change:
 * the scheme is compared in lower case, so that "HTTP://…" is accepted like
 * `checkSourceUrl` accepts it. The set of allowed schemes is unchanged.
 *
 * @returns the trimmed URL, or null when the scheme is not allowed.
 */
export function sanitizeUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    return trimmed;
  }
  return null;
}

/** Shortest URL that still gets a tail shown; below this the whole URL is hidden. */
const MIN_LENGTH_FOR_TAIL = 16;

/**
 * Mask a URL for logs and status output: scheme, host and the last four
 * characters of the whole URL. The tail is what usually carries the access key.
 *
 * Example: `https://s03.example.invalid/hls/abc123.m3u8?token=f8b2`
 *      -> `https://s03.example.tv…/…f8b2`
 */
export function maskUrl(url: string | null | undefined): string {
  if (!url || typeof url !== 'string') return '(none)';
  const trimmed = url.trim();
  if (!trimmed) return '(none)';

  let protocol = '';
  let host = '';
  try {
    const parsed = new URL(trimmed);
    protocol = parsed.protocol;
    host = parsed.host;
  } catch {
    // Not a parsable URL: keep the scheme if there is one, hide the rest.
    const match = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:)\/\//);
    protocol = match?.[1] ?? '';
    host = '';
  }

  const prefix = host ? `${protocol}//${host}` : protocol;
  if (trimmed.length < MIN_LENGTH_FOR_TAIL) {
    return `${prefix}/…`;
  }
  return `${prefix}…/…${trimmed.slice(-4)}`;
}

/**
 * Mask every URL in a string, so a log line can never leak a key.
 * The scheme is matched in any case, like `sanitizeUrl` accepts it.
 */
export function maskUrlsInText(text: string): string {
  return text.replace(/https?:\/\/[^\s"'<>]+/gi, (match) => maskUrl(match));
}
