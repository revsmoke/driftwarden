/**
 * Data diff tests
 */

import { describe, test, expect } from 'bun:test';
import { diffTableData } from '../src/diff/data-diff.js';

function createRemoteReader(rows, primaryKey = ['id']) {
  return {
    async getTableSchema() {
      return { name: 'users', primaryKey };
    },
    async checkTimestampColumns() {
      return { hasUpdatedAt: false, hasCreatedAt: false };
    },
    async *getTableDataChunked(_tableName, chunkSize) {
      for (let i = 0; i < rows.length; i += chunkSize) {
        yield rows.slice(i, i + chunkSize);
      }
    },
  };
}

function createLocalWriter(rows) {
  return {
    async getTableData(_tableName, { limit, offset }) {
      return rows.slice(offset, offset + limit);
    },
    async query(sql, params = []) {
      if (sql.startsWith('SELECT COUNT')) {
        return [{ count: rows.length }];
      }
      // Handle batch lookup queries (SELECT * FROM ?? WHERE ?? IN (...))
      if (sql.includes('IN (') && params.length > 2) {
        const pkCol = params[1]; // Second param is the PK column name
        const pkValues = params.slice(2); // Remaining params are PK values
        return rows.filter(row => pkValues.includes(row[pkCol]));
      }
      return [];
    },
  };
}

describe('Data Diff', () => {
  test('identifies inserts, updates, and deletes', async () => {
    const remoteRows = [
      { id: 1, name: 'alpha' },
      { id: 2, name: 'bravo-new' },
      { id: 3, name: 'charlie' },
    ];
    const localRows = [
      { id: 1, name: 'alpha' },
      { id: 2, name: 'bravo-old' },
      { id: 4, name: 'delta' },
    ];

    const remoteReader = createRemoteReader(remoteRows, ['id']);
    const localWriter = createLocalWriter(localRows);

    const diff = await diffTableData(remoteReader, localWriter, 'users', { chunkSize: 2 });

    expect(diff.stats.inserts).toBe(1);
    expect(diff.stats.updates).toBe(1);
    expect(diff.stats.deletes).toBe(1);
    expect(diff.toInsert.map((row) => row.id)).toEqual([3]);
    expect(diff.toUpdate[0].remote.id).toBe(2);
    expect(diff.toDelete.map((row) => row.id)).toEqual([4]);
  });

  test('falls back to full replacement when no primary key exists', async () => {
    const remoteRows = [{ name: 'one' }, { name: 'two' }];
    const localRows = [{ name: 'local' }];

    const remoteReader = createRemoteReader(remoteRows, []);
    const localWriter = createLocalWriter(localRows);

    const diff = await diffTableData(remoteReader, localWriter, 'logs', { chunkSize: 1 });

    expect(diff.fullReplace).toBe(true);
    expect(diff.remoteData).toHaveLength(2);
    expect(diff.stats.remoteRows).toBe(2);
    expect(diff.stats.localRows).toBe(1);
  });

  test('full sync disables incremental diff and detects deletes', async () => {
    const remoteRows = [
      { id: 1, name: 'alpha' },
      { id: 2, name: 'bravo' },
    ];
    const localRows = [
      { id: 1, name: 'alpha' },
      { id: 3, name: 'charlie' },
    ];

    const remoteReader = {
      async getTableSchema() {
        return { name: 'users', primaryKey: ['id'] };
      },
      async checkTimestampColumns() {
        return { hasUpdatedAt: true, hasCreatedAt: false, updatedAtColumn: 'updated_at' };
      },
      async *getTableDataChunked(_tableName, chunkSize) {
        for (let i = 0; i < remoteRows.length; i += chunkSize) {
          yield remoteRows.slice(i, i + chunkSize);
        }
      },
      async getRowCount() {
        return remoteRows.length;
      },
      async getModifiedRows() {
        throw new Error('incremental diff should not run when useIncremental is false');
      },
    };

    const localWriter = {
      async getTableData(_tableName, { limit, offset }) {
        return localRows.slice(offset, offset + limit);
      },
      async query(sql, params = []) {
        if (sql.startsWith('SELECT COUNT')) {
          return [{ count: localRows.length }];
        }
        if (sql.includes('IN (') && params.length > 2) {
          const pkCol = params[1];
          const pkValues = params.slice(2);
          return localRows.filter(row => pkValues.includes(row[pkCol]));
        }
        return [];
      },
      async tableExists() {
        throw new Error('incremental diff should not check tableExists when useIncremental is false');
      },
      async checkTimestampColumns() {
        throw new Error('incremental diff should not check local timestamps when useIncremental is false');
      },
      async getMaxTimestamp() {
        throw new Error('incremental diff should not fetch max timestamp when useIncremental is false');
      },
    };

    const diff = await diffTableData(remoteReader, localWriter, 'users', {
      chunkSize: 1,
      useIncremental: false,
    });

    expect(diff.stats.inserts).toBe(1);
    expect(diff.stats.updates).toBe(0);
    expect(diff.stats.deletes).toBe(1);
    expect(diff.toInsert.map((row) => row.id)).toEqual([2]);
    expect(diff.toDelete.map((row) => row.id)).toEqual([3]);
  });
});
