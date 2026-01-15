/**
 * Metrics Summary for Driftwarden
 * Tracks and reports sync operation statistics
 */

import { logger } from './logger.js';

/**
 * Create a metrics collector for a sync session
 * @returns {object} Metrics collector
 */
export function createMetricsCollector() {
  const startTime = Date.now();

  const metrics = {
    startTime,
    endTime: null,
    duration: null,

    // Connection metrics
    connections: {
      sshTunnelAttempts: 0,
      sshTunnelSuccess: false,
      remoteMysqlAttempts: 0,
      remoteMysqlSuccess: false,
      localMysqlAttempts: 0,
      localMysqlSuccess: false,
    },

    // Table metrics
    tables: {
      total: 0,
      synced: 0,
      skipped: 0,
      failed: 0,
    },

    // Schema changes
    schema: {
      tablesCreated: 0,
      tablesModified: 0,
      columnsAdded: 0,
      columnsModified: 0,
      columnsDropped: 0,
      indexesAdded: 0,
      indexesDropped: 0,
    },

    // Data changes
    data: {
      rowsScanned: 0,
      rowsInserted: 0,
      rowsUpdated: 0,
      rowsDeleted: 0,
      bytesTransferred: 0,
    },

    // Performance
    performance: {
      incrementalSyncTables: 0,
      fullSyncTables: 0,
      streamingDiffTables: 0,
      retriesTotal: 0,
    },

    // Errors and warnings
    issues: {
      errors: 0,
      warnings: 0,
      destructiveChangesDetected: 0,
    },
  };

  return {
    /**
     * Record a connection attempt
     */
    recordConnectionAttempt(type) {
      if (type === 'ssh') metrics.connections.sshTunnelAttempts++;
      else if (type === 'remote') metrics.connections.remoteMysqlAttempts++;
      else if (type === 'local') metrics.connections.localMysqlAttempts++;
    },

    /**
     * Record a successful connection
     */
    recordConnectionSuccess(type) {
      if (type === 'ssh') metrics.connections.sshTunnelSuccess = true;
      else if (type === 'remote') metrics.connections.remoteMysqlSuccess = true;
      else if (type === 'local') metrics.connections.localMysqlSuccess = true;
    },

    /**
     * Record table processing result
     */
    recordTable(status) {
      metrics.tables.total++;
      if (status === 'synced') metrics.tables.synced++;
      else if (status === 'skipped') metrics.tables.skipped++;
      else if (status === 'failed') metrics.tables.failed++;
    },

    /**
     * Record schema changes from a diff
     */
    recordSchemaDiff(schemaDiff) {
      if (!schemaDiff) return;

      for (const diff of Array.isArray(schemaDiff) ? schemaDiff : [schemaDiff]) {
        if (diff.newTable) metrics.schema.tablesCreated++;
        if (diff.columnsAdded) metrics.schema.columnsAdded += diff.columnsAdded.length;
        if (diff.columnsModified) metrics.schema.columnsModified += diff.columnsModified.length;
        if (diff.columnsDropped) metrics.schema.columnsDropped += diff.columnsDropped.length;
        if (diff.indexesAdded) metrics.schema.indexesAdded += diff.indexesAdded.length;
        if (diff.indexesDropped) metrics.schema.indexesDropped += diff.indexesDropped.length;
        if (diff.columnsAdded?.length || diff.columnsModified?.length || diff.columnsDropped?.length) {
          metrics.schema.tablesModified++;
        }
      }
    },

    /**
     * Record data changes from a diff
     */
    recordDataDiff(dataDiff) {
      if (!dataDiff) return;

      for (const diff of Array.isArray(dataDiff) ? dataDiff : [dataDiff]) {
        metrics.data.rowsScanned += diff.stats?.remoteRows || 0;
        metrics.data.rowsInserted += diff.stats?.inserts || 0;
        metrics.data.rowsUpdated += diff.stats?.updates || 0;
        metrics.data.rowsDeleted += diff.stats?.deletes || 0;

        if (diff.incremental) {
          metrics.performance.incrementalSyncTables++;
        } else if (diff.fullReplace) {
          metrics.performance.fullSyncTables++;
        } else {
          metrics.performance.streamingDiffTables++;
        }
      }
    },

    /**
     * Record a retry attempt
     */
    recordRetry() {
      metrics.performance.retriesTotal++;
    },

    /**
     * Record an error
     */
    recordError() {
      metrics.issues.errors++;
    },

    /**
     * Record a warning
     */
    recordWarning() {
      metrics.issues.warnings++;
    },

    /**
     * Record destructive changes detected
     */
    recordDestructiveChange() {
      metrics.issues.destructiveChangesDetected++;
    },

    /**
     * Finalize metrics and calculate duration
     */
    finalize() {
      metrics.endTime = Date.now();
      metrics.duration = metrics.endTime - metrics.startTime;
      return metrics;
    },

    /**
     * Get current metrics snapshot
     */
    getMetrics() {
      return { ...metrics };
    },
  };
}

