import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  downloadToFile,
  fileSize,
  hashFile,
  isAcceptableRedirect,
  readRawMeta,
  replaceFile,
  urlScheme,
  writeRawMeta,
} from '../../src/shared/download.ts';

let server: Server;
let origin = '';

const CONTENT = '#EXTM3U\n#EXTINF:100, Title\nhttp://example.invalid/1.m3u8\n';

before(async () => {
  server = createServer((request, response) => {
    const path = request.url ?? '/';
    if (path === '/ok') {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      response.end(CONTENT);
      return;
    }
    if (path === '/login') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<html><body>please log in</body></html>');
      return;
    }
    if (path === '/redirect') {
      response.writeHead(302, { Location: '/ok' });
      response.end();
      return;
    }
    if (path === '/redirect-file') {
      response.writeHead(302, { Location: 'file:///etc/passwd' });
      response.end();
      return;
    }
    if (path === '/redirect-loop') {
      response.writeHead(302, { Location: '/redirect-loop' });
      response.end();
      return;
    }
    if (path === '/empty') {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      response.end();
      return;
    }
    if (path === '/slow') {
      setTimeout(() => {
        response.writeHead(200);
        response.end(CONTENT);
      }, 2_000);
      return;
    }
    response.writeHead(500);
    response.end('no');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address && typeof address === 'object') {
    origin = `http://127.0.0.1:${address.port}`;
  }
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'iptv-mcp-download-'));
}

describe('urlScheme', () => {
  it('reads the scheme', () => {
    assert.equal(urlScheme('https://example.invalid/a'), 'https:');
    assert.equal(urlScheme('HTTP://example.invalid/a'), 'http:');
  });

  it('returns an empty string for a broken URL', () => {
    assert.equal(urlScheme('not a url'), '');
  });
});

describe('isAcceptableRedirect', () => {
  it('allows http and https', () => {
    assert.equal(isAcceptableRedirect('http:', 'http:'), true);
    assert.equal(isAcceptableRedirect('http:', 'https:'), true);
    assert.equal(isAcceptableRedirect('https:', 'https:'), true);
  });

  it('refuses a downgrade from https to http', () => {
    assert.equal(isAcceptableRedirect('https:', 'http:'), false);
  });

  it('refuses a scheme that is not http(s)', () => {
    assert.equal(isAcceptableRedirect('https:', 'file:'), false);
    assert.equal(isAcceptableRedirect('http:', ''), false);
  });
});

