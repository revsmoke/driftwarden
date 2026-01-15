/**
 * Schema Diff Calculator for Driftwarden
 * Compares remote and local database schemas to identify differences
 */

import { logger } from '../utils/logger.js';

/**
 * Compare two schemas and generate a diff
 * @param {object} remoteSchema - Schema from remote database
 * @param {object} localSchema - Schema from local database
 * @returns {object} Schema diff with changes needed
 */
export function diffTableSchema(remoteSchema, localSchema) {
  const diff = {
    tableName: remoteSchema.name,
    hasChanges: false,
    createTable: false,
    columnsToAdd: [],
    columnsToModify: [],
    columnsToRemove: [],
    indexesToAdd: [],
    indexesToRemove: [],
  };

  // If local table doesn't exist, need to create it
  if (!localSchema) {
    diff.createTable = true;
    diff.hasChanges = true;
    diff.createStatement = remoteSchema.createStatement;
    return diff;
  }

  // Compare columns
  const remoteColumns = new Map(remoteSchema.columns.map((c) => [c.Field, c]));
  const localColumns = new Map(localSchema.columns.map((c) => [c.Field, c]));

  // Find columns to add (in remote but not in local)
  for (const [name, remoteCol] of remoteColumns) {
    if (!localColumns.has(name)) {
      diff.columnsToAdd.push({
        name,
        type: remoteCol.Type,
        nullable: remoteCol.Null === 'YES',
        default: remoteCol.Default,
        extra: remoteCol.Extra,
        definition: buildColumnDefinition(remoteCol),
      });
      diff.hasChanges = true;
    }
  }

  // Find columns to remove (in local but not in remote)
  for (const [name, localCol] of localColumns) {
    if (!remoteColumns.has(name)) {
      diff.columnsToRemove.push({ name });
      diff.hasChanges = true;
    }
  }

  // Find columns to modify (type or attributes changed)
  for (const [name, remoteCol] of remoteColumns) {
    const localCol = localColumns.get(name);
    if (localCol && !columnsEqual(remoteCol, localCol)) {
      diff.columnsToModify.push({
        name,
        from: buildColumnDefinition(localCol),
        to: buildColumnDefinition(remoteCol),
        remoteCol,
        localCol,
      });
      diff.hasChanges = true;
    }
  }

  // Compare indexes (excluding primary key which is handled with columns)
  const remoteIndexes = groupIndexes(remoteSchema.indexes);
  const localIndexes = groupIndexes(localSchema.indexes);

  for (const [indexName, remoteIdx] of remoteIndexes) {
    if (indexName === 'PRIMARY') continue;

    if (!localIndexes.has(indexName)) {
      diff.indexesToAdd.push({
        name: indexName,
        columns: remoteIdx.columns,
        unique: remoteIdx.unique,
      });
      diff.hasChanges = true;
    }
  }

  for (const [indexName, localIdx] of localIndexes) {
    if (indexName === 'PRIMARY') continue;

    if (!remoteIndexes.has(indexName)) {
      diff.indexesToRemove.push({ name: indexName });
      diff.hasChanges = true;
    }
  }

  return diff;
}

/**
 * Build column definition string for ALTER TABLE
 */
function buildColumnDefinition(col) {
  let def = col.Type;

  if (col.Null === 'NO') {
    def += ' NOT NULL';
  } else {
    def += ' NULL';
  }

  if (col.Default !== null && col.Default !== undefined) {
    if (col.Default === 'CURRENT_TIMESTAMP') {
      def += ` DEFAULT ${col.Default}`;
    } else {
      def += ` DEFAULT '${col.Default}'`;
    }
  } else if (col.Null === 'YES') {
    def += ' DEFAULT NULL';
  }

  if (col.Extra) {
    def += ` ${col.Extra}`;
  }

  return def;
}

/**
 * Check if two columns are equal
 */
function columnsEqual(col1, col2) {
  return (
    col1.Type === col2.Type &&
    col1.Null === col2.Null &&
    col1.Default === col2.Default &&
    col1.Extra === col2.Extra
  );
}

/**
 * Group index rows by index name
 */
function groupIndexes(indexRows) {
  const indexes = new Map();

  for (const row of indexRows) {
    const name = row.Key_name;
    if (!indexes.has(name)) {
      indexes.set(name, {
        name,
        columns: [],
        unique: row.Non_unique === 0,
      });
    }
    indexes.get(name).columns.push(row.Column_name);
  }

  return indexes;
}

/**
 * Generate SQL statements to apply schema changes
 * @param {object} diff - Schema diff object
 * @returns {string[]} Array of SQL statements
 */
