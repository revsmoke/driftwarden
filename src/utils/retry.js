/**
 * Retry + Progressive Backoff Utility for Driftwarden
 * Handles connection failures with exponential backoff
 */

import { logger } from './logger.js';

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  multiplier: 2,
  jitterFactor: 0.1, // 10% jitter
};

/**
 * Calculate delay with exponential backoff and jitter
 * @param {number} attempt - Current attempt number (1-indexed)
 * @param {object} config - Retry configuration
 * @returns {number} Delay in milliseconds
 */
export function calculateBackoff(attempt, config = {}) {
  const { baseDelayMs, maxDelayMs, multiplier, jitterFactor } = {
    ...DEFAULT_RETRY_CONFIG,
    ...config,
  };

  // Exponential backoff: baseDelay * multiplier^(attempt-1)
  const exponentialDelay = baseDelayMs * Math.pow(multiplier, attempt - 1);

  // Cap at maxDelay
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

  // Add jitter (random variation to prevent thundering herd)
  const jitter = cappedDelay * jitterFactor * (Math.random() * 2 - 1);

  return Math.max(0, Math.round(cappedDelay + jitter));
}

/**
 * Sleep for a specified duration
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry and exponential backoff
 * @param {Function} fn - Async function to execute
 * @param {object} options - Retry options
 * @returns {Promise<any>} Result of the function
 * @throws {Error} If all retries fail
 */
export async function withRetry(fn, options = {}) {
  const {
    maxAttempts = DEFAULT_RETRY_CONFIG.maxAttempts,
    baseDelayMs = DEFAULT_RETRY_CONFIG.baseDelayMs,
    maxDelayMs = DEFAULT_RETRY_CONFIG.maxDelayMs,
    multiplier = DEFAULT_RETRY_CONFIG.multiplier,
    jitterFactor = DEFAULT_RETRY_CONFIG.jitterFactor,
    onRetry = null, // Callback: (attempt, error, delay) => void
    shouldRetry = null, // Callback: (error) => boolean
    operationName = 'operation',
  } = options;

  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry this error
      if (shouldRetry && !shouldRetry(error)) {
        logger.error(`${operationName} failed with non-retryable error: ${error.message}`);
        throw error;
      }

      // Check if we've exhausted retries
      if (attempt >= maxAttempts) {
        logger.error(
          `${operationName} failed after ${maxAttempts} attempts: ${error.message}`
        );
        throw error;
      }

      // Calculate delay
      const delay = calculateBackoff(attempt, {
        baseDelayMs,
        maxDelayMs,
        multiplier,
        jitterFactor,
      });

      logger.warn(
        `${operationName} attempt ${attempt}/${maxAttempts} failed: ${error.message}. ` +
        `Retrying in ${delay}ms...`
      );

      // Call onRetry callback if provided
      if (onRetry) {
        try {
          await onRetry(attempt, error, delay);
        } catch (callbackError) {
          logger.warn(`onRetry callback failed: ${callbackError.message}`);
        }
      }

      // Wait before next attempt
      await sleep(delay);
    }
  }

  // Should not reach here, but just in case
  throw lastError || new Error(`${operationName} failed after ${maxAttempts} attempts`);
}

/**
 * Determine if an error is a connection error that should be retried
 * @param {Error} error - The error to check
 * @returns {boolean} True if the error is retryable
 */
export function isRetryableError(error) {
  const retryableMessages = [
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'ENETUNREACH',
    'EHOSTUNREACH',
    'EPIPE',
    'Connection lost',
    'Connection closed',
    'connection reset',
    'Too many connections',
    'Lock wait timeout',
    'Deadlock found',
    'server has gone away',
    'Lost connection',
    'Can\'t connect',
    'Connection refused',
    'Handshake inactivity timeout',
    'Timed out while waiting',
  ];

  const errorMessage = error.message || '';
  const errorCode = error.code || '';

  return retryableMessages.some(
    (msg) =>
      errorMessage.toLowerCase().includes(msg.toLowerCase()) ||
      errorCode === msg
  );
}

/**
 * Create a retry wrapper with predefined configuration
 * @param {object} config - Retry configuration
 * @returns {Function} Retry function
 */
export function createRetryWrapper(config = {}) {
  return (fn, operationName = 'operation') => {
    return withRetry(fn, {
      ...config,
      operationName,
      shouldRetry: isRetryableError,
    });
  };
}

/**
 * Execute multiple operations with circuit breaker pattern
 * If too many failures occur, stop attempting new operations
 * @param {Array<Function>} operations - Array of async functions
 * @param {object} options - Execution options
 * @returns {Promise<object>} Results with successes and failures
 */
export async function executeWithCircuitBreaker(operations, options = {}) {
  const {
    maxFailures = 3,
    resetAfterMs = 60000,
    failureThreshold = 0.5, // 50% failure rate triggers breaker
    retryConfig = {},
  } = options;

  const results = {
    successes: [],
    failures: [],
    circuitBroken: false,
  };

  let consecutiveFailures = 0;
  let lastFailureTime = 0;

  for (let i = 0; i < operations.length; i++) {
    const operation = operations[i];

    // Check if circuit breaker should reset
    if (consecutiveFailures >= maxFailures) {
      const timeSinceFailure = Date.now() - lastFailureTime;
      if (timeSinceFailure < resetAfterMs) {
        results.circuitBroken = true;
        logger.warn(
          `Circuit breaker open. Skipping remaining ${operations.length - i} operations.`
        );
        break;
      }
      // Reset circuit breaker
      consecutiveFailures = 0;
      logger.info('Circuit breaker reset. Resuming operations.');
    }

    try {
      const result = await withRetry(operation, {
        ...retryConfig,
        shouldRetry: isRetryableError,
      });
      results.successes.push({ index: i, result });
      consecutiveFailures = 0;
    } catch (error) {
      results.failures.push({ index: i, error: error.message });
      consecutiveFailures++;
      lastFailureTime = Date.now();

      // Check failure rate threshold
      const failureRate = results.failures.length / (i + 1);
      if (failureRate >= failureThreshold && i >= maxFailures) {
        results.circuitBroken = true;
        logger.warn(
          `Failure rate (${(failureRate * 100).toFixed(1)}%) exceeded threshold. ` +
          `Stopping operations.`
        );
        break;
      }
    }
  }

  return results;
}

export default {
  calculateBackoff,
  sleep,
  withRetry,
  isRetryableError,
  createRetryWrapper,
  executeWithCircuitBreaker,
  DEFAULT_RETRY_CONFIG,
};
