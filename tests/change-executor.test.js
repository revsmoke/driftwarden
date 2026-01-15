/**
 * Change executor tests
 */

import { describe, test, expect } from 'bun:test';
import { applyDataChanges } from '../src/executor/change-executor.js';

function createMockWriter() {
  const calls = [];
  return {
    calls,
    async beginTransaction() {
      calls.push('begin');
    },
    async commit() {
      calls.push('commit');
    },
    async rollback() {
      calls.push('rollback');
    },
    async insertRows(table, rows) {
      calls.push({ type: 'insert', table, count: rows.length });
      return { affectedRows: rows.length };
    },
    async updateRow(table, row, primaryKey) {
      calls.push({ type: 'update', table, row, primaryKey });
      return { affectedRows: 1 };
    },
    async deleteRow(table, keyValues) {
      calls.push({ type: 'delete', table, keyValues });
      return { affectedRows: 1 };
    },
    async execute(sql, params) {
      calls.push({ type: 'execute', sql, params });
      return { affectedRows: 3 };
    },
  };
}

describe('Change Executor', () => {
  test('applies incremental inserts, updates, and deletes in a transaction', async () => {
    const writer = createMockWriter();
    const diffs = [
      {
        tableName: 'users',
        primaryKey: ['id'],
        toInsert: [{ id: 1 }, { id: 2 }],
        toUpdate: [{ remote: { id: 3, name: 'charlie' } }],
        toDelete: [{ id: 4 }],
      },
    ];

    const result = await applyDataChanges(writer, diffs, { batchSize: 1 });

    expect(result.success).toBe(true);
    expect(result.totalInserts).toBe(2);
    expect(result.totalUpdates).toBe(1);
    expect(result.totalDeletes).toBe(1);
    expect(writer.calls[0]).toBe('begin');
    expect(writer.calls[writer.calls.length - 1]).toBe('commit');

    const insertCalls = writer.calls.filter((c) => c.type === 'insert');
    expect(insertCalls).toHaveLength(2);
    const deleteCall = writer.calls.find((c) => c.type === 'delete');
    expect(deleteCall.keyValues).toEqual({ id: 4 });
  });

  test('performs full replacement when diff is marked fullReplace', async () => {
    const writer = createMockWriter();
    const diffs = [
      {
        tableName: 'logs',
        fullReplace: true,
        remoteData: [{ id: 10 }, { id: 11 }],
      },
    ];

    const result = await applyDataChanges(writer, diffs);

    expect(result.success).toBe(true);
    expect(result.totalDeletes).toBe(3);
    expect(result.totalInserts).toBe(2);

    const executeCall = writer.calls.find((c) => c.type === 'execute');
    expect(executeCall.sql).toContain('DELETE FROM');
    expect(executeCall.params[0]).toBe('logs');
  });
});
