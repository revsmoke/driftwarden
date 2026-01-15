#!/usr/bin/env bun

/**
 * Driftwarden CLI - MySQL schema + data sync tool
 * Usage: driftwarden sync --config config/config.json [--tables users,orders] [--yolo]
 */

import { loadConfig } from './config/loader.js';
import { logger } from './utils/logger.js';
import { createTunnelWithRetry } from './tunnel/ssh-tunnel.js';
import { createRemoteReader } from './db/remote-reader.js';
import { createLocalWriter } from './db/local-writer.js';
import { compareAllSchemas } from './diff/schema-diff.js';
import { compareAllData } from './diff/data-diff.js';
import { interactiveConfirm, displayDryRun } from './ui/preview.js';
import { executeSync, formatExecutionSummary } from './executor/change-executor.js';
import { createIssueFromError, listIssues, getIssueSummary } from './issues/tracker.js';

const VERSION = '0.1.0';

function printHelp() {
  console.log(`
Driftwarden v${VERSION} - MySQL schema + data sync tool

USAGE:
  driftwarden sync [options]
  driftwarden issues [options]

COMMANDS:
  sync          Sync remote database to local (schema + data)
  issues        List tracked issues

OPTIONS:
  --config, -c  Path to config file (default: config/config.json)
  --tables, -t  Comma-separated list of tables to sync (default: all)
  --yolo        Auto-accept all changes without confirmation
  --per-table   Confirm changes for each table individually
  --dry-run     Preview changes without applying them
  --full-sync   Force full comparison (detect deletes), disables incremental sync
  --help, -h    Show this help message
  --version, -v Show version

EXAMPLES:
  driftwarden sync
  driftwarden sync --tables users,orders
  driftwarden sync --config custom-config.json --yolo
  driftwarden sync --dry-run
  driftwarden issues

SAFETY:
  - Remote database is READ-ONLY (no writes ever)
  - Local writes require confirmation unless --yolo is set
`);
}

function printVersion() {
  console.log(`Driftwarden v${VERSION}`);
}

function parseArgs(args) {
  const parsed = {
    command: null,
    config: 'config/config.json',
    tables: [],
    yolo: false,
    perTable: false,
    dryRun: false,
    fullSync: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case 'sync':
        parsed.command = 'sync';
        break;
      case 'issues':
        parsed.command = 'issues';
        break;
      case '--config':
      case '-c':
        parsed.config = args[++i];
        break;
      case '--tables':
      case '-t':
        parsed.tables = args[++i]?.split(',').map(t => t.trim()).filter(Boolean) || [];
        break;
      case '--yolo':
        parsed.yolo = true;
        break;
      case '--per-table':
        parsed.perTable = true;
        break;
      case '--dry-run':
        parsed.dryRun = true;
        break;
      case '--full-sync':
        parsed.fullSync = true;
        break;
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      case '--version':
      case '-v':
        parsed.version = true;
        break;
      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
    }
  }

  return parsed;
}

