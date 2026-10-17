import { expect, test } from 'vitest';

import {
  normalizeAvailableCommands,
  normalizeCapabilities,
  normalizeConfigOptions,
} from './acpDriverProtocol';

test('normalizes capabilities with the driver-local surface on top of defaults', () => {
  expect(normalizeCapabilities({})).toEqual({
    supportsLoadSession: false,
    supportsResumeSession: false,
    supportsPlans: true,
    supportsPermissions: true,
    supportsFilesystem: true,
    supportsTerminal: true,
    supportsConfigOptions: false,
    supportsUsage: true,
    supportsElicitation: false,
    supportsPromptImages: false,
    supportsEmbeddedContext: false,
  });
});

test('normalizes load, resume, and prompt capabilities from the agent advertisement', () => {
  const capabilities = normalizeCapabilities({
    agentCapabilities: {
      loadSession: true,
      sessionCapabilities: { resume: {}, close: {} },
      promptCapabilities: { image: true, embeddedContext: true },
    },
  });
  expect(capabilities.supportsLoadSession).toBe(true);
  expect(capabilities.supportsResumeSession).toBe(true);
  expect(capabilities.supportsPromptImages).toBe(true);
  expect(capabilities.supportsEmbeddedContext).toBe(true);
});

test('normalizes only well-formed session configuration options', () => {
  const options = normalizeConfigOptions([
    {
      id: 'mode',
      name: 'Mode',
      description: 'Run mode',
      category: 'general',
      type: 'select',
      currentValue: 'ask',
      options: [
        { value: 'ask', name: 'Ask' },
        { value: 'code', name: 'Code', description: 'Write code' },
        { value: 1, name: 'Broken' },
      ],
    },
    { id: 'brave', name: 'Brave', type: 'boolean', currentValue: false },
    { id: 'broken-type', name: 'Broken', type: 'string', currentValue: 'ask' },
    { id: 'boolean-string', name: 'Boolean string', type: 'boolean', currentValue: 'yes' },
    { name: 'Missing id', type: 'boolean', currentValue: true },
    {
      id: 'off-list',
      name: 'Off list',
      type: 'select',
      currentValue: 'nope',
      options: [{ value: 'ask', name: 'Ask' }],
    },
    'not-a-record',
  ]);
  expect(options).toEqual([
    {
      id: 'mode',
      name: 'Mode',
      description: 'Run mode',
      category: 'general',
      type: 'select',
      currentValue: 'ask',
      options: [
        { value: 'ask', name: 'Ask' },
        { value: 'code', name: 'Code', description: 'Write code' },
      ],
    },
    { id: 'brave', name: 'Brave', type: 'boolean', currentValue: false },
  ]);
});

test('drops configuration options that are not an array or carry invalid entries', () => {
  expect(normalizeConfigOptions(undefined)).toEqual([]);
  expect(normalizeConfigOptions('nope')).toEqual([]);
  expect(
    normalizeConfigOptions([
      { id: 'mode', name: 'Mode', type: 'select', currentValue: 'ask', options: 'nope' },
    ]),
  ).toEqual([]);
});

test('normalizes only well-formed slash commands and keeps the last duplicate', () => {
  expect(
    normalizeAvailableCommands([
      { name: 'mcp', description: 'List MCP tools.' },
      {
        name: '/review',
        description: 'Review changes.',
        input: { hint: 'instructions' },
        _meta: { source: 'agent' },
      },
      { name: 'bad command', description: 'Ignored.' },
      { name: 'no-description' },
      { name: 'mcp', description: 'Superseded.' },
      42,
    ]),
  ).toEqual([
    { name: 'mcp', description: 'Superseded.' },
    {
      name: 'review',
      description: 'Review changes.',
      input: { hint: 'instructions' },
      _meta: { source: 'agent' },
    },
  ]);
});
