/**
 * Data Diff + Merge Planner for Driftwarden
 * Compares data between remote and local tables, plans merge operations
 */

import { logger } from '../utils/logger.js';

/**
 * Compare data between remote and local tables
 * @param {object} remoteReader - Remote database reader
 * @param {object} localWriter - Local database writer
 * @param {string} tableName - Table to compare
 * @param {object} options - Comparison options
 * @returns {Promise<object>} Data diff with insert/update/delete operations
 */
export async function diffTableData(remoteReader, localWriter, tableName, options = {}) {
  const { chunkSize = 5000, primaryKey = null, useIncremental = true } = options;

  // Get table schema to find primary key
  const schema = await remoteReader.getTableSchema(tableName);
  const pk = primaryKey || schema.primaryKey;

  if (!pk || pk.length === 0) {
    logger.warn(`Table ${tableName} has no primary key - full comparison required`);
    return await fullTableDiff(remoteReader, localWriter, tableName, chunkSize);
  }

  // Check for timestamp columns for incremental sync
  const timestamps = await remoteReader.checkTimestampColumns(tableName);

  // Try incremental sync if timestamps are available and local table exists
  if (useIncremental && timestamps.hasUpdatedAt) {
    const localTableExists = await localWriter.tableExists(tableName);
    if (localTableExists) {
      const localTimestamps = await localWriter.checkTimestampColumns(tableName);
      if (localTimestamps.hasUpdatedAt) {
        logger.info(`Using incremental sync for ${tableName} (updated_at column detected)`);
        return await incrementalDiff(
          remoteReader,
          localWriter,
          tableName,
          pk,
          timestamps.updatedAtColumn,
          chunkSize
        );
      }
    }
  }

  const diff = {
    tableName,
    primaryKey: pk,
    hasTimestamps: timestamps.hasUpdatedAt || timestamps.hasCreatedAt,
    toInsert: [],
    toUpdate: [],
    toDelete: [],
    stats: {
      remoteRows: 0,
      localRows: 0,
      inserts: 0,
      updates: 0,
      deletes: 0,
    },
  };

  // Build index of local data by primary key
  logger.info(`Building local data index for ${tableName}...`);
  const localIndex = new Map();
  let localOffset = 0;
  let localHasMore = true;

  while (localHasMore) {
    const localRows = await localWriter.getTableData(tableName, {
      limit: chunkSize,
      offset: localOffset,
      orderBy: pk[0],
    });

    for (const row of localRows) {
      const key = buildPrimaryKeyValue(row, pk);
      localIndex.set(key, row);
    }

    localOffset += localRows.length;
    localHasMore = localRows.length === chunkSize;
  }

  diff.stats.localRows = localIndex.size;
  logger.debug(`Local index built: ${localIndex.size} rows`);

  // Track which local rows we've seen (for delete detection)
  const seenLocalKeys = new Set();

  // Compare remote data against local
  logger.info(`Comparing remote data for ${tableName}...`);
  for await (const remoteChunk of remoteReader.getTableDataChunked(tableName, chunkSize, pk[0])) {
    for (const remoteRow of remoteChunk) {
      diff.stats.remoteRows++;
      const key = buildPrimaryKeyValue(remoteRow, pk);
      seenLocalKeys.add(key);

      const localRow = localIndex.get(key);

      if (!localRow) {
        // Row exists in remote but not local - INSERT
        diff.toInsert.push(remoteRow);
        diff.stats.inserts++;
      } else if (!rowsEqual(remoteRow, localRow)) {
        // Row exists in both but different - UPDATE
        diff.toUpdate.push({
          remote: remoteRow,
          local: localRow,
          changes: getRowChanges(localRow, remoteRow),
        });
        diff.stats.updates++;
      }
      // else: rows are identical, no action needed
    }
  }

  // Find rows in local but not in remote - DELETE candidates
  for (const [key, localRow] of localIndex) {
    if (!seenLocalKeys.has(key)) {
      diff.toDelete.push(localRow);
      diff.stats.deletes++;
    }
  }

  logger.info(
    `Data diff for ${tableName}: ` +
    `${diff.stats.inserts} inserts, ${diff.stats.updates} updates, ${diff.stats.deletes} deletes`
  );

  return diff;
}

