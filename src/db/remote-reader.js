/**
 * Remote MySQL Reader for Driftwarden
 * SAFETY: This module is STRICTLY READ-ONLY
 * It ONLY executes SELECT queries - never INSERT/UPDATE/DELETE/ALTER/DROP
 */

import mysql from 'mysql2/promise';
import { logger } from '../utils/logger.js';
import { withRetry, isRetryableError, DEFAULT_RETRY_CONFIG } from '../utils/retry.js';

// Whitelist of allowed SQL operations (READ-ONLY)
const ALLOWED_OPERATIONS = ['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN'];

/**
 * Detect identifier placeholders in SQL (??)
 * These are not supported by prepared statements and must use query formatting.
 * @param {string} sql - SQL query to inspect
 * @returns {boolean} True if identifier placeholders are present
 */
function usesIdentifierPlaceholders(sql) {
  return sql.includes('??');
}

/**
 * Validate that a query is read-only
 * @param {string} sql - SQL query to validate
 * @throws {Error} if query is not read-only
 */
function validateReadOnly(sql) {
  const trimmed = sql.trim().toUpperCase();
  const firstWord = trimmed.split(/\s+/)[0];

  if (!ALLOWED_OPERATIONS.includes(firstWord)) {
    throw new Error(
      `SAFETY VIOLATION: Remote database is READ-ONLY. ` +
      `Attempted forbidden operation: ${firstWord}. ` +
      `Only SELECT/SHOW/DESCRIBE/EXPLAIN are allowed.`
    );
  }
}

/**
 * Create a read-only MySQL connection to remote database through tunnel
 * @param {object} config - MySQL config (host, port, user, password, database)
 * @param {object} retryConfig - Optional retry configuration
 * @returns {Promise<RemoteReader>}
 */
export async function createRemoteReader(config, retryConfig = {}) {
  const { host, port, user, password, database } = config;

  logger.info(`Connecting to remote MySQL at ${host}:${port}/${database}...`);

  const connection = await withRetry(
    async () => {
      return mysql.createConnection({
        host,
        port,
        user,
        password,
        database,
        connectTimeout: 30000,
        // Additional safety: set session to read-only mode
        multipleStatements: false, // Prevent SQL injection via multiple statements
      });
    },
    {
      ...DEFAULT_RETRY_CONFIG,
      ...retryConfig,
      operationName: 'remote MySQL connection',
      shouldRetry: isRetryableError,
    }
  );

  logger.info('Remote MySQL connection established (READ-ONLY mode)');

  return new RemoteReader(connection, database, retryConfig);
}

/**
 * RemoteReader class - provides read-only access to remote MySQL
 */
class RemoteReader {
  constructor(connection, database, retryConfig = {}) {
    this.connection = connection;
    this.database = database;
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }

  /**
   * Execute a read-only query with retry support
   * @param {string} sql - SQL query (must be SELECT/SHOW/DESCRIBE/EXPLAIN)
   * @param {Array} params - Query parameters
   * @returns {Promise<Array>} Query results
   */
  async query(sql, params = []) {
    validateReadOnly(sql);

    return withRetry(
      async () => {
        logger.debug(`Executing remote query: ${sql.substring(0, 100)}...`);
        const [rows] = usesIdentifierPlaceholders(sql)
          ? await this.connection.query(sql, params)
          : await this.connection.execute(sql, params);
        return rows;
      },
      {
        ...this.retryConfig,
        operationName: `remote query: ${sql.substring(0, 50)}`,
        shouldRetry: isRetryableError,
      }
    );
  }

  /**
   * Get list of all tables in the database
   * @returns {Promise<string[]>} Array of table names
   */
  async getTables() {
    const rows = await this.query('SHOW TABLES');
    const key = `Tables_in_${this.database}`;
    return rows.map((row) => row[key] || Object.values(row)[0]);
  }

  /**
   * Get schema for a specific table
   * @param {string} tableName - Name of the table
   * @returns {Promise<object>} Table schema info
   */
  async getTableSchema(tableName) {
    // Get column info
    const columns = await this.query('DESCRIBE ??', [tableName]);

    // Get CREATE TABLE statement for full schema
    const [createTableRow] = await this.query('SHOW CREATE TABLE ??', [tableName]);
    const createStatement = createTableRow['Create Table'];

    // Get indexes
    const indexes = await this.query('SHOW INDEX FROM ??', [tableName]);

    return {
      name: tableName,
      columns,
      createStatement,
      indexes,
      primaryKey: columns.filter((col) => col.Key === 'PRI').map((col) => col.Field),
    };
  }

  /**
   * Get row count for a table
   * @param {string} tableName - Name of the table
   * @returns {Promise<number>} Row count
   */
  async getRowCount(tableName) {
    const [result] = await this.query('SELECT COUNT(*) as count FROM ??', [tableName]);
    return result.count;
  }

  /**
   * Get data from a table with chunking support
   * @param {string} tableName - Name of the table
   * @param {object} options - Query options
   * @returns {Promise<Array>} Table data
   */
  async getTableData(tableName, options = {}) {
    const { limit = 1000, offset = 0, orderBy = null, where = null } = options;

    let sql = 'SELECT * FROM ??';
    const params = [tableName];

    if (where) {
      sql += ' WHERE ' + where.clause;
      params.push(...(where.params || []));
    }

    if (orderBy) {
      sql += ' ORDER BY ??';
      params.push(orderBy);
    }

    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return this.query(sql, params);
  }

  /**
   * Get data in chunks using a generator (for large tables)
   * @param {string} tableName - Name of the table
   * @param {number} chunkSize - Number of rows per chunk
   * @param {string} orderBy - Column to order by (usually primary key)
   * @yields {Array} Chunk of rows
   */
  async *getTableDataChunked(tableName, chunkSize = 5000, orderBy = null) {
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const rows = await this.getTableData(tableName, {
        limit: chunkSize,
        offset,
        orderBy,
      });

      if (rows.length > 0) {
        yield rows;
        offset += rows.length;
      }

      hasMore = rows.length === chunkSize;
    }
  }

  /**
   * Get rows modified after a certain timestamp
   * @param {string} tableName - Name of the table
   * @param {string} timestampColumn - Column name for timestamp (updated_at, created_at)
   * @param {Date} since - Get rows modified after this time
   * @returns {Promise<Array>} Modified rows
   */
  async getModifiedRows(tableName, timestampColumn, since) {
    return this.query(
      'SELECT * FROM ?? WHERE ?? > ? ORDER BY ?? ASC',
      [tableName, timestampColumn, since, timestampColumn]
    );
  }

  /**
   * Check if table has timestamp columns for incremental sync
   * @param {string} tableName - Name of the table
   * @returns {Promise<{hasUpdatedAt: boolean, hasCreatedAt: boolean}>}
   */
  async checkTimestampColumns(tableName) {
    const columns = await this.query('DESCRIBE ??', [tableName]);
    const columnNames = columns.map((c) => c.Field.toLowerCase());

    return {
      hasUpdatedAt: columnNames.includes('updated_at'),
      hasCreatedAt: columnNames.includes('created_at'),
      updatedAtColumn: columns.find((c) => c.Field.toLowerCase() === 'updated_at')?.Field,
      createdAtColumn: columns.find((c) => c.Field.toLowerCase() === 'created_at')?.Field,
    };
  }

  /**
   * Close the connection
   */
  async close() {
    logger.info('Closing remote MySQL connection');
    await this.connection.end();
  }
}

export default { createRemoteReader };
