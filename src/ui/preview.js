/**
 * Change Preview + Confirmation UI for Driftwarden
 * Displays proposed changes and handles user confirmation
 */

import * as readline from 'readline';
import { formatSchemaDiff } from '../diff/schema-diff.js';
import { formatDataDiff } from '../diff/data-diff.js';
import { logger } from '../utils/logger.js';

/**
 * Display full sync preview
 * @param {object[]} schemaDiffs - Array of schema diff objects
 * @param {object[]} dataDiffs - Array of data diff objects
 * @returns {string} Formatted preview string
 */
export function generatePreview(schemaDiffs, dataDiffs) {
  const lines = [];

  lines.push('\n' + '='.repeat(60));
  lines.push('                 DRIFTWARDEN SYNC PREVIEW');
  lines.push('='.repeat(60));

  // Summary
  const schemaChanges = schemaDiffs.filter((d) => d.hasChanges).length;
  const dataChanges = dataDiffs.filter((d) =>
    d.stats.inserts > 0 || d.stats.updates > 0 || d.stats.deletes > 0
  ).length;

  lines.push(`\nSUMMARY:`);
  lines.push(`  Tables with schema changes: ${schemaChanges}`);
  lines.push(`  Tables with data changes: ${dataChanges}`);

  // Total operation counts
  let totalInserts = 0;
  let totalUpdates = 0;
  let totalDeletes = 0;

  for (const diff of dataDiffs) {
    totalInserts += diff.stats?.inserts || 0;
    totalUpdates += diff.stats?.updates || 0;
    totalDeletes += diff.stats?.deletes || 0;
  }

  lines.push(`\n  Total operations:`);
  lines.push(`    Inserts: ${totalInserts}`);
  lines.push(`    Updates: ${totalUpdates}`);
  lines.push(`    Deletes: ${totalDeletes}`);

  // Schema changes detail
  if (schemaChanges > 0) {
    lines.push('\n' + '-'.repeat(60));
    lines.push('SCHEMA CHANGES');
    lines.push('-'.repeat(60));

    for (const diff of schemaDiffs) {
      if (diff.hasChanges) {
        lines.push(formatSchemaDiff(diff));
      }
    }
  }

  // Data changes detail
  if (dataChanges > 0) {
    lines.push('\n' + '-'.repeat(60));
    lines.push('DATA CHANGES');
    lines.push('-'.repeat(60));

    for (const diff of dataDiffs) {
      if (diff.stats.inserts > 0 || diff.stats.updates > 0 || diff.stats.deletes > 0) {
        lines.push(formatDataDiff(diff));
      }
    }
  }

  // Warnings
  const warnings = [];

  // Check for tables without primary keys
  const noPkTables = dataDiffs.filter((d) => d.fullReplace);
  if (noPkTables.length > 0) {
    warnings.push(
      `${noPkTables.length} table(s) have no primary key and require full replacement`
    );
  }

  // Check for column removals
  const colRemovals = schemaDiffs.filter((d) => d.columnsToRemove?.length > 0);
  if (colRemovals.length > 0) {
    warnings.push(
      `${colRemovals.length} table(s) have columns to be removed (DATA LOSS)`
    );
  }

  // Check for deletes
  if (totalDeletes > 0) {
    warnings.push(`${totalDeletes} row(s) will be deleted from local database`);
  }

  if (warnings.length > 0) {
    lines.push('\n' + '-'.repeat(60));
    lines.push('⚠️  WARNINGS');
    lines.push('-'.repeat(60));
    for (const warning of warnings) {
      lines.push(`  ! ${warning}`);
    }
  }

  lines.push('\n' + '='.repeat(60));

  return lines.join('\n');
}

/**
 * Prompt user for confirmation
 * @param {string} message - Prompt message
 * @returns {Promise<boolean>} True if user confirms
 */
