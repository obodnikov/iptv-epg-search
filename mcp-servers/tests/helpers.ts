/**
 * helpers.ts - the helpers of the tests.
 *
 * The tests work on a database in a temporary folder. The folder is removed
 * when the test is over, so that nothing is left behind.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Db, openDatabase } from '../src/shared/db.ts';

export interface TestDatabase {
  db: Db;
  /** The temporary folder of the test. */
  dir: string;
  /** Remove the folder and close the database. */
  cleanup(): void;
}

/**
 * A temporary folder for one test.
 */
export function tempDir(prefix = 'iptv-mcp-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * A database in a temporary folder.
 *
 * @param vectors True when a vectors database is attached as well.
 */
export function testDatabase(vectors = false): TestDatabase {
  const dir = tempDir();
  const db = openDatabase({
    path: join(dir, 'data.sqlite'),
    vectorsPath: vectors ? join(dir, 'vectors.sqlite') : null,
  });

  return {
    db,
    dir,
    cleanup(): void {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
