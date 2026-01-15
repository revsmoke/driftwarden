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
    async query(sql) {
      if (sql.startsWith('SELECT COUNT')) {
        return [{ count: rows.length }];
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
});
