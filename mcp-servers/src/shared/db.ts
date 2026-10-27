/**
 * db.ts - the SQLite database of a server.
 *
 * The built-in `node:sqlite` module opens the database; the `sqlite-vec`
 * extension is loaded into it, so that the vectors of the search by meaning
 * live in the same process as the catalogue.
 *
 * The rules (design: iptv-mcp-servers.md §6.1):
 * - WAL, so that a reader never blocks the writer and a reader keeps seeing
 *   the old data until the writer commits;
 * - foreign keys on;
 * - the times are integer UTC epoch seconds, the raw source strings stay next
 *   to them;
 * - migrations are idempotent: `CREATE TABLE IF NOT EXISTS` and helpers that
 *   add a missing column;
 * - the schema version is kept in the `meta` table.
 *
 * The vectors live in their own file, so that deleting the catalogue does not
 * throw away the paid-for vectors. It is attached as `vec` (§6.2).
 */

import { DatabaseSync, type StatementSync } from 'node:sqlite';
import * as sqliteVec from 'sqlite-vec';
import { pathToFileURL } from 'node:url';

import { hardenFileSync } from './permissions.ts';

/** The name the vectors database is attached under. */
export const VECTORS_SCHEMA = 'vec';

export interface OpenDatabaseOptions {
  /** Path of the catalogue database. */
  path: string;
  /**
   * Path of the vectors database. It is attached as `vec`. When it is null,
   * no vectors database is attached.
   */
  vectorsPath?: string | null;
  /** Read-only mode. */
  readOnly?: boolean;
}

/**
 * The database with the helpers the servers use.
 */
export class Db {
  readonly handle: DatabaseSync;
  readonly path: string;
  /** True when a vectors database is attached under the name `vec`. */
  readonly hasVectors: boolean;
  /**
   * The files that have to be readable for their owner only.
   *
   * The catalogue holds the stream URLs of the provider, and with them the
   * access key of the account.
   */
  private readonly privateFiles: string[];
  /**
   * The prepared statements of this database.
   *
   * A statement is prepared once and used again: the import writes about
   * two hundred thousand rows, and preparing a statement for every one of
   * them costs more than the write itself.
   */
  private readonly statements = new Map<string, StatementSync>();

  constructor(
    handle: DatabaseSync,
    path: string,
    hasVectors: boolean,
    privateFiles: string[],
  ) {
    this.handle = handle;
    this.path = path;
    this.hasVectors = hasVectors;
    this.privateFiles = privateFiles;
  }

  /**
   * Make the files of the database readable for their owner only.
   *
   * The write-ahead log and the shared memory file are created by SQLite
   * with the rights of the process, and the log holds the same data as the
   * database while it is open. They are made private after every write.
   */
  harden(): void {
    for (const file of this.privateFiles) {
      hardenFileSync(file);
      hardenFileSync(`${file}-wal`);
      hardenFileSync(`${file}-shm`);
    }
  }

  /** Run one or more statements without a result. */
  exec(sql: string): void {
    this.handle.exec(sql);
  }

  /**
   * The prepared statement of a SQL string.
   *
   * The statement is prepared once and kept, so that the same SQL is not
   * parsed again and again.
   */
  statement(sql: string): StatementSync {
    const cached = this.statements.get(sql);
    if (cached) return cached;
    const statement = this.handle.prepare(sql);
    this.statements.set(sql, statement);
    return statement;
  }

