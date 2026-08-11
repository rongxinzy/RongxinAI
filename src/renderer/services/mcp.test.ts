import { afterEach, expect, test } from 'vitest';

import { normalizeMcpErrorMessage } from './mcp';
import { i18nService } from './i18n';

afterEach(() => {
  i18nService.setLanguage('zh', { persist: false });
});

test('normalizeMcpErrorMessage shortens Streamable HTTP HTML responses', () => {
  const result = normalizeMcpErrorMessage(
    'Streamable HTTP error: Error POSTing to endpoint: <!doctype html><html lang="en"><head><title>Example Domain</title></head><body>Example Domain</body></html>',
  );

  expect(result).toBe('The target URL is not a valid Streamable HTTP MCP endpoint.');
});

test('normalizeMcpErrorMessage shortens generic MCP HTML responses', () => {
  const result = normalizeMcpErrorMessage(
    'Error POSTing to endpoint: <!doctype html><html><body>Example Domain</body></html>',
  );

  expect(result).toBe('The target URL is not a valid MCP endpoint.');
});

test('normalizeMcpErrorMessage preserves the authentication cause', () => {
  i18nService.setLanguage('en', { persist: false });

  const result = normalizeMcpErrorMessage(
    'Streamable HTTP error: Error POSTing to endpoint: {"message":"Invalid Credentials"}',
  );

  expect(result).toBe('MCP authorization has expired. Reconnect and try again.');
});

test('normalizeMcpErrorMessage shortens connection closed errors', () => {
  i18nService.setLanguage('en', { persist: false });
  const result = normalizeMcpErrorMessage('MCP error -32000: Connection closed');

  expect(result).toBe('The MCP server connection closed unexpectedly. Try again.');
});
