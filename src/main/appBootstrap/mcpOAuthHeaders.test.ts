import { expect, test, vi } from 'vitest';
import type { McpServerRecord } from '../mcpStore';
import { refreshMcpOAuthRecord } from './mcpOAuthHeaders';

const { refreshAccessToken, getServer, updateServer } = vi.hoisted(() => ({
  refreshAccessToken: vi.fn(),
  getServer: vi.fn(),
  updateServer: vi.fn(),
}));

vi.mock('../libs/mcpOAuthManager', () => ({
  McpOAuthManager: class {
    refreshAccessToken = refreshAccessToken;
  },
}));
vi.mock('./runtimeServices', () => ({
  getMcpStore: () => ({ getServer, updateServer }),
  getStore: () => ({}),
}));

test('concurrent Pi connections share the OAuth refresh and preserve an intervening header edit', async () => {
  const record: McpServerRecord = {
    id: 'remote',
    name: 'remote',
    registryId: 'remote',
    enabled: true,
    description: '',
    transportType: 'http',
    url: 'https://example.com/mcp',
    headers: { Authorization: 'Bearer old', 'X-Client': 'desktop' },
    isBuiltIn: true,
    createdAt: 1,
    updatedAt: 1,
  };
  const edited = { ...record, headers: { ...record.headers, 'X-Client': 'edited' } };
  getServer.mockReturnValue(edited);
  updateServer.mockImplementation((_id, data) => {
    getServer.mockReturnValue({ ...edited, ...data });
  });
  const token = Promise.withResolvers<string>();
  refreshAccessToken.mockReturnValue(token.promise);

  const first = refreshMcpOAuthRecord(record);
  const second = refreshMcpOAuthRecord(record);
  token.resolve('refreshed');
  const [firstRecord, secondRecord] = await Promise.all([first, second]);

  expect(refreshAccessToken).toHaveBeenCalledExactlyOnceWith('remote', record.url);
  expect(updateServer).toHaveBeenCalledExactlyOnceWith('remote', {
    headers: { Authorization: 'Bearer refreshed', 'X-Client': 'edited' },
  });
  expect(firstRecord.headers?.Authorization).toBe('Bearer refreshed');
  expect(secondRecord.headers?.Authorization).toBe('Bearer refreshed');
});
