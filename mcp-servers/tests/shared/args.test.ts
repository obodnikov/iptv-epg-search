import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, parse as parsePath, resolve } from 'node:path';
import { describe, it } from 'node:test';

import {
  DEFAULT_DATA_DIRS,
  dataPath,
  ensureDataDir,
  ensureLogDir,
  ensureRawDir,
  expandHome,
  parseArgs,
} from '../../src/shared/args.ts';

describe('expandHome', () => {
  it('expands a bare ~', () => {
    assert.equal(expandHome('~'), homedir());
  });

  it('expands a path that starts with ~/', () => {
    assert.equal(expandHome('~/folder'), resolve(homedir(), 'folder'));
  });

  it('leaves every other path alone', () => {
    assert.equal(expandHome('/tmp/folder'), '/tmp/folder');
    assert.equal(expandHome('relative/folder'), 'relative/folder');
    assert.equal(expandHome('~other/folder'), '~other/folder');
  });
});

describe('parseArgs', () => {
  it('reads --data-dir with a value', () => {
    const parsed = parseArgs(['--data-dir', join('/tmp', 'data')]);
    assert.equal(parsed.dataDir, resolve(join('/tmp', 'data')));
    assert.deepEqual(parsed.unknown, []);
    assert.equal(parsed.help, false);
  });

  it('reads --data-dir=VALUE', () => {
    const parsed = parseArgs([`--data-dir=${join('/tmp', 'data')}`]);
    assert.equal(parsed.dataDir, resolve(join('/tmp', 'data')));
  });

  it('expands a ~ in the data dir', () => {
    const parsed = parseArgs(['--data-dir', '~/.iptv-mcp/cinema']);
    assert.equal(parsed.dataDir, resolve(homedir(), '.iptv-mcp', 'cinema'));
  });

  it('reports a missing value', () => {
    const parsed = parseArgs(['--data-dir']);
    assert.equal(parsed.dataDir, '');
    assert.deepEqual(parsed.unknown, ['--data-dir']);
  });

  it('does not take another flag as the folder', () => {
    const parsed = parseArgs(['--data-dir', '--help']);
    assert.equal(parsed.dataDir, '');
    assert.deepEqual(parsed.unknown, ['--data-dir']);
    assert.equal(parsed.help, true);
  });

  it('reports the help flag', () => {
    const parsed = parseArgs(['--help']);
    assert.equal(parsed.help, true);
  });

  it('keeps the arguments it does not know', () => {
    const parsed = parseArgs(['--verbose', '--data-dir', join('/tmp', 'data')]);
    assert.deepEqual(parsed.unknown, ['--verbose']);
    assert.equal(parsed.dataDir, resolve(join('/tmp', 'data')));
  });

  it('has a default working folder for every server', () => {
    assert.equal(DEFAULT_DATA_DIRS.cinema, '~/.iptv-mcp/cinema');
    assert.equal(DEFAULT_DATA_DIRS['tv-guide'], '~/.iptv-mcp/tv-guide');
  });
});

describe('the working folder', () => {
  it('creates the folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'iptv-mcp-args-'));
    const target = join(dir, 'cinema');

    const created = ensureDataDir(target);

    assert.equal(created, resolve(target));
    assert.equal(existsSync(created), true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates the folders with mode 0700', () => {
    if (process.platform === 'win32') return;
    const dir = mkdtempSync(join(tmpdir(), 'iptv-mcp-args-'));

    const data = ensureDataDir(join(dir, 'data'));
    const logs = ensureLogDir(data);
    const raw = ensureRawDir(data);

    for (const folder of [data, logs, raw]) {
      assert.equal(statSync(folder).mode & 0o777, 0o700, folder);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates every folder of the chain with mode 0700', () => {
    if (process.platform === 'win32') return;
    const dir = mkdtempSync(join(tmpdir(), 'iptv-mcp-args-'));

    const created = ensureDataDir(join(dir, 'one', 'two', 'three'));

    assert.equal(statSync(join(dir, 'one')).mode & 0o777, 0o700);
    assert.equal(statSync(created).mode & 0o777, 0o700);
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses the root of the file system', () => {
    const root = parsePath(resolve('/')).root;
    assert.throws(() => ensureDataDir(root), /root of the file system/);
  });

  it('never changes a folder that existed before', () => {
    if (process.platform === 'win32') return;
    const dir = mkdtempSync(join(tmpdir(), 'iptv-mcp-args-'));
    const existing = join(dir, 'existing');
    mkdirSync(existing, { mode: 0o755 });
    chmodSync(existing, 0o755);

    const created = ensureDataDir(join(existing, 'data'));

    // The working folder is ours and becomes private.
    assert.equal(statSync(created).mode & 0o777, 0o700);
    // The folder above it is not ours: it stays as it was.
    assert.equal(statSync(existing).mode & 0o777, 0o755);
    rmSync(dir, { recursive: true, force: true });
  });

  it('makes the working folder private even when it existed', () => {
    if (process.platform === 'win32') return;
    const dir = mkdtempSync(join(tmpdir(), 'iptv-mcp-args-'));
    const existing = join(dir, 'data');
    mkdirSync(existing, { mode: 0o777 });
    chmodSync(existing, 0o777);

    ensureDataDir(existing);

    assert.equal(statSync(existing).mode & 0o777, 0o700);
    rmSync(dir, { recursive: true, force: true });
  });

  it('never changes a folder of the system', () => {
    if (process.platform === 'win32') return;
    const dir = mkdtempSync(join(tmpdir(), 'iptv-mcp-args-'));
    const before = statSync(dir).mode & 0o777;

    ensureDataDir(join(dir, 'one', 'two'));

    assert.equal(statSync(dir).mode & 0o777, before);
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates the log and the raw folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'iptv-mcp-args-'));

    assert.equal(existsSync(ensureLogDir(dir)), true);
    assert.equal(existsSync(ensureRawDir(dir)), true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('builds a path inside the folder', () => {
    assert.equal(dataPath('/tmp/data', 'raw', 'catalog.m3u'), resolve('/tmp/data', 'raw', 'catalog.m3u'));
  });
});
