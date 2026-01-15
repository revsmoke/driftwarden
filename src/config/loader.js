/**
 * Config loader and validator for Driftwarden
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { logger } from '../utils/logger.js';

// Required config sections and their required fields
const SCHEMA = {
  ssh: ['host', 'port', 'user', 'privateKeyPath'],
  tunnel: ['localPort', 'remoteHost', 'remotePort'],
  remote: {
    mysql: ['host', 'port', 'user', 'password', 'database'],
  },
  local: {
    mysql: ['host', 'port', 'user', 'password', 'database'],
  },
  sync: ['chunkSize', 'confirm'],
  retry: ['maxAttempts', 'baseDelayMs', 'maxDelayMs', 'multiplier'],
  logging: ['level'],
};

/**
 * Validate a config section against schema
 */
function validateSection(config, schema, path = '') {
  const errors = [];

  for (const [key, value] of Object.entries(schema)) {
    const fullPath = path ? `${path}.${key}` : key;

    if (Array.isArray(value)) {
      // value is array of required field names
      if (!config || typeof config[key] !== 'object') {
        errors.push(`Missing section: ${fullPath}`);
        continue;
      }

      for (const field of value) {
        if (config[key][field] === undefined) {
          errors.push(`Missing required field: ${fullPath}.${field}`);
        }
      }
    } else if (typeof value === 'object') {
      // Nested section
      if (!config || !config[key]) {
        errors.push(`Missing section: ${fullPath}`);
      } else {
        errors.push(...validateSection(config[key], value, fullPath));
      }
    }
  }

  return errors;
}

/**
 * Apply default values to config
 */
function applyDefaults(config) {
  // Sync defaults
  config.sync = config.sync || {};
  config.sync.tables = config.sync.tables || [];
  config.sync.chunkSize = config.sync.chunkSize || 5000;
  config.sync.confirm = config.sync.confirm !== false;
  config.sync.yolo = config.sync.yolo === true;

  // Retry defaults
  config.retry = config.retry || {};
  config.retry.maxAttempts = config.retry.maxAttempts || 5;
  config.retry.baseDelayMs = config.retry.baseDelayMs || 500;
  config.retry.maxDelayMs = config.retry.maxDelayMs || 30000;
  config.retry.multiplier = config.retry.multiplier || 2;

  // Logging defaults
  config.logging = config.logging || {};
  config.logging.level = config.logging.level || 'info';
  config.logging.activityLog = config.logging.activityLog || 'logs/activity.log';
  config.logging.errorLog = config.logging.errorLog || 'logs/error.log';

  return config;
}

/**
 * Load and validate config from file
 * @param {string} configPath - Path to config JSON file
 * @returns {object|null} Validated config or null on error
 */
export async function loadConfig(configPath) {
  const absolutePath = resolve(configPath);

  // Check file exists
  if (!existsSync(absolutePath)) {
    logger.error(`Config file not found: ${absolutePath}`);
    logger.info('Copy config/config.json.example to config/config.json and update values');
    return null;
  }

  // Read and parse JSON
  let config;
  try {
    const content = readFileSync(absolutePath, 'utf-8');
    config = JSON.parse(content);
  } catch (err) {
    logger.error(`Failed to parse config file: ${err.message}`);
    return null;
  }

  // Validate against schema
  const errors = validateSection(config, SCHEMA);
  if (errors.length > 0) {
    logger.error('Config validation failed:');
    for (const error of errors) {
      logger.error(`  - ${error}`);
    }
    return null;
  }

  // Check SSH key exists
  if (!existsSync(config.ssh.privateKeyPath)) {
    logger.error(`SSH private key not found: ${config.ssh.privateKeyPath}`);
    return null;
  }

  // Apply defaults
  config = applyDefaults(config);

  logger.debug('Config loaded and validated successfully');
  return config;
}

export default { loadConfig };
