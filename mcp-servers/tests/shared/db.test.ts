import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  addColumnIfMissing,
  countRows,
  openDatabase,
  tableExists,
  withTransaction,
} from '../../src/shared/db.ts';
import { testDatabase } from '../helpers.ts';

describe('openDatabase', () => {
  it('creates the file and the meta table', () => {
    const test = testDatabase();
    try {
      assert.ok(tableExists(test.db, 'meta'));
    } finally {
      test.cleanup();
    }
  });

  it('turns the write-ahead log on and the foreign keys on', () => {
    const test = testDatabase();
    try {
      const journal = test.db.get<{ journal_mode: string }>('PRAGMA journal_mode');
      assert.equal(journal?.journal_mode, 'wal');

      const foreignKeys = test.db.get<{ foreign_keys: number }>('PRAGMA foreign_keys');
      assert.equal(foreignKeys?.foreign_keys, 1);
    } finally {
      test.cleanup();
    }
  });

  it('attaches the vectors database under the name vec', () => {
    const test = testDatabase(true);
    try {
      assert.equal(test.db.hasVectors, true);
      const attached = test.db.get<{ name: string }>(
        "SELECT name FROM pragma_database_list() WHERE name = 'vec'",
      );
      assert.equal(attached?.name, 'vec');
    } finally {
      test.cleanup();
    }
  });

  it('works without a vectors database', () => {
    const test = testDatabase(false);
    try {
      assert.equal(test.db.hasVectors, false);
    } finally {
      test.cleanup();
    }
  });

  it('opens an existing database read-only', () => {
    const test = testDatabase();
    try {
      // A database without the meta table: a read-only connection may not
      // create it.
      test.db.exec('DROP TABLE meta');
      test.db.close();

      const readOnly = openDatabase({ path: join(test.dir, 'data.sqlite'), readOnly: true });
      try {
        // The meta table is not created: a read-only connection may not
        // write.
        assert.equal(
          readOnly.get<{ found: number }>(
            "SELECT count(*) AS found FROM sqlite_master WHERE type = 'table' AND name = 'meta'",
          )?.found,
          0,
        );
        assert.throws(() => {
          readOnly.exec('CREATE TABLE nope (a)');
        }, /readonly/);
      } finally {
        readOnly.close();
      }
    } finally {
      // The database was closed above: only the folder has to go.
      rmSync(test.dir, { recursive: true, force: true });
    }
  });

  it('attaches the vectors read-only when the database is read-only', () => {
    const test = testDatabase(true);
    try {
      test.db.exec('CREATE TABLE vec.vectors (a)');
      test.db.close();

      const readOnly = openDatabase({
        path: join(test.dir, 'data.sqlite'),
        vectorsPath: join(test.dir, 'vectors.sqlite'),
        readOnly: true,
      });
      try {
        assert.equal(readOnly.hasVectors, true);
        assert.throws(() => {
          readOnly.exec('INSERT INTO vec.vectors VALUES (1)');
        }, /readonly/);
      } finally {
        readOnly.close();
      }
    } finally {
      rmSync(test.dir, { recursive: true, force: true });
    }
  });
});

describe('the rights of the files', () => {
  it('makes the write-ahead log private as well', () => {
    const test = testDatabase();
    try {
      test.db.exec('CREATE TABLE t (a)');
      test.db.run('INSERT INTO t (a) VALUES (1)');

      const sidecar = join(test.dir, 'data.sqlite-wal');
      if (existsSync(sidecar)) {
        assert.equal(statSync(sidecar).mode & 0o777, 0o600);
      }
    } finally {
      test.cleanup();
    }
  });

  it('makes the vectors file private', () => {
    const test = testDatabase(true);
    try {
      const vectors = join(test.dir, 'vectors.sqlite');
      assert.equal(statSync(vectors).mode & 0o777, 0o600);
    } finally {
      test.cleanup();
    }
  });

  it('makes the files private again after a write', () => {
    const test = testDatabase();
    try {
      test.db.exec('CREATE TABLE t (a)');
      withTransaction(test.db, () => {
        test.db.run('INSERT INTO t (a) VALUES (1)');
      });

      for (const suffix of ['', '-wal', '-shm']) {
        const path = join(test.dir, `data.sqlite${suffix}`);
        if (!existsSync(path)) continue;
        assert.equal(statSync(path).mode & 0o777, 0o600, path);
      }
    } finally {
      test.cleanup();
    }
  });
});

