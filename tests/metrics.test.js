/**
 * Metrics utility tests
 */

import { describe, test, expect } from 'bun:test';
import { createMetricsCollector, formatMetricsSummary } from '../src/utils/metrics.js';

describe('Metrics', () => {
  test('createMetricsCollector initializes with zero values', () => {
    const collector = createMetricsCollector();
    const metrics = collector.getMetrics();

    expect(metrics.tables.total).toBe(0);
    expect(metrics.data.rowsInserted).toBe(0);
    expect(metrics.issues.errors).toBe(0);
  });

  test('records table processing', () => {
    const collector = createMetricsCollector();

    collector.recordTable('synced');
    collector.recordTable('synced');
    collector.recordTable('skipped');
    collector.recordTable('failed');

    const metrics = collector.getMetrics();
    expect(metrics.tables.total).toBe(4);
    expect(metrics.tables.synced).toBe(2);
    expect(metrics.tables.skipped).toBe(1);
    expect(metrics.tables.failed).toBe(1);
  });

  test('records data diff metrics', () => {
    const collector = createMetricsCollector();

    collector.recordDataDiff({
      stats: {
        remoteRows: 1000,
        inserts: 50,
        updates: 30,
        deletes: 10,
      },
      incremental: true,
    });

    const metrics = collector.getMetrics();
    expect(metrics.data.rowsScanned).toBe(1000);
    expect(metrics.data.rowsInserted).toBe(50);
    expect(metrics.data.rowsUpdated).toBe(30);
    expect(metrics.data.rowsDeleted).toBe(10);
    expect(metrics.performance.incrementalSyncTables).toBe(1);
  });

  test('records connection attempts and success', () => {
    const collector = createMetricsCollector();

    collector.recordConnectionAttempt('ssh');
    collector.recordConnectionAttempt('ssh');
    collector.recordConnectionSuccess('ssh');
    collector.recordConnectionAttempt('remote');
    collector.recordConnectionSuccess('remote');

    const metrics = collector.getMetrics();
    expect(metrics.connections.sshTunnelAttempts).toBe(2);
    expect(metrics.connections.sshTunnelSuccess).toBe(true);
    expect(metrics.connections.remoteMysqlAttempts).toBe(1);
    expect(metrics.connections.remoteMysqlSuccess).toBe(true);
  });

  test('finalize calculates duration', async () => {
    const collector = createMetricsCollector();

    // Small delay to ensure duration > 0
    await new Promise((r) => setTimeout(r, 10));

    const metrics = collector.finalize();
    expect(metrics.duration).toBeGreaterThan(0);
    expect(metrics.endTime).toBeGreaterThan(metrics.startTime);
  });

  test('formatMetricsSummary returns formatted string', () => {
    const collector = createMetricsCollector();
    collector.recordTable('synced');
    collector.recordDataDiff({
      stats: { remoteRows: 100, inserts: 5, updates: 3, deletes: 1 },
    });
    const metrics = collector.finalize();

    const summary = formatMetricsSummary(metrics);

    expect(summary).toContain('SYNC SUMMARY');
    expect(summary).toContain('Tables:');
    expect(summary).toContain('Total: 1');
    expect(summary).toContain('Synced: 1');
    expect(summary).toContain('Rows scanned: 100');
    expect(summary).toContain('Inserted: 5');
  });

  test('records errors and warnings', () => {
    const collector = createMetricsCollector();

    collector.recordError();
    collector.recordError();
    collector.recordWarning();
    collector.recordDestructiveChange();

    const metrics = collector.getMetrics();
    expect(metrics.issues.errors).toBe(2);
    expect(metrics.issues.warnings).toBe(1);
    expect(metrics.issues.destructiveChangesDetected).toBe(1);
  });
});