describe('downloadToFile', () => {
  it('writes the file to the destination and leaves no part file', async () => {
    const dir = tempDir();
    const dest = join(dir, 'catalog.m3u');

    const result = await downloadToFile({ url: `${origin}/ok`, destPath: dest });

    assert.equal(result.ok, true);
    assert.equal(result.path, dest);
    assert.equal(readFileSync(dest, 'utf8'), CONTENT);
    assert.equal(existsSync(`${dest}.part`), false);
    assert.equal(result.bytes, Buffer.byteLength(CONTENT));
    assert.match(result.sha256, /^[0-9a-f]{64}$/);
    rmSync(dir, { recursive: true, force: true });
  });

  it('replaces the previous copy', async () => {
    const dir = tempDir();
    const dest = join(dir, 'catalog.m3u');
    writeFileSync(dest, 'old content');

    const result = await downloadToFile({ url: `${origin}/ok`, destPath: dest });

    assert.equal(result.ok, true);
    assert.equal(readFileSync(dest, 'utf8'), CONTENT);
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps the previous copy when the provider fails', async () => {
    const dir = tempDir();
    const dest = join(dir, 'catalog.m3u');
    writeFileSync(dest, 'old content');

    const result = await downloadToFile({ url: `${origin}/fail`, destPath: dest });

    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /500/);
    assert.equal(readFileSync(dest, 'utf8'), 'old content');
    assert.equal(existsSync(`${dest}.part`), false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps the previous copy when the provider sends an empty file', async () => {
    const dir = tempDir();
    const dest = join(dir, 'catalog.m3u');
    writeFileSync(dest, 'old content');

    const result = await downloadToFile({ url: `${origin}/empty`, destPath: dest });

    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /empty/);
    assert.equal(readFileSync(dest, 'utf8'), 'old content');
    assert.equal(existsSync(`${dest}.part`), false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('makes the downloaded file readable for its owner only', async () => {
    if (process.platform === 'win32') return;
    const dir = tempDir();
    const dest = join(dir, 'catalog.m3u');

    await downloadToFile({ url: `${origin}/ok`, destPath: dest });

    assert.equal(statSync(dest).mode & 0o777, 0o600);
    rmSync(dir, { recursive: true, force: true });
  });

  it('tightens a part file that was left behind', async () => {
    if (process.platform === 'win32') return;
    const dir = tempDir();
    const dest = join(dir, 'catalog.m3u');
    // A part file of an earlier run that was left with wider rights.
    writeFileSync(`${dest}.part`, 'old part', { mode: 0o644 });
    chmodSync(`${dest}.part`, 0o644);

    await downloadToFile({ url: `${origin}/ok`, destPath: dest });

    assert.equal(statSync(dest).mode & 0o777, 0o600);
    assert.equal(readFileSync(dest, 'utf8'), CONTENT);
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses a redirect to a scheme that is not http(s)', async () => {
    const dir = tempDir();
    const dest = join(dir, 'catalog.m3u');
    writeFileSync(dest, 'old content');

    const result = await downloadToFile({ url: `${origin}/redirect-file`, destPath: dest });

    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /redirect/);
    // The target of the refused redirect is never requested.
    assert.equal(readFileSync(dest, 'utf8'), 'old content');
    assert.equal(existsSync(`${dest}.part`), false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('gives up after too many redirects', async () => {
    const dir = tempDir();
    const dest = join(dir, 'catalog.m3u');

    const result = await downloadToFile({ url: `${origin}/redirect-loop`, destPath: dest });

    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /redirect/);
    assert.equal(existsSync(dest), false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('follows a redirect', async () => {
    const dir = tempDir();
    const dest = join(dir, 'catalog.m3u');

    const result = await downloadToFile({ url: `${origin}/redirect`, destPath: dest });

    assert.equal(result.ok, true);
    assert.equal(readFileSync(dest, 'utf8'), CONTENT);
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves the next request after a failed one', async () => {
    const dir = tempDir();
    const dest = join(dir, 'catalog.m3u');

    const failed = await downloadToFile({ url: `${origin}/fail`, destPath: dest });
    assert.equal(failed.ok, false);

    // The failed request must not hold the connection of the server.
    const good = await downloadToFile({ url: `${origin}/ok`, destPath: dest });
    assert.equal(good.ok, true);
    assert.equal(readFileSync(dest, 'utf8'), CONTENT);
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps the last good copy when the content is refused', async () => {
    const dir = tempDir();
    const dest = join(dir, 'catalog.m3u');
    writeFileSync(dest, 'old content');

    const result = await downloadToFile({
      url: `${origin}/login`,
      destPath: dest,
      // The provider answered with a login page instead of the catalogue.
      validate: (head) => (head.startsWith('#EXTM3U') ? null : 'the file is not a catalogue'),
    });

    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /not a catalogue/);
    // The last good copy is untouched.
    assert.equal(readFileSync(dest, 'utf8'), 'old content');
    assert.equal(existsSync(`${dest}.part`), false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('replaces the file when the content is good', async () => {
    const dir = tempDir();
    const dest = join(dir, 'catalog.m3u');
    writeFileSync(dest, 'old content');

    const result = await downloadToFile({
      url: `${origin}/ok`,
      destPath: dest,
      validate: (head) => (head.startsWith('#EXTM3U') ? null : 'the file is not a catalogue'),
    });

    assert.equal(result.ok, true);
    assert.equal(readFileSync(dest, 'utf8'), CONTENT);
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps two downloads apart', async () => {
    const dir = tempDir();
    const dest = join(dir, 'catalog.m3u');

    // Two downloads to the same place at the same time must not write into
    // the same part file.
    const [first, second] = await Promise.all([
      downloadToFile({ url: `${origin}/ok`, destPath: dest }),
      downloadToFile({ url: `${origin}/ok`, destPath: dest }),
    ]);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    // The file holds one of the two downloads, not a mix of both.
    assert.equal(readFileSync(dest, 'utf8'), CONTENT);
    // No part file is left behind.
    const leftovers = readdirSync(dir).filter((name) => name.endsWith('.part'));
    assert.deepEqual(leftovers, []);
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses a URL that is not http(s)', async () => {
    const dir = tempDir();
    const dest = join(dir, 'catalog.m3u');

    const result = await downloadToFile({ url: 'file:///etc/passwd', destPath: dest });

    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /not http/);
    assert.equal(existsSync(dest), false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses a URL that cannot be read', async () => {
    const dir = tempDir();
    const dest = join(dir, 'catalog.m3u');

    const result = await downloadToFile({ url: 'not a url', destPath: dest });

    assert.equal(result.ok, false);
    assert.equal(existsSync(dest), false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('gives up after the timeout', async () => {
    const dir = tempDir();
    const dest = join(dir, 'catalog.m3u');

    const result = await downloadToFile({ url: `${origin}/slow`, destPath: dest, timeoutMs: 200 });

    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /download failed/);
    assert.equal(existsSync(`${dest}.part`), false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports a directory that does not exist instead of crashing', async () => {
    const dir = tempDir();
    const dest = join(dir, 'missing', 'catalog.m3u');

    const result = await downloadToFile({ url: `${origin}/ok`, destPath: dest });

    assert.equal(result.ok, false);
    assert.ok(result.error);
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports a write failure instead of hanging', { timeout: 15_000 }, async () => {
    const dir = tempDir();
    // The parent of the target is a file, so opening the file cannot work.
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, 'not a directory');
    const dest = join(blocker, 'catalog.m3u');

    const result = await downloadToFile({ url: `${origin}/ok`, destPath: dest });

    assert.equal(result.ok, false);
    assert.ok(result.error);
    rmSync(dir, { recursive: true, force: true });
  });

  it('stops a file that is larger than the limit', { timeout: 15_000 }, async () => {
    const dir = tempDir();
    const dest = join(dir, 'catalog.m3u');

    const result = await downloadToFile({ url: `${origin}/ok`, destPath: dest, maxBytes: 4 });

    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /larger than/);
    assert.equal(existsSync(dest), false);
    assert.equal(existsSync(`${dest}.part`), false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('replaceFile', () => {
  it('replaces a file on Unix', async () => {
    const dir = tempDir();
    const source = join(dir, 'new.m3u');
    const destination = join(dir, 'catalog.m3u');
    writeFileSync(source, 'new');
    writeFileSync(destination, 'old');

    await replaceFile(source, destination);

    assert.equal(readFileSync(destination, 'utf8'), 'new');
    assert.equal(existsSync(source), false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps the old file when the fallback fails', async () => {
    const dir = tempDir();
    const source = join(dir, 'new.m3u');
    const destination = join(dir, 'catalog.m3u');
    writeFileSync(source, 'new');
    writeFileSync(destination, 'old');

    // The rename of the source fails with EPERM (Windows), the rename of the
    // copy into place fails too. The old file has to survive.
    let calls = 0;
    const failingRename = (async (from: string, to: string) => {
      calls += 1;
      if (calls === 1) {
        const error = new Error('EPERM') as NodeJS.ErrnoException;
        error.code = 'EPERM';
        throw error;
      }
      if (calls === 3) {
        const error = new Error('EPERM') as NodeJS.ErrnoException;
        error.code = 'EPERM';
        throw error;
      }
      return rename(from, to);
    }) as typeof rename;

    await assert.rejects(() => replaceFile(source, destination, failingRename));

    assert.equal(readFileSync(destination, 'utf8'), 'old');
    assert.equal(existsSync(`${destination}.copy`), false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps the old file when the destination cannot be replaced', async () => {
    const dir = tempDir();
    const source = join(dir, 'new.m3u');
    const destination = join(dir, 'catalog.m3u');
    writeFileSync(source, 'new');
    // The destination is a folder: nothing may be lost.
    mkdirSync(destination);

    await assert.rejects(() => replaceFile(source, destination));

    assert.equal(existsSync(destination), true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('the raw metadata', () => {
  it('writes and reads the metadata of the last good download', async () => {
    const dir = tempDir();
    const path = join(dir, 'meta.json');

    await writeRawMeta(path, {
      fetched_at: 1_700_000_000,
      sha256: 'abc123',
      bytes: 4096,
      url_hash: 'def456',
    });

    const meta = await readRawMeta(path);
    assert.deepEqual(meta, {
      fetched_at: 1_700_000_000,
      sha256: 'abc123',
      bytes: 4096,
      url_hash: 'def456',
    });
    rmSync(dir, { recursive: true, force: true });
  });

  it('makes the metadata readable for its owner only', async () => {
    if (process.platform === 'win32') return;
    const dir = tempDir();
    const path = join(dir, 'meta.json');
    writeFileSync(path, '{"sha256":"x","fetched_at":1}', { mode: 0o644 });
    chmodSync(path, 0o644);

    await writeRawMeta(path, { fetched_at: 1, sha256: 'abc', bytes: 1, url_hash: 'def' });

    assert.equal(statSync(path).mode & 0o777, 0o600);
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null for a file that is missing', async () => {
    const dir = tempDir();
    assert.equal(await readRawMeta(join(dir, 'nothing.json')), null);
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null for a file that is broken', async () => {
    const dir = tempDir();
    const path = join(dir, 'meta.json');
    writeFileSync(path, 'not json');

    assert.equal(await readRawMeta(path), null);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('hashFile and fileSize', () => {
  it('hashes a file', async () => {
    const dir = tempDir();
    const path = join(dir, 'catalog.m3u');
    writeFileSync(path, CONTENT);

    const hash = await hashFile(path);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(hash, createHash('sha256').update(CONTENT).digest('hex'));
    rmSync(dir, { recursive: true, force: true });
  });

  it('counts the bytes of a file', async () => {
    const dir = tempDir();
    const path = join(dir, 'catalog.m3u');
    writeFileSync(path, CONTENT);

    assert.equal(await fileSize(path), Buffer.byteLength(CONTENT));
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports zero for a file that does not exist', async () => {
    const dir = tempDir();
    assert.equal(await fileSize(join(dir, 'nothing.m3u')), 0);
    rmSync(dir, { recursive: true, force: true });
  });
});