export async function confirm(message) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} [y/N]: `, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === 'y' || normalized === 'yes');
    });
  });
}

/**
 * Threshold for "large delete" warnings
 */
const LARGE_DELETE_THRESHOLD = 100;

/**
 * Detect destructive changes that require explicit confirmation
 * @param {object[]} schemaDiffs - Schema diffs
 * @param {object[]} dataDiffs - Data diffs
 * @returns {object} Destructive change summary
 */
export function detectDestructiveChanges(schemaDiffs, dataDiffs) {
  const destructive = {
    hasDestructive: false,
    columnRemovals: [],
    fullReplacements: [],
    largeDeletes: [],
  };

  // Check for column removals (DATA LOSS)
  for (const diff of schemaDiffs) {
    if (diff.columnsToRemove?.length > 0) {
      destructive.columnRemovals.push({
        table: diff.tableName,
        columns: diff.columnsToRemove.map((c) => c.name || c),
      });
      destructive.hasDestructive = true;
    }
  }

  // Check for full table replacements (no PK)
  for (const diff of dataDiffs) {
    if (diff.fullReplace) {
      destructive.fullReplacements.push({
        table: diff.tableName,
        rowCount: diff.stats?.inserts || 0,
      });
      destructive.hasDestructive = true;
    }
  }

  // Check for large deletes
  for (const diff of dataDiffs) {
    if (diff.stats?.deletes >= LARGE_DELETE_THRESHOLD) {
      destructive.largeDeletes.push({
        table: diff.tableName,
        deleteCount: diff.stats.deletes,
      });
      destructive.hasDestructive = true;
    }
  }

  return destructive;
}

/**
 * Prompt for explicit destructive change confirmation
 * @param {object} destructive - Destructive change summary
 * @returns {Promise<boolean>} True if user confirms all destructive changes
 */
export async function confirmDestructiveChanges(destructive) {
  console.log('\n' + '!'.repeat(60));
  console.log('           ⚠️  DESTRUCTIVE CHANGES DETECTED');
  console.log('!'.repeat(60));
  console.log('\nThe following operations will cause DATA LOSS or major changes:\n');

  // Column removals
  if (destructive.columnRemovals.length > 0) {
    console.log('📛 COLUMN REMOVALS (data will be permanently deleted):');
    for (const item of destructive.columnRemovals) {
      console.log(`   • ${item.table}: dropping columns [${item.columns.join(', ')}]`);
    }
    console.log('');
  }

  // Full replacements
  if (destructive.fullReplacements.length > 0) {
    console.log('🔄 FULL TABLE REPLACEMENTS (no primary key - all rows replaced):');
    for (const item of destructive.fullReplacements) {
      console.log(`   • ${item.table}: replacing with ${item.rowCount} rows`);
    }
    console.log('');
  }

  // Large deletes
  if (destructive.largeDeletes.length > 0) {
    console.log(`🗑️  LARGE DELETES (${LARGE_DELETE_THRESHOLD}+ rows):`);
    for (const item of destructive.largeDeletes) {
      console.log(`   • ${item.table}: deleting ${item.deleteCount} rows`);
    }
    console.log('');
  }

  console.log('!'.repeat(60));

  // Require explicit "CONFIRM" for destructive changes
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('\nType "CONFIRM" to proceed with destructive changes: ', (answer) => {
      rl.close();
      resolve(answer.trim() === 'CONFIRM');
    });
  });
}

/**
 * Prompt for per-table confirmation
 * @param {string} tableName - Table name
 * @param {object} changes - Changes summary
 * @returns {Promise<boolean>} True if user confirms
 */
export async function confirmTable(tableName, changes) {
  const summary = [];
  if (changes.inserts > 0) summary.push(`${changes.inserts} inserts`);
  if (changes.updates > 0) summary.push(`${changes.updates} updates`);
  if (changes.deletes > 0) summary.push(`${changes.deletes} deletes`);

  const message = `Apply changes to ${tableName}? (${summary.join(', ')})`;
  return confirm(message);
}

/**
 * Interactive confirmation flow
 * @param {object[]} schemaDiffs - Schema diffs
 * @param {object[]} dataDiffs - Data diffs
 * @param {object} options - Options (yolo, perTable)
 * @returns {Promise<object>} Approved changes
 */
export async function interactiveConfirm(schemaDiffs, dataDiffs, options = {}) {
  const { yolo = false, perTable = false } = options;

  // Display preview
  console.log(generatePreview(schemaDiffs, dataDiffs));

  // Detect destructive changes
  const destructive = detectDestructiveChanges(schemaDiffs, dataDiffs);

  // If YOLO mode, auto-approve everything (but warn about destructive)
  if (yolo) {
    if (destructive.hasDestructive) {
      logger.warn('YOLO mode: auto-approving DESTRUCTIVE changes!');
      console.log('\n⚠️  WARNING: YOLO mode is auto-approving destructive changes!');
    }
    logger.info('YOLO mode enabled - auto-approving all changes');
    return {
      approved: true,
      schemaApproved: schemaDiffs.filter((d) => d.hasChanges),
      dataApproved: dataDiffs,
    };
  }

  // If destructive changes detected, require explicit confirmation first
  if (destructive.hasDestructive) {
    const destructiveApproved = await confirmDestructiveChanges(destructive);
    if (!destructiveApproved) {
      logger.info('Destructive changes rejected by user.');
      return {
        approved: false,
        schemaApproved: [],
        dataApproved: [],
      };
    }
    logger.info('Destructive changes explicitly approved by user.');
  }

  // Check if there are any changes
  const hasSchemaChanges = schemaDiffs.some((d) => d.hasChanges);
  const hasDataChanges = dataDiffs.some(
    (d) => d.stats.inserts > 0 || d.stats.updates > 0 || d.stats.deletes > 0
  );

  if (!hasSchemaChanges && !hasDataChanges) {
    console.log('\n✓ Everything is in sync. No changes needed.\n');
    return {
      approved: false,
      schemaApproved: [],
      dataApproved: [],
    };
  }

  // Per-table confirmation
  if (perTable) {
    const schemaApproved = [];
    const dataApproved = [];

    // Schema changes
    if (hasSchemaChanges) {
      console.log('\n--- Schema Changes ---');
      for (const diff of schemaDiffs) {
        if (diff.hasChanges) {
          const approved = await confirm(`Apply schema changes to ${diff.tableName}?`);
          if (approved) {
            schemaApproved.push(diff);
          }
        }
      }
    }

    // Data changes
    if (hasDataChanges) {
      console.log('\n--- Data Changes ---');
      for (const diff of dataDiffs) {
        if (diff.stats.inserts > 0 || diff.stats.updates > 0 || diff.stats.deletes > 0) {
          const approved = await confirmTable(diff.tableName, diff.stats);
          if (approved) {
            dataApproved.push(diff);
          }
        }
      }
    }

    return {
      approved: schemaApproved.length > 0 || dataApproved.length > 0,
      schemaApproved,
      dataApproved,
    };
  }

  // Bulk confirmation
  const approved = await confirm('\nApply all changes to local database?');

  if (approved) {
    return {
      approved: true,
      schemaApproved: schemaDiffs.filter((d) => d.hasChanges),
      dataApproved: dataDiffs,
    };
  }

  return {
    approved: false,
    schemaApproved: [],
    dataApproved: [],
  };
}

/**
 * Display dry-run summary (no confirmation needed)
 * @param {object[]} schemaDiffs - Schema diffs
 * @param {object[]} dataDiffs - Data diffs
 */
export function displayDryRun(schemaDiffs, dataDiffs) {
  console.log(generatePreview(schemaDiffs, dataDiffs));
  console.log('\n[DRY RUN] No changes were applied.\n');
}

/**
 * Generate and display post-sync metrics summary
 * @param {object} results - Sync results
 * @param {number} startTime - Start timestamp (Date.now())
 * @returns {string} Formatted metrics summary
 */
export function generateMetricsSummary(results, startTime) {
  const duration = Date.now() - startTime;
  const durationSec = (duration / 1000).toFixed(2);

  const lines = [];
  lines.push('\n' + '═'.repeat(60));
  lines.push('                    SYNC COMPLETE');
  lines.push('═'.repeat(60));

  // Timing
  lines.push(`\n⏱  Duration: ${durationSec}s`);

  // Schema changes
  const schemaApplied = results.schemaApplied || [];
  if (schemaApplied.length > 0) {
    lines.push(`\n📋 SCHEMA CHANGES APPLIED: ${schemaApplied.length} table(s)`);
    for (const diff of schemaApplied) {
      const changes = [];
      if (diff.columnsToAdd?.length) changes.push(`+${diff.columnsToAdd.length} cols`);
      if (diff.columnsToModify?.length) changes.push(`~${diff.columnsToModify.length} cols`);
      if (diff.columnsToRemove?.length) changes.push(`-${diff.columnsToRemove.length} cols`);
      lines.push(`   • ${diff.tableName}: ${changes.join(', ') || 'structure changes'}`);
    }
  }

  // Data changes
  const dataApplied = results.dataApplied || [];
  let totalInserts = 0;
  let totalUpdates = 0;
  let totalDeletes = 0;

  for (const diff of dataApplied) {
    totalInserts += diff.stats?.inserts || 0;
    totalUpdates += diff.stats?.updates || 0;
    totalDeletes += diff.stats?.deletes || 0;
  }

  if (dataApplied.length > 0) {
    lines.push(`\n📊 DATA CHANGES APPLIED: ${dataApplied.length} table(s)`);
    lines.push(`   Total rows affected:`);
    lines.push(`     ✚ Inserted: ${totalInserts}`);
    lines.push(`     ⟳ Updated:  ${totalUpdates}`);
    lines.push(`     ✖ Deleted:  ${totalDeletes}`);

    // Per-table breakdown for tables with significant changes
    const significantTables = dataApplied.filter(
      d => (d.stats?.inserts || 0) + (d.stats?.updates || 0) + (d.stats?.deletes || 0) > 10
    );
    if (significantTables.length > 0) {
      lines.push(`\n   Table breakdown:`);
      for (const diff of significantTables) {
        const { inserts = 0, updates = 0, deletes = 0 } = diff.stats || {};
        lines.push(`     ${diff.tableName}: +${inserts} ~${updates} -${deletes}`);
      }
    }
  }

  // Skipped/errors
  const skipped = results.skipped || [];
  const errors = results.errors || [];

  if (skipped.length > 0) {
    lines.push(`\n⏭  SKIPPED: ${skipped.length} table(s)`);
    for (const item of skipped.slice(0, 5)) {
      lines.push(`   • ${item.table}: ${item.reason}`);
    }
    if (skipped.length > 5) {
      lines.push(`   ... and ${skipped.length - 5} more`);
    }
  }

  if (errors.length > 0) {
    lines.push(`\n❌ ERRORS: ${errors.length}`);
    for (const err of errors.slice(0, 5)) {
      lines.push(`   • ${err.table || 'general'}: ${err.message}`);
    }
    if (errors.length > 5) {
      lines.push(`   ... and ${errors.length - 5} more`);
    }
  }

  // Final status
  const hasChanges = schemaApplied.length > 0 || totalInserts > 0 || totalUpdates > 0 || totalDeletes > 0;
  const hasErrors = errors.length > 0;

  lines.push('\n' + '─'.repeat(60));
  if (hasErrors) {
    lines.push('⚠️  Sync completed with errors. Check logs for details.');
  } else if (hasChanges) {
    lines.push('✓  Sync completed successfully!');
  } else {
    lines.push('✓  No changes needed - databases are in sync.');
  }
  lines.push('═'.repeat(60) + '\n');

  const summary = lines.join('\n');

  // Log metrics
  logger.activity('sync_complete', {
    durationMs: duration,
    schemaTablesChanged: schemaApplied.length,
    dataTablesChanged: dataApplied.length,
    totalInserts,
    totalUpdates,
    totalDeletes,
    errorsCount: errors.length,
    skippedCount: skipped.length,
  });

  return summary;
}

/**
 * Display post-sync metrics
 * @param {object} results - Sync results
 * @param {number} startTime - Start timestamp
 */
export function displayMetricsSummary(results, startTime) {
  console.log(generateMetricsSummary(results, startTime));
}

export default {
  generatePreview,
  confirm,
  confirmTable,
  detectDestructiveChanges,
  confirmDestructiveChanges,
  interactiveConfirm,
  displayDryRun,
  generateMetricsSummary,
  displayMetricsSummary,
};
