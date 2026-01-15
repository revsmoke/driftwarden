/**
 * Local Change Executor for Driftwarden
 * Applies approved changes to the local database
 * SAFETY: Only writes to LOCAL database, never to remote
 */

import { logger } from '../utils/logger.js';

/**
 * Apply schema changes to local database
 * @param {object} localWriter - Local database writer
 * @param {object[]} schemaDiffs - Approved schema diffs
 * @returns {Promise<object>} Execution results
 */
export async function applySchemaChanges(localWriter, schemaDiffs) {
  const results = {
    success: true,
    applied: [],
    failed: [],
    errors: [],
  };

  for (const diff of schemaDiffs) {
    if (!diff.hasChanges || !diff.sql || diff.sql.length === 0) {
      continue;
    }

    logger.info(`Applying schema changes to ${diff.tableName}...`);

    for (const sql of diff.sql) {
      try {
        logger.debug(`Executing: ${sql.substring(0, 100)}...`);
        await localWriter.executeSchema(sql);
        results.applied.push({ table: diff.tableName, sql });
      } catch (err) {
        logger.error(`Failed to apply schema change: ${err.message}`);
        results.failed.push({ table: diff.tableName, sql, error: err.message });
        results.errors.push(err.message);
        results.success = false;
      }
    }
  }

  logger.info(
    `Schema changes: ${results.applied.length} applied, ${results.failed.length} failed`
  );

  return results;
}

/**
 * Apply data changes to local database
 * @param {object} localWriter - Local database writer
 * @param {object[]} dataDiffs - Approved data diffs
 * @param {object} options - Execution options
 * @returns {Promise<object>} Execution results
 */
export async function applyDataChanges(localWriter, dataDiffs, options = {}) {
  const { batchSize = 1000, continueOnError = false } = options;

  const results = {
    success: true,
    tables: [],
    totalInserts: 0,
    totalUpdates: 0,
    totalDeletes: 0,
    errors: [],
  };

  for (const diff of dataDiffs) {
    const tableResult = {
      table: diff.tableName,
      inserts: 0,
      updates: 0,
      deletes: 0,
      errors: [],
    };

    try {
      // Handle full table replacement (no primary key)
      if (diff.fullReplace) {
        await applyFullReplace(localWriter, diff, tableResult);
      } else {
        // Normal incremental sync
        await applyIncrementalChanges(localWriter, diff, tableResult, batchSize);
      }
    } catch (err) {
      logger.error(`Error applying changes to ${diff.tableName}: ${err.message}`);
      tableResult.errors.push(err.message);
      results.success = false;

      if (!continueOnError) {
        results.tables.push(tableResult);
        results.errors.push(`${diff.tableName}: ${err.message}`);
        return results;
      }
    }

    results.tables.push(tableResult);
    results.totalInserts += tableResult.inserts;
    results.totalUpdates += tableResult.updates;
    results.totalDeletes += tableResult.deletes;
    results.errors.push(...tableResult.errors.map((e) => `${diff.tableName}: ${e}`));
  }

  logger.info(
    `Data changes applied: ${results.totalInserts} inserts, ` +
    `${results.totalUpdates} updates, ${results.totalDeletes} deletes`
  );

  return results;
}

/**
 * Apply incremental changes (insert/update/delete)
 */
async function applyIncrementalChanges(localWriter, diff, tableResult, batchSize) {
  const { tableName, primaryKey, toInsert, toUpdate, toDelete } = diff;

  // Start transaction for atomicity
  await localWriter.beginTransaction();

  try {
    // Apply inserts in batches
    if (toInsert && toInsert.length > 0) {
      logger.info(`Inserting ${toInsert.length} rows into ${tableName}...`);

      for (let i = 0; i < toInsert.length; i += batchSize) {
        const batch = toInsert.slice(i, i + batchSize);
        await localWriter.insertRows(tableName, batch);
        tableResult.inserts += batch.length;
        logger.debug(`Inserted batch ${Math.floor(i / batchSize) + 1}`);
      }
    }

    // Apply updates one by one (to handle different columns per row)
    if (toUpdate && toUpdate.length > 0) {
      logger.info(`Updating ${toUpdate.length} rows in ${tableName}...`);

      for (const { remote } of toUpdate) {
        await localWriter.updateRow(tableName, remote, primaryKey);
        tableResult.updates++;
      }
    }

    // Apply deletes
    if (toDelete && toDelete.length > 0) {
      logger.info(`Deleting ${toDelete.length} rows from ${tableName}...`);

      for (const row of toDelete) {
        const keyValues = {};
        for (const col of primaryKey) {
          keyValues[col] = row[col];
        }
        await localWriter.deleteRow(tableName, keyValues);
        tableResult.deletes++;
      }
    }

    // Commit transaction
    await localWriter.commit();
    logger.info(`Changes committed for ${tableName}`);
  } catch (err) {
    // Rollback on error
    await localWriter.rollback();
    logger.error(`Rolling back changes for ${tableName}: ${err.message}`);
    throw err;
  }
}