/**
 * Format metrics as a summary string
 * @param {object} metrics - Metrics object
 * @returns {string} Formatted summary
 */
export function formatMetricsSummary(metrics) {
  const lines = [];
  const duration = metrics.duration ? (metrics.duration / 1000).toFixed(2) : 'N/A';

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('                    SYNC SUMMARY');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('');

  // Duration
  lines.push(`⏱  Duration: ${duration}s`);
  lines.push('');

  // Tables
  lines.push('📊 Tables:');
  lines.push(`   Total: ${metrics.tables.total}`);
  lines.push(`   Synced: ${metrics.tables.synced}`);
  if (metrics.tables.skipped > 0) lines.push(`   Skipped: ${metrics.tables.skipped}`);
  if (metrics.tables.failed > 0) lines.push(`   Failed: ${metrics.tables.failed}`);
  lines.push('');

  // Schema changes
  const schemaChanges = metrics.schema.tablesCreated + metrics.schema.columnsAdded +
    metrics.schema.columnsModified + metrics.schema.columnsDropped;
  if (schemaChanges > 0) {
    lines.push('🔧 Schema Changes:');
    if (metrics.schema.tablesCreated > 0) lines.push(`   Tables created: ${metrics.schema.tablesCreated}`);
    if (metrics.schema.columnsAdded > 0) lines.push(`   Columns added: ${metrics.schema.columnsAdded}`);
    if (metrics.schema.columnsModified > 0) lines.push(`   Columns modified: ${metrics.schema.columnsModified}`);
    if (metrics.schema.columnsDropped > 0) lines.push(`   Columns dropped: ${metrics.schema.columnsDropped}`);
    lines.push('');
  }

  // Data changes
  lines.push('📝 Data Changes:');
  lines.push(`   Rows scanned: ${metrics.data.rowsScanned.toLocaleString()}`);
  lines.push(`   Inserted: ${metrics.data.rowsInserted.toLocaleString()}`);
  lines.push(`   Updated: ${metrics.data.rowsUpdated.toLocaleString()}`);
  lines.push(`   Deleted: ${metrics.data.rowsDeleted.toLocaleString()}`);
  lines.push('');

  // Performance
  lines.push('⚡ Performance:');
  if (metrics.performance.incrementalSyncTables > 0) {
    lines.push(`   Incremental sync: ${metrics.performance.incrementalSyncTables} tables`);
  }
  if (metrics.performance.streamingDiffTables > 0) {
    lines.push(`   Streaming diff: ${metrics.performance.streamingDiffTables} tables`);
  }
  if (metrics.performance.fullSyncTables > 0) {
    lines.push(`   Full sync: ${metrics.performance.fullSyncTables} tables`);
  }
  if (metrics.performance.retriesTotal > 0) {
    lines.push(`   Retries: ${metrics.performance.retriesTotal}`);
  }
  lines.push('');

  // Issues
  if (metrics.issues.errors > 0 || metrics.issues.warnings > 0 || metrics.issues.destructiveChangesDetected > 0) {
    lines.push('⚠️  Issues:');
    if (metrics.issues.errors > 0) lines.push(`   Errors: ${metrics.issues.errors}`);
    if (metrics.issues.warnings > 0) lines.push(`   Warnings: ${metrics.issues.warnings}`);
    if (metrics.issues.destructiveChangesDetected > 0) {
      lines.push(`   Destructive changes: ${metrics.issues.destructiveChangesDetected}`);
    }
    lines.push('');
  }

  lines.push('═══════════════════════════════════════════════════════════');

  return lines.join('\n');
}

/**
 * Log metrics summary to console
 * @param {object} metrics - Metrics object
 */
export function logMetricsSummary(metrics) {
  const summary = formatMetricsSummary(metrics);
  console.log(summary);

  // Also log as activity
  logger.activity('sync_complete', {
    duration: metrics.duration,
    tables: metrics.tables,
    dataChanges: {
      inserted: metrics.data.rowsInserted,
      updated: metrics.data.rowsUpdated,
      deleted: metrics.data.rowsDeleted,
    },
    issues: metrics.issues,
  });
}

export default {
  createMetricsCollector,
  formatMetricsSummary,
  logMetricsSummary,
};