/**
 * Full table comparison when no primary key exists
 */
async function fullTableDiff(remoteReader, localWriter, tableName, chunkSize) {
  logger.warn(`Performing full table comparison for ${tableName} (no primary key)`);

  const diff = {
    tableName,
    primaryKey: [],
    hasTimestamps: false,
    fullReplace: true, // Indicates this needs special handling
    remoteData: [],
    stats: {
      remoteRows: 0,
      localRows: 0,
      inserts: 0,
      updates: 0,
      deletes: 0,
    },
  };

  // Get all remote data
  for await (const chunk of remoteReader.getTableDataChunked(tableName, chunkSize)) {
    diff.remoteData.push(...chunk);
    diff.stats.remoteRows += chunk.length;
  }

  // Count local rows
  const localCount = await localWriter.query('SELECT COUNT(*) as count FROM ??', [tableName]);
  diff.stats.localRows = localCount[0]?.count || 0;

  // For stats display, treat as inserts (full replace)
  diff.stats.inserts = diff.stats.remoteRows;

  return diff;
}

/**
 * Incremental diff using timestamp columns
 * Only fetches rows modified after the local max timestamp
 * @param {object} remoteReader - Remote database reader
 * @param {object} localWriter - Local database writer
 * @param {string} tableName - Table to compare
 * @param {string[]} pk - Primary key columns
 * @param {string} timestampColumn - Column to use for incremental sync
 * @param {number} chunkSize - Chunk size for queries
 * @returns {Promise<object>} Data diff
 */
async function incrementalDiff(remoteReader, localWriter, tableName, pk, timestampColumn, chunkSize) {
  // Get the max timestamp from local table
  const localMaxTs = await localWriter.getMaxTimestamp(tableName, timestampColumn);

  const diff = {
    tableName,
    primaryKey: pk,
    hasTimestamps: true,
    incremental: true,
    timestampColumn,
    localMaxTimestamp: localMaxTs,
    toInsert: [],
    toUpdate: [],
    toDelete: [], // Note: incremental sync cannot detect deletes without full scan
    stats: {
      remoteRows: 0,
      localRows: 0,
      inserts: 0,
      updates: 0,
      deletes: 0,
      scannedRows: 0, // Track how many rows we actually scanned
    },
  };

  // Get local row count for stats
  const [localCountResult] = await localWriter.query('SELECT COUNT(*) as count FROM ??', [tableName]);
  diff.stats.localRows = localCountResult?.count || 0;

  // If no local data, we need a full sync (but still optimized with PK)
  if (!localMaxTs) {
    logger.info(`No local data for ${tableName} - fetching all remote rows`);
    return await fullPrimaryKeyDiff(remoteReader, localWriter, tableName, pk, chunkSize);
  }

  logger.info(`Incremental sync from ${localMaxTs.toISOString()} for ${tableName}`);

  // Build index of local data by PK for rows that might be updated
  // Only need to index rows that might match the remote changes
  const localIndex = new Map();

  // Get modified rows from remote (since local max timestamp)
  const modifiedRows = await remoteReader.getModifiedRows(tableName, timestampColumn, localMaxTs);
  diff.stats.scannedRows = modifiedRows.length;

  if (modifiedRows.length === 0) {
    logger.info(`No changes found for ${tableName} since ${localMaxTs.toISOString()}`);
    return diff;
  }

  logger.info(`Found ${modifiedRows.length} modified rows in remote ${tableName}`);

  // Get local versions of potentially modified rows for comparison
  for (const remoteRow of modifiedRows) {
    const pkValue = buildPrimaryKeyValue(remoteRow, pk);

    // Query local row with this PK
    const whereClause = pk.map(() => '?? = ?').join(' AND ');
    const whereParams = [];
    for (const col of pk) {
      whereParams.push(col, remoteRow[col]);
    }

    const [localRow] = await localWriter.query(
      `SELECT * FROM ?? WHERE ${whereClause}`,
      [tableName, ...whereParams]
    );

    if (!localRow) {
      // New row in remote
      diff.toInsert.push(remoteRow);
      diff.stats.inserts++;
    } else if (!rowsEqual(remoteRow, localRow)) {
      // Row exists but changed
      diff.toUpdate.push({
        remote: remoteRow,
        local: localRow,
        changes: getRowChanges(localRow, remoteRow),
      });
      diff.stats.updates++;
    }
    // else: rows are identical (timestamp updated but no actual changes)
  }

  // Get remote row count for stats
  diff.stats.remoteRows = await remoteReader.getRowCount(tableName);

  logger.info(
    `Incremental diff for ${tableName}: ` +
    `${diff.stats.inserts} inserts, ${diff.stats.updates} updates ` +
    `(scanned ${diff.stats.scannedRows} rows)`
  );

  // Note: Cannot detect deletes without full scan
  if (diff.stats.localRows > diff.stats.remoteRows) {
    logger.warn(
      `${tableName}: Local has more rows (${diff.stats.localRows}) than remote (${diff.stats.remoteRows}). ` +
      `Deletes cannot be detected with incremental sync. Use --full-sync to detect deletions.`
    );
  }

  return diff;
}

