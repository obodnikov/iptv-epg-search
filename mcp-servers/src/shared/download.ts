/**
 * download.ts - fetch a source file into the working folder.
 *
 * Rules:
 * - GET only, with a timeout and a size limit;
 * - the `User-Agent` the web app's proxy sends
 *   (public/api/proxy.js:36-38), because some providers answer differently
 *   to an unknown client;
 * - the file is written to `<name>.part` first and only renamed when the
 *   download finished, so the last good copy survives a broken download
 *   (design: iptv-mcp-servers.md §6.4 step 2);
 * - the metadata file holds the sha256 and the byte count, never the URL.
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, open, rename, rm, stat, writeFile, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { sha256 } from './hash.ts';
import { maskUrl } from './links.ts';
import { hardenFile, isPrivateFile } from './permissions.ts';

export { hardenFile, isPrivateFile } from './permissions.ts';
export { sha256 } from './hash.ts';

export const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; IPTV-EPG-Search/1.0)';
export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;

/**
 * How many redirects may be followed.
 */
export const MAX_REDIRECTS = 5;

/**
 * How many bytes of the file the check sees.
 */
export const VALIDATE_HEAD_BYTES = 64 * 1024;

export interface DownloadOptions {
  /** Source URL. Must be http or https. */
  url: string;
  /** Where the finished file goes, e.g. `<data-dir>/raw/catalog.m3u`. */
  destPath: string;
  timeoutMs?: number;
  maxBytes?: number;
  userAgent?: string;
  /**
   * A check on the beginning of the file. It gets the first bytes of the
   * download and returns null when the file is good, or the reason why it is
   * not. A file that fails the check does not replace the last good copy.
   */
  validate?: (head: string) => string | null;
}

export interface DownloadResult {
  ok: boolean;
  /** Absolute path of the downloaded file. */
  path: string;
  bytes: number;
  sha256: string;
  /** Epoch milliseconds of the download. */
  fetchedAt: number;
  error?: string;
  /**
   * A note about the file that was written. The download is good, but
   * something is not as it should be — for example the file is readable for
   * everybody although it should not be.
   */
  warning?: string;
}

export interface RawMeta {
  fetched_at: number;
  sha256: string;
  bytes: number;
  /** sha256 of the URL: the URL itself is never written down. */
  url_hash: string;
  /**
   * sha256 of the settings that change what is imported.
   *
   * A download that did not change is not imported again — unless the
   * settings changed too, because then the database holds something else
   * than the provider would send.
   */
  settings_hash?: string;
}

/**
 * The scheme of a URL, or an empty string when it cannot be read.
 */
export function urlScheme(url: string): string {
  try {
    return new URL(url).protocol.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Cancel the body of a response that is not used.
 * A long-running server would otherwise hold the socket open until the
 * garbage collector comes.
 */
async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The body may already be closed.
  }
}

/**
 * Remove a file and swallow every error: the part file may be gone already,
 * or its folder may not be a folder at all.
 */
async function removeQuietly(path: string): Promise<void> {
  try {
    await rm(path, { force: true });
  } catch {
    // Nothing to do.
  }
}

/**
 * True when a redirect may be followed.
 *
 * The target has to be http(s), and an https source must not end up on
 * http: the body and the token in the URL would travel in the clear.
 */
export function isAcceptableRedirect(sourceScheme: string, finalScheme: string): boolean {
  if (finalScheme !== 'http:' && finalScheme !== 'https:') return false;
  if (sourceScheme === 'https:' && finalScheme === 'http:') return false;
  return true;
}

/**
 * Replace a file with another one.
 *
 * `rename` cannot replace an existing file on Windows. There the new file is
 * copied next to the old one first, and the old file is moved aside before
 * the new one takes its place. If any step fails, the old file is put back:
 * the last good copy must never disappear. When even the restore fails, the
 * old file stays on disk as `<destination>.bak`.
 */
