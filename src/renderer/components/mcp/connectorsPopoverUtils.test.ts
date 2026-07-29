import { test, expect } from 'vitest';

import { McpServerConfig } from '../../types/mcp';
import { filterConnectors } from './connectorsPopoverUtils';

const servers: McpServerConfig[] = [
  {
    id: 'feishu',
    name: 'Feishu',
    description: 'Docs and chat integration',
    enabled: true,
    transportType: 'http',
    isBuiltIn: true,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Local file access',
    enabled: false,
    transportType: 'stdio',
    isBuiltIn: true,
    createdAt: 2,
    updatedAt: 2,
  },
];

test('filterConnectors returns all items for empty query', () => {
  expect(filterConnectors(servers, '   ')).toHaveLength(2);
});

test('filterConnectors matches name description and transport type', () => {
  expect(filterConnectors(servers, 'feishu').map(server => server.id)).toEqual(['feishu']);
  expect(filterConnectors(servers, 'local file').map(server => server.id)).toEqual(['filesystem']);
  expect(filterConnectors(servers, 'stdio').map(server => server.id)).toEqual(['filesystem']);
});