/**
 * Full diff using primary key (when no local data exists but PK is available)
 */
async function fullPrimaryKeyDiff(remoteReader, localWriter, tableName, pk, chunkSize) {
  const diff = {
    tableName,
    primaryKey: pk,
    hasTimestamps: true,
    incremental: false,
    toInsert: [],
    toUpdate: [],
    toDelete: [],
    stats: {
      remoteRows: 0,
      localRows: 0,
      inserts: 0,
      updates: 0,
      deletes: 0,
    },
  };

  // Get all remote rows (all will be inserts since local is empty)
  for await (const chunk of remoteReader.getTableDataChunked(tableName, chunkSize, pk[0])) {
    for (const row of chunk) {
      diff.toInsert.push(row);
      diff.stats.inserts++;
      diff.stats.remoteRows++;
    }
  }

  logger.info(`Full PK diff for ${tableName}: ${diff.stats.inserts} rows to insert`);

  return diff;
}

/**
 * Build a string key from primary key columns
 */
function buildPrimaryKeyValue(row, primaryKey) {
  return primaryKey.map((col) => String(row[col])).join('|');
}

/**
 * Check if two rows are equal
 */
function rowsEqual(row1, row2) {
  const keys1 = Object.keys(row1).sort();
  const keys2 = Object.keys(row2).sort();

  if (keys1.length !== keys2.length) return false;

  for (let i = 0; i < keys1.length; i++) {
    if (keys1[i] !== keys2[i]) return false;

    const val1 = normalizeValue(row1[keys1[i]]);
    const val2 = normalizeValue(row2[keys2[i]]);

    if (val1 !== val2) return false;
  }

  return true;
}

/**
 * Normalize a value for comparison
 */