describe('meta', () => {
  it('keeps a value and reads it back', () => {
    const test = testDatabase();
    try {
      assert.equal(test.db.meta('schema_version'), null);
      test.db.setMeta('schema_version', '1');
      assert.equal(test.db.meta('schema_version'), '1');
    } finally {
      test.cleanup();
    }
  });

  it('overwrites a value', () => {
    const test = testDatabase();
    try {
      test.db.setMeta('model', 'a');
      test.db.setMeta('model', 'b');
      assert.equal(test.db.meta('model'), 'b');
    } finally {
      test.cleanup();
    }
  });

  it('reads a number', () => {
    const test = testDatabase();
    try {
      test.db.setMeta('count', '42');
      assert.equal(test.db.metaNumber('count'), 42);
      assert.equal(test.db.metaNumber('missing'), null);
    } finally {
      test.cleanup();
    }
  });
});

describe('withTransaction', () => {
  it('keeps the work when the function returns', () => {
    const test = testDatabase();
    try {
      test.db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
      withTransaction(test.db, () => {
        test.db.run('INSERT INTO t (id) VALUES (1)');
      });
      assert.equal(countRows(test.db, 't'), 1);
    } finally {
      test.cleanup();
    }
  });

  it('throws the work away when the function throws', () => {
    const test = testDatabase();
    try {
      test.db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
      assert.throws(() => {
        withTransaction(test.db, () => {
          test.db.run('INSERT INTO t (id) VALUES (1)');
          throw new Error('boom');
        });
      }, /boom/);
      assert.equal(countRows(test.db, 't'), 0);
    } finally {
      test.cleanup();
    }
  });

  it('joins a transaction that is already open', () => {
    const test = testDatabase();
    try {
      test.db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
      withTransaction(test.db, () => {
        test.db.run('INSERT INTO t (id) VALUES (1)');
        withTransaction(test.db, () => {
          test.db.run('INSERT INTO t (id) VALUES (2)');
        });
      });
      assert.equal(countRows(test.db, 't'), 2);
    } finally {
      test.cleanup();
    }
  });
});

describe('addColumnIfMissing', () => {
  it('adds a column that is not there', () => {
    const test = testDatabase();
    try {
      test.db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
      addColumnIfMissing(test.db, 't', 'name', "TEXT NOT NULL DEFAULT ''");
      const columns = test.db.all<{ name: string }>('PRAGMA table_info(t)');
      assert.ok(columns.some((column) => column.name === 'name'));
    } finally {
      test.cleanup();
    }
  });

  it('leaves a column that is already there', () => {
    const test = testDatabase();
    try {
      test.db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
      addColumnIfMissing(test.db, 't', 'name', "TEXT NOT NULL DEFAULT ''");
      const columns = test.db.all<{ name: string }>('PRAGMA table_info(t)');
      assert.equal(columns.filter((column) => column.name === 'name').length, 1);
    } finally {
      test.cleanup();
    }
  });
});

describe('tableExists', () => {
  it('knows a table that is there and one that is not', () => {
    const test = testDatabase();
    try {
      test.db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
      assert.equal(tableExists(test.db, 't'), true);
      assert.equal(tableExists(test.db, 'nothing'), false);
    } finally {
      test.cleanup();
    }
  });
});

describe('the database file', () => {
  it('is readable for its owner only', () => {
    const test = testDatabase();
    try {
      const path = join(test.dir, 'data.sqlite');
      const mode = statSync(path).mode & 0o777;
      assert.equal(mode, 0o600);
    } finally {
      test.cleanup();
    }
  });
});
