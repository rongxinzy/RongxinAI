import { expect, test } from 'vitest';

import { buildPiMcpCapabilityPrompt } from './piMcpCapabilityPrompt';

test('exposes concrete MCP capabilities before planning', () => {
  const prompt = buildPiMcpCapabilityPrompt([
    {
      server: 'Blender MCP',
      name: 'create_cube',
      description: 'Create a cube in the active Blender scene.',
      inputSchema: { type: 'object' },
    },
  ]).join('\n');

  expect(prompt).toContain('MCP capability preflight');
  expect(prompt).toContain('[Blender MCP] create_cube');
  expect(prompt).toContain('Before planning or selecting an execution path');
  expect(prompt).toContain('use the mcp gateway');
});

test('keeps parameter schemas out of the compact capability catalog', () => {
  const prompt = buildPiMcpCapabilityPrompt([
    {
      server: 'CAD',
      name: 'draw_part',
      description: 'Draw a part.',
      inputSchema: { properties: { secretSchemaMarker: { type: 'string' } } },
    },
  ]).join('\n');

  expect(prompt).not.toContain('secretSchemaMarker');
  expect(prompt).toContain('Use describe to inspect the parameter schema');
});

test('surfaces configured MCP failures without recommending a shell bypass', () => {
  const prompt = buildPiMcpCapabilityPrompt(
    [],
    [
      {
        name: 'Blender MCP',
        connected: false,
        toolCount: 0,
        error: 'MCP error -32000: Connection closed',
      },
    ],
  ).join('\n');

  expect(prompt).toContain('[Blender MCP] unavailable: MCP error -32000: Connection closed');
  expect(prompt).toContain('Call the mcp gateway with {} for current status');
  expect(prompt).toContain('do not reverse-engineer or bypass its protocol through shell commands');
});

test('surfaces connected servers that discover no tools', () => {
  const prompt = buildPiMcpCapabilityPrompt(
    [],
    [
      {
        name: 'Empty MCP',
        connected: true,
        toolCount: 0,
      },
    ],
  ).join('\n');

  expect(prompt).toContain('[Empty MCP] connected, but no tools are available');
});
