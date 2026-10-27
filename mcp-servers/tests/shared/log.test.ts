import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { Logger, formatValue } from '../../src/shared/log.ts';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'iptv-mcp-log-'));
}

describe('Logger', () => {
  it('writes a line to the log file', () => {
    const dir = tempDir();
    const path = join(dir, 'logs', 'server.log');

    const logger = new Logger(path, 'info');
    logger.info('the catalogue was read');

    const written = readFileSync(path, 'utf8');
    assert.match(written, /INFO/);
    assert.match(written, /the catalogue was read/);
    rmSync(dir, { recursive: true, force: true });
  });

  it('masks the URLs of a message', () => {
    const dir = tempDir();
    const path = join(dir, 'logs', 'server.log');

    const logger = new Logger(path, 'info');
    logger.info('loading https://s03.example.invalid/hls/abc123.m3u8?token=SECRET');

    const written = readFileSync(path, 'utf8');
    assert.ok(!written.includes('SECRET'), written);
    assert.ok(!written.includes('abc123'), written);
    assert.match(written, /loading/);
    rmSync(dir, { recursive: true, force: true });
  });

  it('masks a URL with an upper case scheme', () => {
    const dir = tempDir();
    const path = join(dir, 'logs', 'server.log');

    const logger = new Logger(path, 'info');
    logger.info('loading HTTP://s03.example.invalid/hls/abc123.m3u8?token=SECRET');

    const written = readFileSync(path, 'utf8');
    assert.ok(!written.includes('SECRET'), written);
    assert.ok(!written.includes('abc123'), written);
    rmSync(dir, { recursive: true, force: true });
  });

  it('skips a message that is below the level', () => {
    const dir = tempDir();
    const path = join(dir, 'logs', 'server.log');

    const logger = new Logger(path, 'warn');
    logger.debug('not written');
    logger.info('not written either');
    logger.warn('written');

    const written = readFileSync(path, 'utf8');
    assert.ok(!written.includes('not written'), written);
    assert.match(written, /written/);
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes one line for a message with a line break', () => {
    const dir = tempDir();
    const path = join(dir, 'logs', 'server.log');

    const logger = new Logger(path, 'info');
    logger.info('first line\nsecond line\r\nthird line');

    const written = readFileSync(path, 'utf8');
    assert.equal(written.trimEnd().split('\n').length, 1);
    assert.ok(!written.includes('second line\r'), written);
    rmSync(dir, { recursive: true, force: true });
  });

  it('never writes to stdout', () => {
    const dir = tempDir();
    const path = join(dir, 'logs', 'server.log');

    const written: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      written.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write;

    try {
      const logger = new Logger(path, 'debug');
      logger.error('something went wrong');
      logger.info('all good');
    } finally {
      process.stdout.write = original;
    }

    assert.deepEqual(written, []);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('formatValue', () => {
  it('formats the value types', () => {
    assert.equal(formatValue('text'), 'text');
    assert.equal(formatValue(42), '42');
    assert.equal(formatValue(true), 'true');
    assert.equal(formatValue(null), '');
    assert.equal(formatValue(undefined), '');
    assert.equal(formatValue({ a: 1 }), '{"a":1}');
  });
});