export function generateSchemaSQL(diff) {
  const statements = [];
  const tableName = diff.tableName;

  if (diff.createTable) {
    statements.push(diff.createStatement);
    return statements;
  }

  // Add columns
  for (const col of diff.columnsToAdd) {
    statements.push(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${col.name}\` ${col.definition}`);
  }

  // Modify columns
  for (const col of diff.columnsToModify) {
    statements.push(`ALTER TABLE \`${tableName}\` MODIFY COLUMN \`${col.name}\` ${col.to}`);
  }

  // Remove columns (careful - data loss!)
  for (const col of diff.columnsToRemove) {
    statements.push(`ALTER TABLE \`${tableName}\` DROP COLUMN \`${col.name}\``);
  }

  // Add indexes
  for (const idx of diff.indexesToAdd) {
    const indexType = idx.unique ? 'UNIQUE INDEX' : 'INDEX';
    const columns = idx.columns.map((c) => `\`${c}\``).join(', ');
    statements.push(`ALTER TABLE \`${tableName}\` ADD ${indexType} \`${idx.name}\` (${columns})`);
  }

  // Remove indexes
  for (const idx of diff.indexesToRemove) {
    statements.push(`ALTER TABLE \`${tableName}\` DROP INDEX \`${idx.name}\``);
  }

  return statements;
}

/**
 * Compare all tables between remote and local databases
 * @param {object} remoteReader - Remote database reader
 * @param {object} localWriter - Local database writer
 * @param {string[]} tables - Optional list of specific tables to compare
 * @returns {Promise<object[]>} Array of schema diffs
 */
export async function compareAllSchemas(remoteReader, localWriter, tables = null) {
  const diffs = [];

  // Get table lists
  const remoteTables = await remoteReader.getTables();
  const localTables = await localWriter.getTables();

  // Filter to specific tables if provided
  const tablesToCompare = tables && tables.length > 0
    ? remoteTables.filter((t) => tables.includes(t))
    : remoteTables;

  logger.info(`Comparing schemas for ${tablesToCompare.length} tables...`);

  for (const tableName of tablesToCompare) {
    logger.debug(`Comparing schema: ${tableName}`);

    const remoteSchema = await remoteReader.getTableSchema(tableName);
    const localSchema = localTables.includes(tableName)
      ? await localWriter.getTableSchema(tableName)
      : null;

    const diff = diffTableSchema(remoteSchema, localSchema);

    if (diff.hasChanges) {
      diff.sql = generateSchemaSQL(diff);
      diffs.push(diff);
    }
  }

  logger.info(`Found ${diffs.length} tables with schema changes`);
  return diffs;
}

/**
 * Format schema diff for display
 * @param {object} diff - Schema diff object
 * @returns {string} Formatted diff string
 */
export function formatSchemaDiff(diff) {
  const lines = [];
  lines.push(`\n=== Table: ${diff.tableName} ===`);

  if (diff.createTable) {
    lines.push('  [CREATE] New table will be created');
    return lines.join('\n');
  }

  if (diff.columnsToAdd.length > 0) {
    lines.push('  [ADD COLUMNS]');
    for (const col of diff.columnsToAdd) {
      lines.push(`    + ${col.name}: ${col.definition}`);
    }
  }

  if (diff.columnsToModify.length > 0) {
    lines.push('  [MODIFY COLUMNS]');
    for (const col of diff.columnsToModify) {
      lines.push(`    ~ ${col.name}:`);
      lines.push(`      FROM: ${col.from}`);
      lines.push(`      TO:   ${col.to}`);
    }
  }

  if (diff.columnsToRemove.length > 0) {
    lines.push('  [REMOVE COLUMNS] (WARNING: Data loss!)');
    for (const col of diff.columnsToRemove) {
      lines.push(`    - ${col.name}`);
    }
  }

  if (diff.indexesToAdd.length > 0) {
    lines.push('  [ADD INDEXES]');
    for (const idx of diff.indexesToAdd) {
      lines.push(`    + ${idx.name} (${idx.columns.join(', ')})${idx.unique ? ' UNIQUE' : ''}`);
    }
  }

  if (diff.indexesToRemove.length > 0) {
    lines.push('  [REMOVE INDEXES]');
    for (const idx of diff.indexesToRemove) {
      lines.push(`    - ${idx.name}`);
    }
  }

  return lines.join('\n');
}

export default {
  diffTableSchema,
  generateSchemaSQL,
  compareAllSchemas,
  formatSchemaDiff,
};