export async function replaceFile(
  source: string,
  destination: string,
  renameFn: typeof rename = rename,
): Promise<void> {
  try {
    await renameFn(source, destination);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'ENOTEMPTY') throw error;
  }

  const copy = `${destination}.copy`;
  const backup = `${destination}.bak`;

  await copyFile(source, copy);

  let moved = false;
  try {
    await renameFn(destination, backup);
    moved = true;
    await renameFn(copy, destination);
  } catch (error) {
    if (moved) {
      // Put the old file back: it is the last good copy.
      try {
        await renameFn(backup, destination);
      } catch {
        // The restore failed too: the copy of the old file is used.
        try {
          await copyFile(backup, destination);
          await removeQuietly(backup);
        } catch {
          // The backup stays on disk as `<destination>.bak`.
        }
      }
    }
    await removeQuietly(copy);
    throw error;
  }

  await removeQuietly(backup);
  await removeQuietly(source);
}

/**
 * Read the first bytes of a file as text.
 */
async function readHead(path: string, bytes: number): Promise<string> {
  try {
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(bytes);
      const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
      return buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return '';
  }
}

/**
 * Download a URL to a file.
 *
 * The file is written to `<destPath>.part` and renamed on success; on failure
 * the part file is removed and the previous file stays untouched.
 */
