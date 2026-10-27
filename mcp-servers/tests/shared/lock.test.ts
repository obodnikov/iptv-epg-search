import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { acquireLock, isLockStale, readLock } from '../../src/shared/lock.ts';
import { tempDir } from '../helpers.ts';

/**
 * A temporary folder that is removed when the test is over.
 */
function folder(): { path: string; cleanup: () => void } {
  const path = tempDir();
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) };
}

describe('acquireLock', () => {
  it('takes the lock and writes the file', () => {
    const dir = folder();
    const path = join(dir.path, 'refresh.lock');
    const lock = acquireLock(path);
    try {
      assert.ok(lock);
      assert.ok(existsSync(path));

      const info = readLock(path);
      assert.equal(info?.pid, process.pid);
      assert.equal(typeof info?.createdAt, 'number');
    } finally {
      lock?.release();
      dir.cleanup();
    }
  });

  it('gives the lock back', () => {
    const dir = folder();
    const path = join(dir.path, 'refresh.lock');
    const lock = acquireLock(path);
    assert.ok(lock);

    lock.release();
    assert.equal(existsSync(path), false);
    dir.cleanup();
  });

  it('can be given back twice', () => {
    const dir = folder();
    const path = join(dir.path, 'refresh.lock');
    const lock = acquireLock(path);
    assert.ok(lock);

    lock.release();
    lock.release();
    assert.equal(existsSync(path), false);
    dir.cleanup();
  });

  it('is not taken twice', () => {
    const dir = folder();
    const path = join(dir.path, 'refresh.lock');
    const first = acquireLock(path);
    const second = acquireLock(path);

    try {
      assert.ok(first);
      assert.equal(second, null);
    } finally {
      first?.release();
      dir.cleanup();
    }
  });

  it('is taken over when the lock is stale', () => {
    const dir = folder();
    const path = join(dir.path, 'refresh.lock');
    const now = 1_000_000;

    // A lock of a process that died an hour ago.
    writeFileSync(
      path,
      JSON.stringify({ pid: 999999, createdAt: now - 2 * 60 * 60 * 1000, host: 'old' }),
      { mode: 0o600 },
    );

    const lock = acquireLock(path, { now });
    try {
      assert.ok(lock);
      assert.equal(readLock(path)?.pid, process.pid);
    } finally {
      lock?.release();
      dir.cleanup();
    }
  });

  it('is not taken over when the lock is fresh', () => {
    const dir = folder();
    const path = join(dir.path, 'refresh.lock');
    const now = 1_000_000;

    writeFileSync(
      path,
      JSON.stringify({ pid: 999999, createdAt: now - 1000, host: 'other' }),
      { mode: 0o600 },
    );

    assert.equal(acquireLock(path, { now }), null);
    dir.cleanup();
  });

  it('does not remove a lock that is not ours any more', () => {
    const dir = folder();
    const path = join(dir.path, 'refresh.lock');
    const lock = acquireLock(path);
    assert.ok(lock);

    // Another process took the lock over: the file is not ours any more.
    writeFileSync(
      path,
      JSON.stringify({ pid: process.pid + 1, createdAt: Date.now(), host: 'other' }),
      { mode: 0o600 },
    );

    lock.release();
    assert.equal(readLock(path)?.pid, process.pid + 1);
    dir.cleanup();
  });

  it('does not remove a lock of the same process that was taken again', () => {
    const dir = folder();
    const path = join(dir.path, 'refresh.lock');
    const lock = acquireLock(path);
    assert.ok(lock);

    // The lock was taken again after ours went stale: the moment is
    // different, so the file is not ours any more.
    const takenAgain = Date.now() + 1000;
    writeFileSync(
      path,
      JSON.stringify({ pid: process.pid, createdAt: takenAgain, host: 'other' }),
      { mode: 0o600 },
    );

    lock.release();
    assert.equal(readLock(path)?.createdAt, takenAgain);
    dir.cleanup();
  });
});

describe('isLockStale', () => {
  it('is stale when it is older than the given time', () => {
    const now = 1_000_000;
    const info = { pid: 1, createdAt: now - 1000, host: '' };
    assert.equal(isLockStale(info, now, 500), true);
    assert.equal(isLockStale(info, now, 5000), false);
  });

  it('is stale when there is no lock', () => {
    assert.equal(isLockStale(null, 1_000_000), true);
  });

  it('is not stale when the clock of the machine is wrong', () => {
    const now = 1_000_000;
    const info = { pid: 1, createdAt: now + 60_000, host: '' };
    assert.equal(isLockStale(info, now, 500), false);
  });
});

describe('readLock', () => {
  it('returns null when the file is not a lock', () => {
    const dir = folder();
    const path = join(dir.path, 'refresh.lock');
    writeFileSync(path, 'not json', { mode: 0o600 });
    assert.equal(readLock(path), null);
    dir.cleanup();
  });

  it('returns null when there is no file', () => {
    const dir = folder();
    assert.equal(readLock(join(dir.path, 'refresh.lock')), null);
    dir.cleanup();
  });
});
