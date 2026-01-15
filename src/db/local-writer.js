/**
 * Local MySQL Writer for Driftwarden
 * Handles read/write operations to the local database
 * All write operations require confirmation unless YOLO mode is enabled
 */

import mysql from 'mysql2/promise';
import { logger } from '../utils/logger.js';
import { withRetry, isRetryableError, DEFAULT_RETRY_CONFIG } from '../utils/retry.js';

/**
 * Create a MySQL connection to the local database
 * @param {object} config - MySQL config (host, port, user, password, database)
 * @param {object} retryConfig - Optional retry configuration
 * @returns {Promise<LocalWriter>}
 */
export async function createLocalWriter(config, retryConfig = {}) {
  const { host, port, user, password, database } = config;

  logger.info(`Connecting to local MySQL at ${host}:${port}/${database}...`);

  const connection = await withRetry(
    async () => {
      return mysql.createConnection({
        host,
        port,
        user,
        password,
        database,
        connectTimeout: 30000,
        multipleStatements: false,
      });
    },
    {
      ...DEFAULT_RETRY_CONFIG,
      ...retryConfig,
      operationName: 'local MySQL connection',
      shouldRetry: isRetryableError,
    }
  );

  logger.info('Local MySQL connection established');

  return new LocalWriter(connection, database, retryConfig);
}

/**
 * LocalWriter class - provides read/write access to local MySQL
 */
class LocalWriter {
  constructor(connection, database, retryConfig = {}) {
    this.connection = connection;
    this.database = database;
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }

  /**
   * Execute a read query with retry support
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<Array>} Query results
   */
  async query(sql, params = []) {
    return withRetry(
      async () => {
        logger.debug(`Executing local query: ${sql.substring(0, 100)}...`);
        const [rows] = await this.connection.execute(sql, params);
        return rows;
      },
      {
        ...this.retryConfig,
        operationName: `local query: ${sql.substring(0, 50)}`,
        shouldRetry: isRetryableError,
      }
    );
  }

  /**
   * Execute a write query (INSERT/UPDATE/DELETE) with retry support
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<object>} Result with affectedRows, insertId, etc.
   */
  async execute(sql, params = []) {
    return withRetry(
      async () => {
        logger.debug(`Executing local write: ${sql.substring(0, 100)}...`);
        const [result] = await this.connection.execute(sql, params);
        return result;
      },
      {
        ...this.retryConfig,
        operationName: `local write: ${sql.substring(0, 50)}`,
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
    const columns = await this.query('DESCRIBE ??', [tableName]);
    const [createTableRow] = await this.query('SHOW CREATE TABLE ??', [tableName]);
    const createStatement = createTableRow['Create Table'];
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
   * Check if a table exists
   * @param {string} tableName - Name of the table
   * @returns {Promise<boolean>}
   */
  async tableExists(tableName) {
    const tables = await this.getTables();
    return tables.includes(tableName);
  }

  /**
   * Get data from a table
   * @param {string} tableName - Name of the table
   * @param {object} options - Query options
   * @returns {Promise<Array>} Table data
   */
  async getTableData(tableName, options = {}) {
    const { limit = 1000, offset = 0, orderBy = null } = options;

    let sql = 'SELECT * FROM ??';
    const params = [tableName];

    if (orderBy) {
      sql += ' ORDER BY ??';
      params.push(orderBy);
    }

    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return this.query(sql, params);
  }

  /**
   * Insert a single row
   * @param {string} tableName - Name of the table
   * @param {object} row - Row data as key-value pairs
   * @returns {Promise<object>} Insert result
   */
  async insertRow(tableName, row) {
    const columns = Object.keys(row);
    const values = Object.values(row);
    const placeholders = columns.map(() => '?').join(', ');

    const sql = `INSERT INTO ?? (${columns.map(() => '??').join(', ')}) VALUES (${placeholders})`;
    const params = [tableName, ...columns, ...values];

    return this.execute(sql, params);
  }

  /**
   * Insert multiple rows in a batch
   * @param {string} tableName - Name of the table
   * @param {Array<object>} rows - Array of row objects
   * @returns {Promise<object>} Insert result
   */
  async insertRows(tableName, rows) {
    if (rows.length === 0) return { affectedRows: 0 };

    const columns = Object.keys(rows[0]);
    const placeholders = `(${columns.map(() => '?').join(', ')})`;
    const allPlaceholders = rows.map(() => placeholders).join(', ');

    const sql = `INSERT INTO ?? (${columns.map(() => '??').join(', ')}) VALUES ${allPlaceholders}`;
    const params = [tableName, ...columns];

    for (const row of rows) {
      params.push(...columns.map((col) => row[col]));
    }

    return this.execute(sql, params);
  }

  /**
   * Update a row by primary key
   * @param {string} tableName - Name of the table
   * @param {object} row - Full row data including primary key
   * @param {string[]} primaryKey - Array of primary key column names
   * @returns {Promise<object>} Update result
   */
  async updateRow(tableName, row, primaryKey) {
    const setColumns = Object.keys(row).filter((col) => !primaryKey.includes(col));
    if (setColumns.length === 0) return { affectedRows: 0 };

    const setClause = setColumns.map(() => '?? = ?').join(', ');
    const whereClause = primaryKey.map(() => '?? = ?').join(' AND ');

    const sql = `UPDATE ?? SET ${setClause} WHERE ${whereClause}`;
    const params = [tableName];

    // SET params
    for (const col of setColumns) {
      params.push(col, row[col]);
    }

    // WHERE params
    for (const col of primaryKey) {
      params.push(col, row[col]);
    }

    return this.execute(sql, params);
  }

  /**
   * Delete a row by primary key
   * @param {string} tableName - Name of the table
   * @param {object} keyValues - Primary key column-value pairs
   * @returns {Promise<object>} Delete result
   */
  async deleteRow(tableName, keyValues) {
    const columns = Object.keys(keyValues);
    const whereClause = columns.map(() => '?? = ?').join(' AND ');

    const sql = `DELETE FROM ?? WHERE ${whereClause}`;
    const params = [tableName];

    for (const col of columns) {
      params.push(col, keyValues[col]);
    }

    return this.execute(sql, params);
  }

  /**
   * Execute a schema change (CREATE TABLE, ALTER TABLE)
   * @param {string} sql - DDL statement
   * @returns {Promise<object>} Result
   */
  async executeSchema(sql) {
    logger.info(`Executing schema change: ${sql.substring(0, 100)}...`);
    const [result] = await this.connection.query(sql);
    return result;
  }

  /**
   * Begin a transaction
   */
  async beginTransaction() {
    await this.connection.beginTransaction();
    logger.debug('Transaction started');
  }

  /**
   * Commit a transaction
   */
  async commit() {
    await this.connection.commit();
    logger.debug('Transaction committed');
  }

  /**
   * Rollback a transaction
   */
  async rollback() {
    await this.connection.rollback();
    logger.debug('Transaction rolled back');
  }

  /**
   * Get the maximum timestamp value from a column
   * @param {string} tableName - Name of the table
   * @param {string} column - Timestamp column name
   * @returns {Promise<Date|null>} Max timestamp or null if no data
   */
  async getMaxTimestamp(tableName, column) {
    const [result] = await this.query('SELECT MAX(??) as maxTs FROM ??', [column, tableName]);
    return result?.maxTs || null;
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
    logger.info('Closing local MySQL connection');
    await this.connection.end();
  }
}

export default { createLocalWriter };
