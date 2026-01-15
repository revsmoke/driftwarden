/**
 * CLI tests
 */

import { describe, test, expect } from 'bun:test';
import { spawn } from 'child_process';

function runCLI(args) {
  return new Promise((resolve) => {
    const proc = spawn('bun', ['src/cli.js', ...args], {
      cwd: process.cwd(),
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => (stdout += data.toString()));
    proc.stderr.on('data', (data) => (stderr += data.toString()));

    proc.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

describe('CLI', () => {
  test('--help shows usage', async () => {
    const { code, stdout } = await runCLI(['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('Driftwarden');
    expect(stdout).toContain('USAGE');
    expect(stdout).toContain('sync');
    expect(stdout).toContain('--config');
    expect(stdout).toContain('--yolo');
    expect(stdout).toContain('--dry-run');
  });

  test('--version shows version', async () => {
    const { code, stdout } = await runCLI(['--version']);
    expect(code).toBe(0);
    expect(stdout).toContain('Driftwarden v');
  });

  test('no args shows help', async () => {
    const { code, stdout } = await runCLI([]);
    expect(code).toBe(0);
    expect(stdout).toContain('USAGE');
  });

  test('unknown option exits with error', async () => {
    const { code, stderr } = await runCLI(['--invalid-option']);
    expect(code).toBe(1);
    expect(stderr).toContain('Unknown option');
  });

  test('issues command runs without error', async () => {
    const { code, stdout } = await runCLI(['issues']);
    expect(code).toBe(0);
    expect(stdout).toContain('Issue Tracker');
  });

  test('sync with missing config shows error', async () => {
    const { code } = await runCLI(['sync', '--config', 'nonexistent.json']);
    expect(code).toBe(1);
  });
});
