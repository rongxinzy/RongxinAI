/**
 * Enhanced error formatter and cause-chain extractor.
 *
 * Node.js and Electron error objects (such as undici `fetch failed`) often attach
 * crucial network / OS failure details to `error.cause`, `error.code`, `error.syscall`, etc.
 * Normal serialization (like `String(error)`) drops this cause chain.
 *
 * This utility recursively expands the cause chain into human-readable multi-line
 * diagnostic output and structured objects suitable for logging and export.
 */

export interface FormattedErrorDetails {
  name: string;
  message: string;
  stack?: string;
  code?: string | number;
  errno?: string | number;
  syscall?: string;
  address?: string;
  port?: number;
  cause?: FormattedErrorDetails;
  [key: string]: unknown;
}

const KNOWN_ERROR_PROPS = new Set([
  'name',
  'message',
  'stack',
  'cause',
  'code',
  'errno',
  'syscall',
  'address',
  'port',
  'status',
  'statusCode',
]);

/**
 * Recursively inspect an Error and extract a structured diagnostic tree.
 */
export function extractErrorDetails(
  error: unknown,
  depth = 0,
  seen = new Set<unknown>(),
): FormattedErrorDetails | null {
  if (!error || typeof error !== 'object') return null;
  if (seen.has(error) || depth > 5)
    return { name: 'CircularError', message: '[Circular or excessive depth]' };
  seen.add(error);

  const err = error as Record<string, unknown>;
  const name = typeof err.name === 'string' ? err.name : 'Error';
  const message = typeof err.message === 'string' ? err.message : String(error);
  const stack = typeof err.stack === 'string' ? err.stack : undefined;

  const result: FormattedErrorDetails = {
    name,
    message,
    ...(stack ? { stack } : {}),
  };

  if (err.code !== undefined) result.code = err.code as string | number;
  if (err.errno !== undefined) result.errno = err.errno as string | number;
  if (err.syscall !== undefined) result.syscall = String(err.syscall);
  if (err.address !== undefined) result.address = String(err.address);
  if (typeof err.port === 'number') result.port = err.port;
  if (err.status !== undefined) result.status = err.status;
  if (err.statusCode !== undefined) result.statusCode = err.statusCode;

  // Extra non-standard enumerable properties
  for (const [key, value] of Object.entries(err)) {
    if (
      !KNOWN_ERROR_PROPS.has(key) &&
      (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    ) {
      result[key] = value;
    }
  }

  if (err.cause) {
    const causeDetails = extractErrorDetails(err.cause, depth + 1, seen);
    if (causeDetails) {
      result.cause = causeDetails;
    }
  }

  return result;
}

/**
 * Format an error and its entire cause chain into multi-line diagnostic text.
 */
export function formatErrorWithCause(error: unknown): string {
  if (
    !(error instanceof Error) &&
    (typeof error !== 'object' || error === null || !('message' in error))
  ) {
    return String(error);
  }

  const details = extractErrorDetails(error);
  if (!details) return String(error);

  const lines: string[] = [];
  const primaryStack = details.stack || `${details.name}: ${details.message}`;
  lines.push(primaryStack);

  const appendMetadata = (item: FormattedErrorDetails, indent: string) => {
    const metaParts: string[] = [];
    if (item.code !== undefined) metaParts.push(`code: ${item.code}`);
    if (item.syscall !== undefined) metaParts.push(`syscall: ${item.syscall}`);
    if (item.address !== undefined) metaParts.push(`address: ${item.address}`);
    if (item.port !== undefined) metaParts.push(`port: ${item.port}`);
    if (item.status !== undefined) metaParts.push(`status: ${item.status}`);
    if (metaParts.length > 0) {
      lines.push(`${indent}[${metaParts.join(', ')}]`);
    }
  };

  appendMetadata(details, '  ');

  let current = details.cause;
  let indentLevel = 1;
  while (current) {
    const indent = '  '.repeat(indentLevel);
    lines.push(`${indent}Caused by: ${current.name}: ${current.message}`);
    if (current.stack) {
      const stackLines = current.stack.split('\n').slice(1, 5); // first 4 frame lines
      for (const frame of stackLines) {
        lines.push(`${indent}  ${frame.trim()}`);
      }
    }
    appendMetadata(current, `${indent}  `);
    current = current.cause;
    indentLevel++;
  }

  return lines.join('\n');
}

/**
 * Format arguments passed to console.error / console.warn to ensure any Error
 * and its nested causes are expanded.
 */
export function formatLogArguments(args: unknown[]): unknown[] {
  return args.map(arg => {
    if (
      arg instanceof Error ||
      (arg && typeof arg === 'object' && 'name' in arg && 'message' in arg && 'cause' in arg)
    ) {
      return formatErrorWithCause(arg);
    }
    return arg;
  });
}