  /** Run one statement and return the first row. */
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
    return this.statement(sql).get(...(params as never[])) as T | undefined;
  }

  /** Run one statement and return every row. */
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
    return this.statement(sql).all(...(params as never[])) as T[];
  }

  /** Run one statement and report how many rows it touched. */
  run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number } {
    const result = this.statement(sql).run(...(params as never[]));
    return {
      changes: Number(result.changes),
      lastInsertRowid: Number(result.lastInsertRowid),
    };
  }

  /** The value of a `meta` key, or null when it is not set. */
  meta(key: string): string | null {
    const row = this.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', key);
    return row ? row.value : null;
  }

  /** The value of a `meta` key, read as a number. */
  metaNumber(key: string): number | null {
    const value = this.meta(key);
    if (value === null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /** Write a `meta` key. */
  setMeta(key: string, value: string): void {
    this.run(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  }

  /** Close the database. */
  close(): void {
    try {
      // The write-ahead log is still there: it is made private before the
      // database is closed.
      this.harden();
      this.handle.close();
    } catch {
      // The database may already be closed.
    }
  }
}

/**
 * Open a database, load the extension and set the pragmas.
 *
 * The file is made private after it was created: it holds the stream URLs of
 * the provider, and with them the access key of the account.
 */
export function openDatabase(options: OpenDatabaseOptions): Db {
  const { path, vectorsPath = null, readOnly = false } = options;

  const handle = new DatabaseSync(path, {
    allowExtension: true,
    ...(readOnly ? { readOnly: true } : {}),
  });

  try {
    // The extension is loaded before any pragma or statement: it adds the
    // vec_distance_cosine() function and the vec0 virtual tables.
    sqliteVec.load(handle);
    // Only the extension that was loaded may be loaded: the SQL of the
    // server never needs another one.
    handle.enableLoadExtension(false);

    // A read-only connection may not write: it cannot change the journal
    // mode and it cannot create a table.
    if (!readOnly) {
      handle.exec('PRAGMA journal_mode = WAL;');
    }
    // Both are settings of the connection, not of the file.
    handle.exec('PRAGMA foreign_keys = ON;');
    // A busy timeout keeps two processes from failing right away: the
    // second one waits for the first to finish its transaction.
    handle.exec('PRAGMA busy_timeout = 10000;');

    if (!readOnly) {
      // The meta table holds the schema version and the state of the last
      // refresh. It is created here, so that readMeta() works on an empty
      // database as well.
      handle.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);');
    }

    let hasVectors = false;
    const privateFiles = [path];
    if (vectorsPath) {
      // ATTACH accepts a bound parameter, so that a path with a quote in it
      // cannot break the statement. A read-only connection attaches the
      // vectors read-only as well.
      const target = readOnly
        ? `${pathToFileURL(vectorsPath).href}?mode=ro`
        : vectorsPath;
      handle.prepare('ATTACH DATABASE ? AS ' + VECTORS_SCHEMA).run(target);
      hasVectors = true;
      privateFiles.push(vectorsPath);
    }

    const db = new Db(handle, path, hasVectors, privateFiles);

    // The files hold the access key of the provider: they belong to their
    // owner only.
    db.harden();

    return db;
  } catch (error) {
    try {
      handle.close();
    } catch {
      // Nothing else to do.
    }
    throw error;
  }
}

/**
 * Run a function inside a transaction.
 *
 * The work is committed when the function returns and rolled back when it
 * throws. A transaction that is already open is not opened a second time: the
 * nested call joins the outer one.
 */
export function withTransaction<T>(db: Db, fn: () => T): T {
  if (db.handle.isTransaction) return fn();

  db.exec('BEGIN IMMEDIATE;');
  let committed = false;
  try {
    const result = fn();
    db.exec('COMMIT;');
    committed = true;
    return result;
  } catch (error) {
    // A transaction that was committed is never thrown back: only the work
    // that was not committed may be.
    if (!committed) {
      try {
        db.exec('ROLLBACK;');
      } catch {
        // The transaction may already be gone.
      }
    }
    throw error;
  } finally {
    // The write-ahead log was written and holds the data of the database:
    // it has to be private as well. A failure here may not turn a committed
    // write into a failed one.
    try {
      db.harden();
    } catch {
      // The files keep their rights; nothing else can be done here.
    }
  }
}

/**
 * Run a function inside a read transaction.
 *
 * The function sees one snapshot of the database: a writer that commits
 * in the middle of it does not change what the function reads. That is
 * what a search needs: the number of the titles and the page of the
 * titles have to belong to the same catalogue.
 *
 * The transaction is deferred: it takes no write lock, and in WAL mode a
 * reader never blocks the writer.
 */
export function withSnapshot<T>(db: Db, fn: () => T): T {
  if (db.handle.isTransaction) return fn();

  db.exec('BEGIN DEFERRED;');
  let committed = false;
  try {
    const result = fn();
    db.exec('COMMIT;');
    committed = true;
    return result;
  } catch (error) {
    if (!committed) {
      try {
        db.exec('ROLLBACK;');
      } catch {
        // The transaction may already be gone.
      }
    }
    throw error;
  }
}

/**
 * Add a column to a table when it is not there yet.
 *
 * The migrations of the servers are idempotent: they run on every start, on
 * a database of any age.
 */
export function addColumnIfMissing(db: Db, table: string, column: string, definition: string): void {
  const columns = db.all<{ name: string }>(`PRAGMA table_info(${table})`);
  if (columns.some((entry) => entry.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
}

/**
 * True when a table exists.
 */
export function tableExists(db: Db, name: string): boolean {
  const row = db.get<{ found: number }>(
    "SELECT count(*) AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
    name,
  );
  return (row?.found ?? 0) > 0;
}

/**
 * The number of rows in a table.
 */
export function countRows(db: Db, table: string): number {
  const row = db.get<{ found: number }>(`SELECT count(*) AS found FROM ${table}`);
  return row?.found ?? 0;
}
