import { expect, test } from 'vitest';

import { setLanguage } from '../i18n';
import { buildBuiltinCodingMcpReport } from './builtinCodingMcpReport';

setLanguage('en');

test('lists every configured server with its state and its tools', () => {
  const report = buildBuiltinCodingMcpReport({
    servers: [
      { name: 'github', enabled: true, connected: true, toolCount: 2 },
      { name: 'slack', enabled: false, connected: false, toolCount: 0 },
      {
        name: 'playwright',
        enabled: true,
        connected: false,
        toolCount: 0,
        error: 'spawn failed\nstderr follows',
      },
      { name: 'empty', enabled: true, connected: true, toolCount: 0 },
    ],
    tools: [
      { server: 'github', name: 'create_issue' },
      { server: 'github', name: 'list_prs' },
    ],
    gatewayAvailable: true,
  });

  const lines = report.split('\n');
  expect(lines[0]).toBe('MCP: 1 of 4 servers usable, 2 tools in total.');
  expect(lines[1]).toBe('- github: connected, 2 tool(s)');
  expect(lines[2]).toBe('- slack: disabled');
  expect(lines[3]).toBe('- playwright: connection failed (spawn failed stderr follows)');
  expect(lines[4]).toBe('- empty: connected, but no tools were discovered');
  expect(lines).toContain('Available tools:');
  expect(lines).toContain('- [github] create_issue');
  expect(lines).not.toContain('MCP tools are not attached to this coding session.');
});

test('summarizes the tools above the listing limit', () => {
  const tools = Array.from({ length: 42 }, (_unused, index) => ({
    server: 'srv',
    name: `tool_${index}`,
  }));
  const report = buildBuiltinCodingMcpReport({
    servers: [{ name: 'srv', enabled: true, connected: true, toolCount: 42 }],
    tools,
    gatewayAvailable: false,
  });

  const lines = report.split('\n');
  expect(lines).toContain('- [srv] tool_39');
  expect(lines).not.toContain('- [srv] tool_40');
  expect(lines).toContain('... 2 more tool(s) not listed.');
  expect(lines).toContain('MCP tools are not attached to this coding session.');
});

test('keeps the report to a single line when nothing is configured', () => {
  const report = buildBuiltinCodingMcpReport({
    servers: [],
    tools: [],
    gatewayAvailable: false,
  });

  expect(report).toBe('MCP: no servers are configured.');
});
test('names the server when the requested one is not configured', () => {
  const report = buildBuiltinCodingMcpReport({
    servers: [],
    tools: [],
    gatewayAvailable: false,
    target: 'github',
  });

  expect(report).toBe('MCP: no server named "github" is configured.');
});
