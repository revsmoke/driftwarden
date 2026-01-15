/**
 * Schema and Data diff tests
 */

import { describe, test, expect } from 'bun:test';
import { diffTableSchema, generateSchemaSQL } from '../src/diff/schema-diff.js';

describe('Schema Diff', () => {
  test('detects new table (no local schema)', () => {
    const remoteSchema = {
      name: 'users',
      columns: [
        { Field: 'id', Type: 'int', Null: 'NO', Key: 'PRI', Default: null, Extra: 'auto_increment' },
        { Field: 'name', Type: 'varchar(255)', Null: 'YES', Key: '', Default: null, Extra: '' },
      ],
      indexes: [],
      createStatement: 'CREATE TABLE users (id int PRIMARY KEY, name varchar(255))',
    };

    const diff = diffTableSchema(remoteSchema, null);
    expect(diff.createTable).toBe(true);
    expect(diff.hasChanges).toBe(true);
  });

  test('detects no changes for identical schemas', () => {
    const schema = {
      name: 'users',
      columns: [
        { Field: 'id', Type: 'int', Null: 'NO', Key: 'PRI', Default: null, Extra: '' },
      ],
      indexes: [],
    };

    const diff = diffTableSchema(schema, schema);
    expect(diff.hasChanges).toBe(false);
    expect(diff.columnsToAdd).toHaveLength(0);
    expect(diff.columnsToModify).toHaveLength(0);
    expect(diff.columnsToRemove).toHaveLength(0);
  });

  test('detects added column', () => {
    const remoteSchema = {
      name: 'users',
      columns: [
        { Field: 'id', Type: 'int', Null: 'NO', Key: 'PRI', Default: null, Extra: '' },
        { Field: 'email', Type: 'varchar(255)', Null: 'YES', Key: '', Default: null, Extra: '' },
      ],
      indexes: [],
    };

    const localSchema = {
      name: 'users',
      columns: [
        { Field: 'id', Type: 'int', Null: 'NO', Key: 'PRI', Default: null, Extra: '' },
      ],
      indexes: [],
    };

    const diff = diffTableSchema(remoteSchema, localSchema);
    expect(diff.hasChanges).toBe(true);
    expect(diff.columnsToAdd).toHaveLength(1);
    expect(diff.columnsToAdd[0].name).toBe('email');
  });

  test('detects modified column type', () => {
    const remoteSchema = {
      name: 'users',
      columns: [
        { Field: 'id', Type: 'bigint', Null: 'NO', Key: 'PRI', Default: null, Extra: '' },
      ],
      indexes: [],
    };

    const localSchema = {
      name: 'users',
      columns: [
        { Field: 'id', Type: 'int', Null: 'NO', Key: 'PRI', Default: null, Extra: '' },
      ],
      indexes: [],
    };

    const diff = diffTableSchema(remoteSchema, localSchema);
    expect(diff.hasChanges).toBe(true);
    expect(diff.columnsToModify).toHaveLength(1);
    expect(diff.columnsToModify[0].remoteCol.Type).toBe('bigint');
  });

  test('detects removed column', () => {
    const remoteSchema = {
      name: 'users',
      columns: [
        { Field: 'id', Type: 'int', Null: 'NO', Key: 'PRI', Default: null, Extra: '' },
      ],
      indexes: [],
    };

    const localSchema = {
      name: 'users',
      columns: [
        { Field: 'id', Type: 'int', Null: 'NO', Key: 'PRI', Default: null, Extra: '' },
        { Field: 'deleted_col', Type: 'varchar(50)', Null: 'YES', Key: '', Default: null, Extra: '' },
      ],
      indexes: [],
    };

    const diff = diffTableSchema(remoteSchema, localSchema);
    expect(diff.hasChanges).toBe(true);
    expect(diff.columnsToRemove).toHaveLength(1);
    expect(diff.columnsToRemove[0].name).toBe('deleted_col');
  });
});

describe('Schema SQL Generation', () => {
  test('generates CREATE TABLE for new table', () => {
    const diff = {
      tableName: 'users',
      createTable: true,
      createStatement: 'CREATE TABLE users (id int PRIMARY KEY)',
      hasChanges: true,
      columnsToAdd: [],
      columnsToModify: [],
      columnsToRemove: [],
      indexesToAdd: [],
      indexesToRemove: [],
    };

    const sql = generateSchemaSQL(diff);
    expect(sql.length).toBeGreaterThan(0);
    expect(sql[0]).toContain('CREATE TABLE');
  });

  test('generates ADD COLUMN SQL', () => {
    const diff = {
      tableName: 'users',
      createTable: false,
      hasChanges: true,
      columnsToAdd: [
        { name: 'email', definition: 'varchar(255) NULL DEFAULT NULL' },
      ],
      columnsToModify: [],
      columnsToRemove: [],
      indexesToAdd: [],
      indexesToRemove: [],
    };

    const sql = generateSchemaSQL(diff);
    expect(sql.length).toBeGreaterThan(0);
    expect(sql[0]).toContain('ADD COLUMN');
    expect(sql[0]).toContain('email');
  });

  test('returns empty array for no changes', () => {
    const diff = {
      tableName: 'users',
      createTable: false,
      hasChanges: false,
      columnsToAdd: [],
      columnsToModify: [],
      columnsToRemove: [],
      indexesToAdd: [],
      indexesToRemove: [],
    };

    const sql = generateSchemaSQL(diff);
    expect(sql).toHaveLength(0);
  });
});
