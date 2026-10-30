/**
 * lock.ts - the lock of the working folder.
 *
 * The lock keeps two processes from writing the guide at the same time:
 * two Pilot sessions, or a session and the local script. The lock file
 * lives in the working folder and is stale after an hour (see
 * `shared/lock.ts`).
 */

import { join } from 'node:path';

import { acquireLock, type LockHandle } from '../shared/lock.ts';

/**
 * The result of an operation that could not take the lock.
 */
export class ImportError {
  readonly error: string;

  constructor(error: string) {
    this.error = error;
  }
}

export function isImportError(value: unknown): value is ImportError {
  return value instanceof ImportError;
}

/**
 * Take the lock of the working folder.
 */
export function takeImportLock(dataDir: string | undefined): {
  lock: LockHandle | null;
  error: string | null;
} {
  if (!dataDir) return { lock: null, error: null };

  try {
    const lock = acquireLock(join(dataDir, 'refresh.lock'));
    if (!lock) return { lock: null, error: 'a refresh is already running' };
    return { lock, error: null };
  } catch (error) {
    return {
      lock: null,
      error: `the refresh lock could not be taken: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/**
 * The answer of an operation that threw.
 *
 * The import always answers with an `ImportOutcome`: a throw of the
 * download, the parser or the database wrapper is a failed refresh.
 */
export class ImportThrow {
  readonly error: unknown;

  constructor(error: unknown) {
    this.error = error;
  }
}

export function isImportThrow(value: unknown): value is ImportThrow {
  return value instanceof ImportThrow;
}

/**
 * Run something under the lock of the working folder, and wait for it.
 */
export async function withImportLock<T>(
  dataDir: string | undefined,
  fn: () => Promise<T> | T,
): Promise<T | ImportError> {
  const taken = takeImportLock(dataDir);
  if (taken.error !== null) return new ImportError(taken.error);

  try {
    return await fn();
  } finally {
    taken.lock?.release();
  }
}