/**
 * Apply full table replacement (for tables without primary key)
 */
async function applyFullReplace(localWriter, diff, tableResult) {
  const { tableName, remoteData } = diff;

  logger.warn(`Performing full table replacement for ${tableName}`);

  await localWriter.beginTransaction();

  try {
    // Delete all existing rows
    const deleteResult = await localWriter.execute('DELETE FROM ??', [tableName]);
    tableResult.deletes = deleteResult.affectedRows;
    logger.info(`Deleted ${tableResult.deletes} rows from ${tableName}`);

    // Insert all remote data
    if (remoteData && remoteData.length > 0) {
      const batchSize = 1000;
      for (let i = 0; i < remoteData.length; i += batchSize) {
        const batch = remoteData.slice(i, i + batchSize);
        await localWriter.insertRows(tableName, batch);
        tableResult.inserts += batch.length;
      }
      logger.info(`Inserted ${tableResult.inserts} rows into ${tableName}`);
    }

    await localWriter.commit();
  } catch (err) {
    await localWriter.rollback();
    throw err;
  }
}

/**
 * Execute full sync (schema + data)
 * @param {object} localWriter - Local database writer
 * @param {object[]} schemaDiffs - Approved schema diffs
 * @param {object[]} dataDiffs - Approved data diffs
 * @param {object} options - Execution options
 * @returns {Promise<object>} Combined results
 */
export async function executeSync(localWriter, schemaDiffs, dataDiffs, options = {}) {
  const results = {
    success: true,
    schema: null,
    data: null,
  };

  // Apply schema changes first
  if (schemaDiffs && schemaDiffs.length > 0) {
    logger.info('Applying schema changes...');
    results.schema = await applySchemaChanges(localWriter, schemaDiffs);
    if (!results.schema.success) {
      results.success = false;
      logger.error('Schema changes failed - aborting data sync');
      return results;
    }
  }

  // Apply data changes
  if (dataDiffs && dataDiffs.length > 0) {
    logger.info('Applying data changes...');
    results.data = await applyDataChanges(localWriter, dataDiffs, options);
    if (!results.data.success) {
      results.success = false;
    }
  }

  return results;
}

/**
 * Generate execution summary
 * @param {object} results - Execution results
 * @returns {string} Formatted summary
 */
export function formatExecutionSummary(results) {
  const lines = [];

  lines.push('\n' + '='.repeat(60));
  lines.push('                 SYNC EXECUTION SUMMARY');
  lines.push('='.repeat(60));

  if (results.schema) {
    lines.push(`\nSchema Changes:`);
    lines.push(`  Applied: ${results.schema.applied.length}`);
    lines.push(`  Failed: ${results.schema.failed.length}`);
  }

  if (results.data) {
    lines.push(`\nData Changes:`);
    lines.push(`  Inserts: ${results.data.totalInserts}`);
    lines.push(`  Updates: ${results.data.totalUpdates}`);
    lines.push(`  Deletes: ${results.data.totalDeletes}`);
  }

  if (results.success) {
    lines.push(`\n✓ Sync completed successfully`);
  } else {
    lines.push(`\n✗ Sync completed with errors:`);
    const allErrors = [
      ...(results.schema?.errors || []),
      ...(results.data?.errors || []),
    ];
    for (const err of allErrors) {
      lines.push(`  - ${err}`);
    }
  }

  lines.push('\n' + '='.repeat(60) + '\n');

  return lines.join('\n');
}

export default {
  applySchemaChanges,
  applyDataChanges,
  executeSync,
  formatExecutionSummary,
};
