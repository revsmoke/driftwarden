/**
 * Retry/backoff utility tests
 */

import { describe, test, expect } from 'bun:test';
import { calculateBackoff, withRetry, isRetryableError } from '../src/utils/retry.js';

describe('Backoff Calculation', () => {
  test('first attempt uses base delay', () => {
    const delay = calculateBackoff(1, { baseDelayMs: 1000, jitterFactor: 0 });
    expect(delay).toBe(1000);
  });

  test('second attempt doubles delay', () => {
    const delay = calculateBackoff(2, { baseDelayMs: 1000, multiplier: 2, jitterFactor: 0 });
    expect(delay).toBe(2000);
  });

  test('respects max delay cap', () => {
    const delay = calculateBackoff(10, {
      baseDelayMs: 1000,
      multiplier: 2,
      maxDelayMs: 5000,
      jitterFactor: 0,
    });
    expect(delay).toBe(5000);
  });

  test('adds jitter within bounds', () => {
    const delays = [];
    for (let i = 0; i < 10; i++) {
      delays.push(calculateBackoff(1, { baseDelayMs: 1000, jitterFactor: 0.1 }));
    }
    // All delays should be within 10% of base
    delays.forEach((d) => {
      expect(d).toBeGreaterThanOrEqual(900);
      expect(d).toBeLessThanOrEqual(1100);
    });
  });
});

describe('withRetry', () => {
  test('returns result on first success', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        return 'success';
      },
      { maxAttempts: 3 }
    );
    expect(result).toBe('success');
    expect(calls).toBe(1);
  });

  test('retries on failure then succeeds', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error('ECONNREFUSED');
        return 'success';
      },
      { maxAttempts: 5, baseDelayMs: 10 }
    );
    expect(result).toBe('success');
    expect(calls).toBe(3);
  });

  test('throws after max attempts', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('always fails');
        },
        { maxAttempts: 3, baseDelayMs: 10 }
      )
    ).rejects.toThrow('always fails');
    expect(calls).toBe(3);
  });

  test('stops retrying for non-retryable errors', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('syntax error');
        },
        {
          maxAttempts: 5,
          baseDelayMs: 10,
          shouldRetry: (err) => err.message.includes('ECONNREFUSED'),
        }
      )
    ).rejects.toThrow('syntax error');
    expect(calls).toBe(1);
  });
});

describe('isRetryableError', () => {
  test('identifies connection errors', () => {
    expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
    expect(isRetryableError(new Error('ETIMEDOUT'))).toBe(true);
    expect(isRetryableError(new Error('Connection lost'))).toBe(true);
    expect(isRetryableError(new Error('server has gone away'))).toBe(true);
  });

  test('rejects non-connection errors', () => {
    expect(isRetryableError(new Error('Syntax error'))).toBe(false);
    expect(isRetryableError(new Error('Unknown column'))).toBe(false);
    expect(isRetryableError(new Error('Access denied'))).toBe(false);
  });
});
