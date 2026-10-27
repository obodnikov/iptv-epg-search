/**
 * lock.ts - the refresh lock of a server.
 *
 * Two processes must never import at the same time: two Pilot sessions, or a
 * session and a manual run. The lock is a file in the working folder that
 * exists while a refresh runs (design: iptv-mcp-servers.md §6.4 step 1).
 *
 * A lock older than an hour counts as stale: a process that was killed
 * leaves its lock behind, and the next refresh would never start.
 */

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';

import { hardenFileSync } from './permissions.ts';

/** How long a lock may live before it counts as stale. */
export const DEFAULT_STALE_MS = 60 * 60 * 1000;

export interface LockInfo {
  /** The process that took the lock. */
  pid: number;
  /** Epoch milliseconds of the moment the lock was taken. */
  createdAt: number;
  /** Where the lock was taken, for the log. */
  host: string;
}

export interface LockOptions {
  /** How long the lock may live before it counts as stale. */
  staleMs?: number;
  /** The current time in epoch milliseconds; the tests pass their own. */
  now?: number;
}

/**
 * A held lock. `release()` gives it back; calling it twice is harmless.
 */
export interface LockHandle {
  /** The path of the lock file. */
  readonly path: string;
  /** The information that was written into the lock file. */
  readonly info: LockInfo;
  /** Give the lock back. */
  release(): void;
}

/**
 * Read the lock file.
 *
 * @returns the information of the lock, or null when there is no lock or the
 * file cannot be read.
 */
export function readLock(path: string): LockInfo | null {
  try {
    const text = readFileSync(path, 'utf8');
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const info = parsed as Partial<LockInfo>;
    if (typeof info.pid !== 'number' || typeof info.createdAt !== 'number') return null;
    return {
      pid: info.pid,
      createdAt: info.createdAt,
      host: typeof info.host === 'string' ? info.host : '',
    };
  } catch {
    return null;
  }
}

/**
 * True when a lock is older than the given time.
 */
export function isLockStale(info: LockInfo | null, now: number, staleMs = DEFAULT_STALE_MS): boolean {
  if (!info) return true;
  const age = now - info.createdAt;
  // A lock from the future is not stale: the clock of the machine may be
  // wrong, and throwing the lock away would let two imports run.
  if (age < 0) return false;
  return age > staleMs;
}

/**
 * Take the lock.
 *
 * @returns a handle when the lock was taken, or null when another process
 * holds it.
 */
export function acquireLock(path: string, options: LockOptions = {}): LockHandle | null {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const now = options.now ?? Date.now();

  const info: LockInfo = {
    pid: process.pid,
    createdAt: now,
    host: hostname(),
  };

  if (tryWrite(path, info)) return makeHandle(path, info);

  // The lock exists. It may be a leftover of a process that died.
  const existing = readLock(path);
  if (!isLockStale(existing, now, staleMs)) return null;

  try {
    rmSync(path, { force: true });
  } catch {
    // The file may be gone already, or it may not be removable.
  }

  if (tryWrite(path, info)) return makeHandle(path, info);

  // Somebody else took the lock in between.
  return null;
}

/**
 * Write the lock file, without ever overwriting an existing one.
 */
function tryWrite(path: string, info: LockInfo): boolean {
  try {
    writeFileSync(path, `${JSON.stringify(info, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    // The folder may not exist or may not be writable: the caller has to
    // know that the lock could not be taken.
    throw error;
  }

  // The lock is taken: the file is there. The rights of it are made private
  // after that — the file was created with mode 0600 anyway. A failure here
  // must not leave the lock behind without a handle to give it back with.
  try {
    hardenFileSync(path);
  } catch {
    // The file keeps its rights.
  }
  return true;
}

function makeHandle(path: string, info: LockInfo): LockHandle {
  let released = false;
  return {
    path,
    info,
    release(): void {
      if (released) return;
      released = true;
      // Only the owner of the lock may remove it. The file is ours when the
      // process and the moment are the ones we wrote: a lock that another
      // process took over after ours went stale is not ours any more.
      const current = readLock(path);
      if (!current) return;
      if (current.pid !== info.pid || current.createdAt !== info.createdAt) return;
      try {
        rmSync(path, { force: true });
      } catch {
        // The lock may be gone already.
      }
    },
  };
}

/**
 * True when a lock file exists.
 */
export function lockExists(path: string): boolean {
  return readLock(path) !== null;
}

