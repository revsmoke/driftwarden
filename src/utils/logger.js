/**
 * Logger utility for Driftwarden
 * Provides timestamped activity and error logging with file output support
 */

import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

let currentLevel = LOG_LEVELS.INFO;
let activityLogPath = null;
let errorLogPath = null;

function timestamp() {
  return new Date().toISOString();
}

function formatMessage(level, message) {
  return `[${timestamp()}] [${level}] ${message}`;
}

/**
 * Ensure the directory for a file path exists
 * @param {string} filePath - Path to file
 */
function ensureDirectory(filePath) {
  const dir = dirname(filePath);
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Append a line to a log file
 * @param {string} filePath - Path to log file
 * @param {string} line - Line to append
 */
function appendToFile(filePath, line) {
  if (!filePath) return;

  try {
    ensureDirectory(filePath);
    appendFileSync(filePath, line + '\n', 'utf-8');
  } catch (err) {
    // Don't fail on log write errors, just warn to console
    console.error(`[LOGGER] Failed to write to ${filePath}: ${err.message}`);
  }
}

/**
 * Write entry to activity log file
 * @param {object} entry - Log entry object
 */
function writeActivityLog(entry) {
  if (activityLogPath) {
    appendToFile(activityLogPath, JSON.stringify(entry));
  }
}

/**
 * Write entry to error log file
 * @param {string} formattedMessage - Formatted log message
 * @param {Error|null} error - Optional error object
 */
function writeErrorLog(formattedMessage, error = null) {
  if (errorLogPath) {
    let logEntry = formattedMessage;
    if (error?.stack) {
      logEntry += '\n' + error.stack;
    }
    appendToFile(errorLogPath, logEntry);
  }
}

export const logger = {
  /**
   * Set the log level
   * @param {string} level - Log level (DEBUG, INFO, WARN, ERROR)
   */
  setLevel(level) {
    if (LOG_LEVELS[level] !== undefined) {
      currentLevel = LOG_LEVELS[level];
    }
  },

  /**
   * Configure file-based logging
   * @param {object} config - Logging configuration
   */
  configure(config = {}) {
    const { level, activityLog, errorLog } = config;

    if (level && LOG_LEVELS[level] !== undefined) {
      currentLevel = LOG_LEVELS[level];
    }

    if (activityLog) {
      activityLogPath = activityLog;
      ensureDirectory(activityLog);
    }

    if (errorLog) {
      errorLogPath = errorLog;
      ensureDirectory(errorLog);
    }
  },

  /**
   * Get current configuration
   * @returns {object} Current logger configuration
   */
  getConfig() {
    return {
      level: Object.keys(LOG_LEVELS).find((k) => LOG_LEVELS[k] === currentLevel),
      activityLogPath,
      errorLogPath,
    };
  },

  /**
   * Log debug message
   * @param {string} message - Message to log
   */
  debug(message) {
    if (currentLevel <= LOG_LEVELS.DEBUG) {
      const formatted = formatMessage('DEBUG', message);
      console.log(formatted);
    }
  },

  /**
   * Log info message
   * @param {string} message - Message to log
   */
  info(message) {
    if (currentLevel <= LOG_LEVELS.INFO) {
      const formatted = formatMessage('INFO', message);
      console.log(formatted);
    }
  },

  /**
   * Log warning message
   * @param {string} message - Message to log
   */
  warn(message) {
    if (currentLevel <= LOG_LEVELS.WARN) {
      const formatted = formatMessage('WARN', message);
      console.warn(formatted);
      // Warnings also go to error log
      writeErrorLog(formatted);
    }
  },

  /**
   * Log error message
   * @param {string} message - Message to log
   * @param {Error|null} error - Optional error object for stack trace
   */
  error(message, error = null) {
    if (currentLevel <= LOG_LEVELS.ERROR) {
      const formatted = formatMessage('ERROR', message);
      console.error(formatted);
      if (error?.stack) {
        console.error(error.stack);
      }
      // Always write errors to error log file
      writeErrorLog(formatted, error);
    }
  },

  /**
   * Log structured activity entry
   * Used for tracking sync operations, changes applied, etc.
   * @param {string} action - Action name
   * @param {object} details - Additional details
   */
  activity(action, details = {}) {
    const entry = {
      timestamp: timestamp(),
      action,
      ...details,
    };

    // Always output to console
    console.log(JSON.stringify(entry));

    // Write to activity log file if configured
    writeActivityLog(entry);
  },

  /**
   * Log sync start activity
   * @param {object} config - Sync configuration summary
   */
  syncStart(config) {
    this.activity('sync_start', {
      tables: config.tables || [],
      yolo: config.yolo || false,
      dryRun: config.dryRun || false,
    });
  },

  /**
   * Log sync complete activity
   * @param {object} results - Sync results summary
   */
  syncComplete(results) {
    this.activity('sync_complete', {
      success: results.success,
      schemaChanges: results.schema?.applied?.length || 0,
      dataInserts: results.data?.totalInserts || 0,
      dataUpdates: results.data?.totalUpdates || 0,
      dataDeletes: results.data?.totalDeletes || 0,
      errors: results.data?.errors?.length || 0,
    });
  },

  /**
   * Log table change activity
   * @param {string} tableName - Table name
   * @param {object} changes - Changes applied
   */
  tableChange(tableName, changes) {
    this.activity('table_change', {
      table: tableName,
      inserts: changes.inserts || 0,
      updates: changes.updates || 0,
      deletes: changes.deletes || 0,
    });
  },

  /**
   * Log schema change activity
   * @param {string} tableName - Table name
   * @param {string} changeType - Type of change (create, add_column, etc.)
   * @param {string} sql - SQL executed
   */
  schemaChange(tableName, changeType, sql) {
    this.activity('schema_change', {
      table: tableName,
      type: changeType,
      sql: sql.substring(0, 200), // Truncate long SQL
    });
  },

  /**
   * Log connection event
   * @param {string} type - Connection type (ssh, remote_mysql, local_mysql)
   * @param {string} status - Status (connecting, connected, disconnected, error)
   * @param {object} details - Additional details
   */
  connection(type, status, details = {}) {
    this.activity('connection', {
      type,
      status,
      ...details,
    });
  },
};

export default logger;
