/**
 * Guards for the main process stdio streams.
 *
 * In development the terminal (or any other parent process) can disappear while
 * the app keeps running. Its stdout/stderr pipes then break and every later
 * write fails asynchronously with EPIPE. Without an 'error' listener that
 * failure surfaces as an uncaught exception, and the uncaught handler reports it
 * through console.error - the very same broken pipe - so the process spins at
 * full CPU and never exits, holding the single-instance lock forever.
 */

import type { Writable } from 'node:stream';

/** Broken-pipe style failures that are expected once the parent terminal is gone. */
const IGNORED_STREAM_ERROR_CODES = new Set([
  'EPIPE',
  'ERR_STREAM_DESTROYED',
  'ERR_IPC_CHANNEL_CLOSED',
]);

/**
 * Swallow broken-pipe failures on the given streams and forward every other
 * stream error to `onUnexpectedError`. A throwing reporter never escapes the
 * stream error handler.
 */
export function installStdioErrorGuards(
  streams: ReadonlyArray<Writable | undefined>,
  onUnexpectedError: (error: unknown) => void,
): void {
  for (const stream of streams) {
    if (!stream || typeof stream.on !== 'function') continue;
    stream.on('error', error => {
      const code = (error as NodeJS.ErrnoException | null | undefined)?.code;
      if (code && IGNORED_STREAM_ERROR_CODES.has(code)) return;
      try {
        onUnexpectedError(error);
      } catch {
        // Reporting must never throw out of a stream error handler.
      }
    });
  }
}

/**
 * Wrap a fatal error reporter so a failure raised while reporting is skipped
 * instead of re-entering the reporter.
 */
export function createUncaughtReporter(
  report: (error: unknown) => void,
): (error: unknown) => void {
  let reporting = false;
  return error => {
    if (reporting) return;
    reporting = true;
    try {
      report(error);
    } catch {
      // Ignore; the reporter already failed to report its own failure.
    } finally {
      reporting = false;
    }
  };
}
