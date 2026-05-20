/**
 * Correlation ID infrastructure for request tracing.
 *
 * Uses Node.js AsyncLocalStorage to propagate a short correlation ID
 * through async call chains without passing it explicitly through every
 * function parameter.
 *
 * Usage:
 *   import { generateCorrelationId, runWithCorrelationId, getCurrentCorrelationId } from './logCorrelation';
 *
 *   const cid = generateCorrelationId();
 *   await runWithCorrelationId(cid, async () => {
 *     // All logs inside this scope automatically include the cid
 *     await doWork();
 *   });
 */

import { AsyncLocalStorage } from 'async_hooks';
import { randomBytes } from 'crypto';

const storage = new AsyncLocalStorage<string>();

/**
 * Generate a short 8-character hex correlation ID suitable for log tracing.
 * Uses crypto.randomBytes for uniqueness — collisions are practically
 * impossible at this length for the lifetime of a single process.
 */
export function generateCorrelationId(): string {
  return randomBytes(4).toString('hex');
}

/**
 * Get the correlation ID for the current async context.
 * Returns undefined if called outside a runWithCorrelationId scope.
 */
export function getCurrentCorrelationId(): string | undefined {
  return storage.getStore();
}

/**
 * Execute fn within a correlation ID context.
 * All async operations spawned within fn (including awaited promises)
 * will see this correlation ID via getCurrentCorrelationId().
 */
export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return storage.run(correlationId, fn);
}

/**
 * Format a correlation ID for log output.
 * Returns '[cid:xxxxxxxx]' or empty string if no current context.
 */
export function formatCorrelationId(): string {
  const cid = getCurrentCorrelationId();
  return cid ? `[cid:${cid}]` : '';
}
