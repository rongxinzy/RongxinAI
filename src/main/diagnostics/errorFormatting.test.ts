import { describe, expect, test } from 'vitest';
import { extractErrorDetails, formatErrorWithCause, formatLogArguments } from './errorFormatting';

describe('errorFormatting', () => {
  test('extractErrorDetails extracts basic error info', () => {
    const error = new Error('test message');
    error.name = 'CustomError';
    const details = extractErrorDetails(error);

    expect(details).toBeTruthy();
    expect(details?.name).toBe('CustomError');
    expect(details?.message).toBe('test message');
    expect(details?.stack).toContain('CustomError: test message');
  });

  test('extractErrorDetails extracts cause chain and network error codes', () => {
    const rootCause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), {
      code: 'ECONNREFUSED',
      syscall: 'connect',
      address: '127.0.0.1',
      port: 11434,
    });

    const topError = new TypeError('fetch failed', { cause: rootCause });
    const details = extractErrorDetails(topError);

    expect(details?.name).toBe('TypeError');
    expect(details?.message).toBe('fetch failed');
    expect(details?.cause?.message).toBe('connect ECONNREFUSED 127.0.0.1:11434');
    expect(details?.cause?.code).toBe('ECONNREFUSED');
    expect(details?.cause?.syscall).toBe('connect');
    expect(details?.cause?.address).toBe('127.0.0.1');
    expect(details?.cause?.port).toBe(11434);
  });

  test('formatErrorWithCause expands nested cause and properties', () => {
    const rootCause = Object.assign(new Error('connect ETIMEDOUT'), {
      code: 'ETIMEDOUT',
      syscall: 'connect',
    });

    const middleError = new Error('upstream timeout', { cause: rootCause });
    const topError = new Error('request failed', { cause: middleError });

    const formatted = formatErrorWithCause(topError);
    expect(formatted).toContain('request failed');
    expect(formatted).toContain('Caused by: Error: upstream timeout');
    expect(formatted).toContain('Caused by: Error: connect ETIMEDOUT');
    expect(formatted).toContain('code: ETIMEDOUT');
    expect(formatted).toContain('syscall: connect');
  });

  test('formatLogArguments expands error arguments while preserving non-error args', () => {
    const error = new Error('root', { cause: new Error('cause') });
    const formatted = formatLogArguments(['[Module] failed:', error, 123, { ok: true }]);

    expect(formatted[0]).toBe('[Module] failed:');
    expect(typeof formatted[1]).toBe('string');
    expect(formatted[1] as string).toContain('Caused by: Error: cause');
    expect(formatted[2]).toBe(123);
    expect(formatted[3]).toEqual({ ok: true });
  });

  test('handles circular cause gracefully without stack overflow', () => {
    const errorA = new Error('error A');
    const errorB = new Error('error B');
    Object.assign(errorA, { cause: errorB });
    Object.assign(errorB, { cause: errorA });

    const formatted = formatErrorWithCause(errorA);
    expect(formatted).toContain('error A');
    expect(formatted).toContain('error B');
    expect(formatted).toContain('CircularError');
  });
});
