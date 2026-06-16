import { expect, test } from 'vitest';

import { isValidMcpCommandFormat, isValidMcpUrlFormat, validateMcpTransportFields } from './mcpValidation';

test('isValidMcpCommandFormat accepts common executable commands', () => {
  expect(isValidMcpCommandFormat('npx')).toBe(true);
  expect(isValidMcpCommandFormat('node')).toBe(true);
  expect(isValidMcpCommandFormat('./mock-mcp')).toBe(true);
});

test('isValidMcpCommandFormat rejects numeric and URL-like values', () => {
  expect(isValidMcpCommandFormat('1234')).toBe(false);
  expect(isValidMcpCommandFormat('https://example.com')).toBe(false);
});

test('isValidMcpUrlFormat rejects malformed hostnames', () => {
  expect(isValidMcpUrlFormat('http://example..com')).toBe(false);
  expect(isValidMcpUrlFormat('ftp://example.com')).toBe(false);
});

test('isValidMcpUrlFormat accepts localhost and IPv4 MCP endpoints', () => {
  expect(isValidMcpUrlFormat('http://localhost:3000/mcp')).toBe(true);
  expect(isValidMcpUrlFormat('https://127.0.0.1:8443/sse')).toBe(true);
});

test('validateMcpTransportFields returns translated error keys', () => {
  expect(validateMcpTransportFields('stdio', { command: '1234' })).toBe('mcpCommandInvalid');
  expect(validateMcpTransportFields('http', { url: 'http://example..com' })).toBe('mcpUrlInvalid');
});
