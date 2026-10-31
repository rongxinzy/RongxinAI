'use strict';

const TIMESTAMP_UNAVAILABLE = /timestamp service is not available/i;

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_INITIAL_DELAY_MS = 5000;
const DEFAULT_BACKOFF_MS = 5000;

function formatSignError(error) {
  if (error == null) return '';
  if (typeof error !== 'object') return String(error);
  return [error.message, error.stderr, error.stdout].filter(Boolean).join('\n');
}

function isAppleTimestampServiceUnavailableError(error) {
  return TIMESTAMP_UNAVAILABLE.test(formatSignError(error));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retries a macOS signing task when Apple's TSA is temporarily unavailable.
 * Matches electron-builder's default mac sign backoff (5s + 5s per attempt).
 */
async function retryMacSignOnTimestampUnavailable(task, options = {}) {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const sleepFn = options.sleep ?? sleep;
  const log = options.log ?? console.warn;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      const shouldRetry = attempt < maxAttempts && isAppleTimestampServiceUnavailableError(error);
      if (!shouldRetry) {
        throw error;
      }
      const delayMs = initialDelayMs + backoffMs * (attempt - 1);
      log(
        `[macos-sign] Apple timestamp service unavailable (attempt ${attempt}/${maxAttempts}); retrying in ${delayMs}ms`,
      );
      await sleepFn(delayMs);
    }
  }
  throw new Error('macOS sign retry exhausted without returning');
}

function createSignAsyncWithTimestampRetry(signAsync) {
  return options => retryMacSignOnTimestampUnavailable(() => signAsync(options));
}

module.exports = {
  isAppleTimestampServiceUnavailableError,
  retryMacSignOnTimestampUnavailable,
  createSignAsyncWithTimestampRetry,
};
