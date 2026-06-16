import { expect, test } from 'vitest';

import { validateMcpServerConfig, validateMcpTransportFormat } from './mcpCommandValidation';

test('validateMcpServerConfig rejects a missing stdio command', async () => {
  const result = await validateMcpServerConfig({
    transportType: 'stdio',
    command: '',
  });

  expect(result).toBe('stdio transport requires a command.');
});

test('validateMcpServerConfig accepts a syntactically valid stdio command', async () => {
  const result = await validateMcpServerConfig({
    transportType: 'stdio',
    command: 'npx',
  });

  expect(result).toBeNull();
});

test('validateMcpServerConfig skips non-stdio transports', async () => {
  const result = await validateMcpServerConfig({
    transportType: 'http',
    command: '__definitely_missing_mcp_command__',
    url: 'http://localhost:3000/mcp',
  });

  expect(result).toBeNull();
});

test('validateMcpTransportFormat rejects numeric stdio commands', () => {
  const result = validateMcpTransportFormat({
    transportType: 'stdio',
    command: '1234',
  });

  expect(result).toBe('Invalid command format. Please enter a valid executable name or path.');
});

test('validateMcpTransportFormat rejects URL-like stdio commands', () => {
  const result = validateMcpTransportFormat({
    transportType: 'stdio',
    command: 'https://open.dingtalk.com/document/dingstart/configure-the-robot-application',
  });

  expect(result).toBe('Invalid command format. Please enter a valid executable name or path.');
});

test('validateMcpTransportFormat rejects malformed HTTP URLs', () => {
  const result = validateMcpTransportFormat({
    transportType: 'http',
    url: 'http://example..com',
  });

  expect(result).toBe('Invalid URL format. Please enter a valid http/https address.');
});

test('validateMcpTransportFormat accepts localhost MCP URLs', () => {
  const result = validateMcpTransportFormat({
    transportType: 'sse',
    url: 'http://localhost:3000/sse',
  });

  expect(result).toBeNull();
});