export async function downloadToFile(options: DownloadOptions): Promise<DownloadResult> {
  const {
    url,
    destPath,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    userAgent = DEFAULT_USER_AGENT,
    validate,
  } = options;

  const partPath = `${destPath}.${randomBytes(6).toString('hex')}.part`;

  // Only http(s) is fetched. The settings file is checked as well, but the
  // downloader does not rely on that.
  const scheme = urlScheme(url);
  if (scheme !== 'http:' && scheme !== 'https:') {
    return {
      ok: false,
      path: destPath,
      bytes: 0,
      sha256: '',
      fetchedAt: Date.now(),
      error: `refused to download a URL that is not http(s): ${maskUrl(url)}`,
    };
  }

  let response: Response;
  let currentUrl = url;
  let currentScheme = scheme;

  // The redirects are followed by hand: `redirect: 'follow'` would request
  // the target of an https -> http redirect before the check could see it,
  // and the token in the URL would travel in the clear.
  for (let hop = 0; ; hop++) {
    try {
      response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'User-Agent': userAgent,
          Accept: '*/*',
        },
      });
    } catch (error) {
      return {
        ok: false,
        path: destPath,
        bytes: 0,
        sha256: '',
        fetchedAt: Date.now(),
        error: `download failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const location = response.headers.get('location');
    const isRedirect = response.status >= 300 && response.status < 400 && location !== null;

    if (!isRedirect) break;

    if (hop >= MAX_REDIRECTS) {
      await cancelBody(response);
      return {
        ok: false,
        path: destPath,
        bytes: 0,
        sha256: '',
        fetchedAt: Date.now(),
        error: `too many redirects (more than ${MAX_REDIRECTS})`,
      };
    }

    let nextUrl: string;
    try {
      nextUrl = new URL(location, currentUrl).toString();
    } catch {
      await cancelBody(response);
      return {
        ok: false,
        path: destPath,
        bytes: 0,
        sha256: '',
        fetchedAt: Date.now(),
        error: 'the provider sent a redirect to a broken URL',
      };
    }

    const nextScheme = urlScheme(nextUrl);
    if (!isAcceptableRedirect(currentScheme, nextScheme)) {
      await cancelBody(response);
      return {
        ok: false,
        path: destPath,
        bytes: 0,
        sha256: '',
        fetchedAt: Date.now(),
        error: `refused to follow a redirect to ${nextScheme || 'an unknown scheme'}: ${maskUrl(nextUrl)}`,
      };
    }

    await cancelBody(response);
    currentUrl = nextUrl;
    currentScheme = nextScheme;
  }

  if (!response.ok) {
    await cancelBody(response);
    return {
      ok: false,
      path: destPath,
      bytes: 0,
      sha256: '',
      fetchedAt: Date.now(),
      error: `provider answered ${response.status} ${response.statusText}`,
    };
  }

  // The redirects were followed by hand; the last hop was checked before it
  // was requested.
  if (!isAcceptableRedirect(scheme, currentScheme)) {
    await cancelBody(response);
    return {
      ok: false,
      path: destPath,
      bytes: 0,
      sha256: '',
      fetchedAt: Date.now(),
      error: `refused to download a redirect to a URL that is not http(s): ${maskUrl(currentUrl)}`,
    };
  }

  const body = response.body;
  if (!body) {
    await cancelBody(response);
    return {
      ok: false,
      path: destPath,
      bytes: 0,
      sha256: '',
      fetchedAt: Date.now(),
      error: 'provider sent an empty body',
    };
  }

  let bytes = 0;
  const hash = createHash('sha256');

  // The counter stops a file that is too large and feeds the hash.
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        callback(new Error(`file is larger than the ${maxBytes} byte limit`));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    // pipeline() ties the streams together: an error on any of them stops
    // the whole chain, destroys the streams and rejects. There is no path
    // that waits forever for an event that will not come.
    await pipeline(
      Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]),
      counter,
      createWriteStream(partPath, { mode: 0o600 }),
    );
  } catch (error) {
    await removeQuietly(partPath);
    return {
      ok: false,
      path: destPath,
      bytes,
      sha256: '',
      fetchedAt: Date.now(),
      error: `download failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // An empty body is not a catalogue. The last good copy has to survive it.
  if (bytes === 0) {
    await removeQuietly(partPath);
    return {
      ok: false,
      path: destPath,
      bytes: 0,
      sha256: '',
      fetchedAt: Date.now(),
      error: 'the provider sent an empty file',
    };
  }

  // The part file holds the access key of the provider: it is private
  // before it is put in place. The check comes before the swap, so that a
  // file that cannot be made private never replaces the last good copy.
  if (!(await hardenFile(partPath)) || !(await isPrivateFile(partPath))) {
    await removeQuietly(partPath);
    return {
      ok: false,
      path: destPath,
      bytes,
      sha256: '',
      fetchedAt: Date.now(),
      error: 'the downloaded file could not be made private',
    };
  }

  // The content is checked before the swap as well: a login page or an error
  // page of the provider must not replace a working catalogue.
  if (validate) {
    const head = await readHead(partPath, VALIDATE_HEAD_BYTES);
    const problem = validate(head);
    if (problem) {
      await removeQuietly(partPath);
      return {
        ok: false,
        path: destPath,
        bytes,
        sha256: '',
        fetchedAt: Date.now(),
        error: `the downloaded file was refused: ${problem}`,
      };
    }
  }

  // The file is complete: it replaces the previous copy.
  try {
    await replaceFile(partPath, destPath);
  } catch (error) {
    await removeQuietly(partPath);
    return {
      ok: false,
      path: destPath,
      bytes,
      sha256: '',
      fetchedAt: Date.now(),
      error: `download failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // The file was private before the swap and the swap keeps the mode. The
  // check afterwards is for the rare case that somebody changed it in
  // between: the file is complete and correct, so it stays where it is and
  // the caller is told.
  let warning: string | undefined;
  if (!(await isPrivateFile(destPath))) {
    warning = 'the downloaded file is not readable for its owner only';
  }

  return {
    ok: true,
    path: destPath,
    bytes,
    sha256: hash.digest('hex'),
    fetchedAt: Date.now(),
    ...(warning ? { warning } : {}),
  };
}

/**
 * sha256 of a file on disk. The file is read in pieces, so that a large
 * catalogue does not have to fit into the memory.
 */
export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

/**
 * Size of a file in bytes, or 0 when it does not exist.
 */
export async function fileSize(path: string): Promise<number> {
  try {
    const info = await stat(path);
    return info.size;
  } catch {
    return 0;
  }
}

/**
 * Read the metadata of the last good download.
 *
 * The file holds the hash of the source URL, never the URL itself, but it is
 * still made private.
 */
export async function readRawMeta(metaPath: string): Promise<RawMeta | null> {
  try {
    const text = await readFile(metaPath, 'utf8');
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const meta = parsed as Partial<RawMeta>;
    if (typeof meta.sha256 !== 'string' || typeof meta.fetched_at !== 'number') return null;
    await hardenFile(metaPath);
    return {
      fetched_at: meta.fetched_at,
      sha256: meta.sha256,
      bytes: typeof meta.bytes === 'number' ? meta.bytes : 0,
      url_hash: typeof meta.url_hash === 'string' ? meta.url_hash : '',
      ...(typeof meta.settings_hash === 'string'
        ? { settings_hash: meta.settings_hash }
        : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Write the metadata of the last good download.
 */
export async function writeRawMeta(metaPath: string, meta: RawMeta): Promise<void> {
  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o600 });
  await hardenFile(metaPath);
}
