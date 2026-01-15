/**
 * Config loader tests
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { loadConfig } from '../src/config/loader.js';

const TEST_CONFIG_DIR = 'tests/fixtures';
const TEST_CONFIG_PATH = `${TEST_CONFIG_DIR}/test-config.json`;
const TEST_KEY_PATH = `${TEST_CONFIG_DIR}/test-key`;

const validConfig = {
  ssh: {
    host: 'example.com',
    port: 22,
    user: 'testuser',
    privateKeyPath: TEST_KEY_PATH,
  },
  tunnel: {
    localPort: 33306,
    remoteHost: '127.0.0.1',
    remotePort: 3306,
  },
  remote: {
    mysql: {
      host: '127.0.0.1',
      port: 3306,
      user: 'remote_user',
      password: 'remote_pass',
      database: 'remote_db',
    },
  },
  local: {
    mysql: {
      host: '127.0.0.1',
      port: 3306,
      user: 'local_user',
      password: 'local_pass',
      database: 'local_db',
    },
  },
  sync: {
    chunkSize: 1000,
    confirm: true,
  },
  retry: {
    maxAttempts: 3,
    baseDelayMs: 500,
    maxDelayMs: 10000,
    multiplier: 2,
  },
  logging: {
    level: 'INFO',
  },
};

describe('Config Loader', () => {
  beforeEach(() => {
    if (!existsSync(TEST_CONFIG_DIR)) {
      mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    }
    // Create fake SSH key file
    writeFileSync(TEST_KEY_PATH, 'fake-key-content');
  });

  afterEach(() => {
    if (existsSync(TEST_CONFIG_PATH)) unlinkSync(TEST_CONFIG_PATH);
    if (existsSync(TEST_KEY_PATH)) unlinkSync(TEST_KEY_PATH);
  });

  test('loads valid config successfully', async () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(validConfig));
    const config = await loadConfig(TEST_CONFIG_PATH);
    expect(config).not.toBeNull();
    expect(config.ssh.host).toBe('example.com');
    expect(config.local.mysql.database).toBe('local_db');
  });

  test('returns null for missing config file', async () => {
    const config = await loadConfig('nonexistent.json');
    expect(config).toBeNull();
  });

  test('returns null for invalid JSON', async () => {
    writeFileSync(TEST_CONFIG_PATH, 'not valid json {{{');
    const config = await loadConfig(TEST_CONFIG_PATH);
    expect(config).toBeNull();
  });

  test('returns null when required fields missing', async () => {
    const incomplete = { ssh: { host: 'example.com' } };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(incomplete));
    const config = await loadConfig(TEST_CONFIG_PATH);
    expect(config).toBeNull();
  });

  test('returns null when SSH key file does not exist', async () => {
    const configWithBadKey = {
      ...validConfig,
      ssh: { ...validConfig.ssh, privateKeyPath: '/nonexistent/key' },
    };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(configWithBadKey));
    const config = await loadConfig(TEST_CONFIG_PATH);
    expect(config).toBeNull();
  });

  test('applies default values for optional fields', async () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(validConfig));
    const config = await loadConfig(TEST_CONFIG_PATH);
    expect(config).not.toBeNull();
    // Default values are applied
    expect(config.sync.tables).toEqual([]);
    expect(config.sync.yolo).toBe(false);
  });
});