async function runSync(options) {
  const { config: configPath, tables, yolo, perTable, dryRun, fullSync } = options;

  logger.info('Starting Driftwarden sync...');

  // Load and validate config
  const config = await loadConfig(configPath);
  if (!config) {
    logger.error('Failed to load config. Exiting.');
    process.exit(1);
  }

  // Configure logger with file outputs from config
  if (config.logging) {
    logger.configure(config.logging);
  }

  // Override config with CLI options
  if (tables.length > 0) {
    config.sync.tables = tables;
  }
  if (yolo) {
    config.sync.yolo = true;
    config.sync.confirm = false;
  }

  // Log sync start activity
  logger.syncStart({
    tables: config.sync.tables,
    yolo: config.sync.yolo,
    perTable,
    dryRun,
    fullSync,
  });

  logger.info(`Config loaded from: ${configPath}`);
  logger.info(`Tables to sync: ${config.sync.tables.length > 0 ? config.sync.tables.join(', ') : 'ALL'}`);
  logger.info(`YOLO mode: ${config.sync.yolo ? 'ENABLED' : 'DISABLED'}`);
  logger.info(`Per-table confirmation: ${perTable ? 'ENABLED' : 'DISABLED'}`);
  logger.info(`Dry run: ${dryRun ? 'YES' : 'NO'}`);
  logger.info(`Full sync: ${fullSync ? 'YES' : 'NO'}`);

  let tunnel = null;
  let remoteReader = null;
  let localWriter = null;

  try {
    // Step 1: Establish SSH tunnel
    logger.info('Establishing SSH tunnel...');
    logger.connection('ssh', 'connecting', { host: config.ssh.host, port: config.ssh.port });
    tunnel = await createTunnelWithRetry(config);
    logger.connection('ssh', 'connected', { localPort: config.tunnel.localPort });
    logger.info(`SSH tunnel established on local port ${config.tunnel.localPort}`);

    // Step 2: Connect to remote MySQL (read-only) through tunnel
    logger.info('Connecting to remote MySQL (read-only)...');
    logger.connection('remote_mysql', 'connecting', { database: config.remote.mysql.database });
    const remoteConfig = {
      host: '127.0.0.1', // Through tunnel
      port: config.tunnel.localPort,
      user: config.remote.mysql.user,
      password: config.remote.mysql.password,
      database: config.remote.mysql.database,
    };
    remoteReader = await createRemoteReader(remoteConfig);
    logger.connection('remote_mysql', 'connected');

    // Step 3: Connect to local MySQL
    logger.info('Connecting to local MySQL...');
    logger.connection('local_mysql', 'connecting', { database: config.local.mysql.database });
    localWriter = await createLocalWriter(config.local.mysql);
    logger.connection('local_mysql', 'connected');

    // Step 4: Determine tables to sync
    let tablesToSync = config.sync.tables;
    if (!tablesToSync || tablesToSync.length === 0) {
      logger.info('No specific tables configured, fetching all tables from remote...');
      tablesToSync = await remoteReader.getTables();
    }
    logger.info(`Syncing ${tablesToSync.length} tables: ${tablesToSync.join(', ')}`);

    // Step 5: Diff schema
    logger.info('Comparing schemas...');
    const schemaDiffs = await compareAllSchemas(remoteReader, localWriter, tablesToSync);

    // Step 6: Diff data
    logger.info('Comparing data...');
    const dataDiffs = await compareAllData(remoteReader, localWriter, tablesToSync, {
      chunkSize: config.sync.chunkSize,
      useIncremental: !fullSync,
    });

    // Step 7: Display preview / dry-run
    if (dryRun) {
      displayDryRun(schemaDiffs, dataDiffs);
      logger.info('Dry run complete. No changes applied.');
      logger.syncComplete({ success: true, dryRun: true });
      return;
    }

    // Step 8: Get user confirmation (unless --yolo)
    const confirmation = await interactiveConfirm(schemaDiffs, dataDiffs, {
      yolo: config.sync.yolo,
      perTable: perTable,
    });

    if (!confirmation.approved) {
      logger.info('Sync cancelled by user.');
      logger.syncComplete({ success: false, cancelled: true });
      return;
    }

    // Step 9: Apply changes to local database
    logger.info('Applying changes to local database...');
    const results = await executeSync(
      localWriter,
      confirmation.schemaApproved,
      confirmation.dataApproved,
      {
        batchSize: config.sync.chunkSize,
        continueOnError: false,
      }
    );

    // Step 10: Display summary
    console.log(formatExecutionSummary(results));

    // Log sync completion
    logger.syncComplete(results);

    if (results.success) {
      logger.info('Sync completed successfully!');
    } else {
      logger.error('Sync completed with errors.');
      process.exit(1);
    }
  } catch (err) {
    logger.error(`Sync failed: ${err.message}`, err);
    logger.syncComplete({ success: false, error: err.message });

    // Create issue for tracking
    const issue = createIssueFromError(err, {
      command: 'sync',
      configPath,
      tables: tables.length > 0 ? tables : 'ALL',
      yolo,
      dryRun,
    });
    logger.info(`Issue created: ${issue.id} - ${issue.title}`);
    console.error(`\nIssue tracked: ${issue.id}`);
    console.error(`View details: cat issues/${issue.id}.md`);

    process.exit(1);
  } finally {
    // Cleanup connections
    if (remoteReader) {
      try {
        await remoteReader.close();
        logger.connection('remote_mysql', 'disconnected');
      } catch (e) {
        logger.warn(`Error closing remote connection: ${e.message}`);
      }
    }
    if (localWriter) {
      try {
        await localWriter.close();
        logger.connection('local_mysql', 'disconnected');
      } catch (e) {
        logger.warn(`Error closing local connection: ${e.message}`);
      }
    }
    if (tunnel) {
      try {
        tunnel.close();
        logger.connection('ssh', 'disconnected');
      } catch (e) {
        logger.warn(`Error closing SSH tunnel: ${e.message}`);
      }
    }
  }
}

function runIssues() {
  const summary = getIssueSummary();
  const issues = listIssues();

  console.log('\n=== Driftwarden Issue Tracker ===\n');

  if (issues.length === 0) {
    console.log('No issues recorded.');
    return;
  }

  console.log(`Total: ${summary.total} issues`);
  console.log(`  Open: ${summary.byStatus.open}`);
  console.log(`  Resolved: ${summary.byStatus.resolved}`);
  console.log('');

  if (summary.byStatus.open > 0) {
    console.log('Open Issues:');
    console.log('-'.repeat(60));

    const openIssues = issues.filter((i) => i.status === 'open');
    for (const issue of openIssues) {
      const severity = issue.severity.toUpperCase().padEnd(8);
      console.log(`  [${severity}] ${issue.id}: ${issue.title}`);
      console.log(`             Category: ${issue.category} | Created: ${issue.createdAt.split('T')[0]}`);
    }
  }

  console.log('');
  console.log(`View issue details: cat issues/ISSUE-XXXX.md`);
}

async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help || args.length === 0) {
    printHelp();
    process.exit(0);
  }

  if (options.version) {
    printVersion();
    process.exit(0);
  }

  if (options.command === 'sync') {
    await runSync(options);
  } else if (options.command === 'issues') {
    runIssues();
  } else {
    console.error('Unknown command. Use --help for usage.');
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error(`Fatal error: ${err.message}`);

  // Create issue for fatal errors
  const issue = createIssueFromError(err, { command: 'main', fatal: true });
  console.error(`\nFatal error tracked: ${issue.id}`);

  process.exit(1);
});
