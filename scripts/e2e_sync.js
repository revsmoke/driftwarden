#!/usr/bin/env bun

import fs from 'fs';
import mysql from 'mysql2/promise';
import { spawn } from 'child_process';

const CONFIG_PATH = 'config/config.json';
const DEFAULT_TABLE = 'postal_address';
const REPORT_DIR = 'logs';

function timestamp() {
  return new Date().toISOString();
}

function truncate(text, max = 4000) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}...<truncated>` : text;
}

async function runCommand(command, args, input = null) {
  return await new Promise((resolve) => {
    const proc = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => (stdout += data.toString()));
    proc.stderr.on('data', (data) => (stderr += data.toString()));

    proc.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });

    if (input) {
      proc.stdin.write(input);
    }
    proc.stdin.end();
  });
}

async function runSync(args, input = null) {
  return await runCommand('bun', ['run', 'sync', '--', ...args], input);
}

function ensureReportDir() {
  if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
  }
}

async function main() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Missing config: ${CONFIG_PATH}`);
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const table = process.argv[2] || DEFAULT_TABLE;

  const report = {
    startedAt: timestamp(),
    table,
    steps: [],
  };

  const record = (step, data = {}) => {
    report.steps.push({ step, at: timestamp(), ...data });
  };

  const db = config.local.mysql;
  const conn = await mysql.createConnection({
    host: db.host,
    port: db.port,
    user: db.user,
    password: db.password,
    database: db.database,
  });

  try {
    // Dry-run preview
    record('dry_run.start', { args: ['--tables', table, '--dry-run'] });
    const dryRun = await runSync(['--tables', table, '--dry-run']);
    record('dry_run.result', {
      code: dryRun.code,
      stdout: truncate(dryRun.stdout),
      stderr: truncate(dryRun.stderr),
    });
    if (dryRun.code !== 0) throw new Error('Dry-run failed');

    // Per-table delete path: insert local-only row then delete via full-sync per-table
    const [insertRes] = await conn.execute(
      `INSERT INTO ${table} (uuid, created_at, streetAddress, addressLocality, postalCode, addressCountry)
       VALUES (UUID(), NOW(), ?, ?, ?, ?)`,
      ['Driftwarden E2E Per-Table', 'Testville', '00000', 'US']
    );
    const [insertRows] = await conn.execute(
      `SELECT id, uuid FROM ${table} WHERE id = ?`,
      [insertRes.insertId]
    );
    const perTableUuid = insertRows?.[0]?.uuid;
    record('per_table.insert_local', { id: insertRes.insertId, uuid: perTableUuid });

    record('per_table.sync.start', { args: ['--tables', table, '--full-sync', '--per-table'] });
    const perTableSync = await runSync(
      ['--tables', table, '--full-sync', '--per-table'],
      'y\n'
    );
    record('per_table.sync.result', {
      code: perTableSync.code,
      stdout: truncate(perTableSync.stdout),
      stderr: truncate(perTableSync.stderr),
    });
    if (perTableSync.code !== 0) throw new Error('Per-table full-sync failed');

    const [perTableCount] = await conn.execute(
      `SELECT COUNT(*) as count FROM ${table} WHERE uuid = ?`,
      [perTableUuid]
    );
    record('per_table.verify_deleted', { uuid: perTableUuid, count: perTableCount[0]?.count });

    // YOLO insert path: delete a local row then reinsert via full-sync yolo
    const [rowRows] = await conn.execute(
      `SELECT id, uuid FROM ${table} ORDER BY id DESC LIMIT 1`
    );
    const target = rowRows?.[0];
    if (!target) throw new Error('No rows available for insert-path test');
    await conn.execute(`DELETE FROM ${table} WHERE id = ?`, [target.id]);
    record('yolo.delete_local_row', { id: target.id, uuid: target.uuid });

    record('yolo.sync.start', { args: ['--tables', table, '--full-sync', '--yolo'] });
    const yoloSync = await runSync(['--tables', table, '--full-sync', '--yolo']);
    record('yolo.sync.result', {
      code: yoloSync.code,
      stdout: truncate(yoloSync.stdout),
      stderr: truncate(yoloSync.stderr),
    });
    if (yoloSync.code !== 0) throw new Error('YOLO full-sync failed');

    const [yoloCount] = await conn.execute(
      `SELECT COUNT(*) as count FROM ${table} WHERE uuid = ?`,
      [target.uuid]
    );
    record('yolo.verify_inserted', { uuid: target.uuid, count: yoloCount[0]?.count });

    // Update path: modify a row then restore via full-sync yolo
    const [updateRows] = await conn.execute(
      `SELECT id, uuid, streetAddress FROM ${table} ORDER BY id DESC LIMIT 1`
    );
    const updateTarget = updateRows?.[0];
    if (!updateTarget) throw new Error('No rows available for update-path test');
    const updateValue = 'Driftwarden E2E Update';
    await conn.execute(`UPDATE ${table} SET streetAddress = ? WHERE id = ?`, [
      updateValue,
      updateTarget.id,
    ]);
    record('update.modify_local', {
      id: updateTarget.id,
      uuid: updateTarget.uuid,
      oldStreetAddress: updateTarget.streetAddress,
      newStreetAddress: updateValue,
    });

    record('update.sync.start', { args: ['--tables', table, '--full-sync', '--yolo'] });
    const updateSync = await runSync(['--tables', table, '--full-sync', '--yolo']);
    record('update.sync.result', {
      code: updateSync.code,
      stdout: truncate(updateSync.stdout),
      stderr: truncate(updateSync.stderr),
    });
    if (updateSync.code !== 0) throw new Error('Update full-sync failed');

    const [updateVerifyRows] = await conn.execute(
      `SELECT streetAddress FROM ${table} WHERE id = ?`,
      [updateTarget.id]
    );
    record('update.verify_restored', {
      id: updateTarget.id,
      streetAddress: updateVerifyRows?.[0]?.streetAddress,
      expected: updateTarget.streetAddress,
    });
  } finally {
    await conn.end();
    report.finishedAt = timestamp();
    ensureReportDir();
    const reportPath = `${REPORT_DIR}/e2e-sync-report.json`;
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`E2E report written to ${reportPath}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