function normalizeValue(val) {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

/**
 * Get list of columns that changed between two rows
 */
function getRowChanges(localRow, remoteRow) {
  const changes = [];

  for (const key of Object.keys(remoteRow)) {
    const localVal = normalizeValue(localRow[key]);
    const remoteVal = normalizeValue(remoteRow[key]);

    if (localVal !== remoteVal) {
      changes.push({
        column: key,
        from: localRow[key],
        to: remoteRow[key],
      });
    }
  }

  return changes;
}

/**
 * Format data diff for display
 * @param {object} diff - Data diff object
 * @param {number} maxDisplay - Max items to show per category
 * @returns {string} Formatted diff string
 */
export function formatDataDiff(diff, maxDisplay = 10) {
  const lines = [];
  lines.push(`\n=== Table: ${diff.tableName} ===`);
  lines.push(`Primary Key: ${diff.primaryKey.join(', ') || 'NONE'}`);
  lines.push(`Remote rows: ${diff.stats.remoteRows}, Local rows: ${diff.stats.localRows}`);

  if (diff.fullReplace) {
    lines.push('\n[WARNING] No primary key - full table replacement required');
    lines.push(`This will DELETE all ${diff.stats.localRows} local rows and INSERT ${diff.stats.remoteRows} remote rows`);
    return lines.join('\n');
  }

  // Inserts
  if (diff.toInsert.length > 0) {
    lines.push(`\n[INSERT] ${diff.stats.inserts} rows to insert`);
    const displayCount = Math.min(diff.toInsert.length, maxDisplay);
    for (let i = 0; i < displayCount; i++) {
      const row = diff.toInsert[i];
      const pkVal = buildPrimaryKeyValue(row, diff.primaryKey);
      lines.push(`  + ${pkVal}`);
    }
    if (diff.toInsert.length > maxDisplay) {
      lines.push(`  ... and ${diff.toInsert.length - maxDisplay} more`);
    }
  }

  // Updates
  if (diff.toUpdate.length > 0) {
    lines.push(`\n[UPDATE] ${diff.stats.updates} rows to update`);
    const displayCount = Math.min(diff.toUpdate.length, maxDisplay);
    for (let i = 0; i < displayCount; i++) {
      const { remote, changes } = diff.toUpdate[i];
      const pkVal = buildPrimaryKeyValue(remote, diff.primaryKey);
      lines.push(`  ~ ${pkVal}`);
      for (const change of changes.slice(0, 3)) {
        lines.push(`      ${change.column}: ${formatValue(change.from)} -> ${formatValue(change.to)}`);
      }
      if (changes.length > 3) {
        lines.push(`      ... and ${changes.length - 3} more columns`);
      }
    }
    if (diff.toUpdate.length > maxDisplay) {
      lines.push(`  ... and ${diff.toUpdate.length - maxDisplay} more`);
    }
  }

  // Deletes
  if (diff.toDelete.length > 0) {
    lines.push(`\n[DELETE] ${diff.stats.deletes} rows to delete`);
    const displayCount = Math.min(diff.toDelete.length, maxDisplay);
    for (let i = 0; i < displayCount; i++) {
      const row = diff.toDelete[i];
      const pkVal = buildPrimaryKeyValue(row, diff.primaryKey);
      lines.push(`  - ${pkVal}`);
    }
    if (diff.toDelete.length > maxDisplay) {
      lines.push(`  ... and ${diff.toDelete.length - maxDisplay} more`);
    }
  }

  if (diff.stats.inserts === 0 && diff.stats.updates === 0 && diff.stats.deletes === 0) {
    lines.push('\n[OK] Table is in sync');
  }

  return lines.join('\n');
}

/**
 * Format a value for display
 */
function formatValue(val) {
  if (val === null) return 'NULL';
  if (val === undefined) return 'undefined';
  const str = String(val);
  return str.length > 30 ? str.substring(0, 27) + '...' : str;
}

/**
 * Compare data for all tables
 * @param {object} remoteReader - Remote database reader
 * @param {object} localWriter - Local database writer
 * @param {string[]} tables - Tables to compare
 * @param {number} chunkSize - Chunk size for large tables
 * @returns {Promise<object[]>} Array of data diffs
 */
export async function compareAllData(remoteReader, localWriter, tables, chunkSize = 5000) {
  const diffs = [];

  logger.info(`Comparing data for ${tables.length} tables...`);

  for (const tableName of tables) {
    try {
      const diff = await diffTableData(remoteReader, localWriter, tableName, { chunkSize });
      diffs.push(diff);
    } catch (err) {
      logger.error(`Error comparing data for ${tableName}: ${err.message}`);
      diffs.push({
        tableName,
        error: err.message,
        stats: { inserts: 0, updates: 0, deletes: 0 },
      });
    }
  }

  return diffs;
}

export default {
  diffTableData,
  formatDataDiff,
  compareAllData,
};
