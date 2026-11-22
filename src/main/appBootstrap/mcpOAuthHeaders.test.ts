import { expect, test, vi } from 'vitest';
import type { McpServerRecord } from '../mcpStore';
import { refreshMcpOAuthRecord } from './mcpOAuthHeaders';

const { refreshAccessToken, getRegistryOwner, updateServer } = vi.hoisted(() => ({
  refreshAccessToken: vi.fn(),
  getRegistryOwner: vi.fn(),
  updateServer: vi.fn(),
}));

vi.mock('../libs/mcpOAuthManager', () => ({
  McpOAuthManager: class {
    refreshAccessToken = refreshAccessToken;
  },
}));
vi.mock('./runtimeServices', () => ({
  getMcpStore: () => ({ getRegistryOwner, updateServer }),
  getStore: () => ({}),
}));

const record: McpServerRecord = {
  id: 'fixture-server-id',
  name: 'Fixture',
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

test('concurrent Pi connections share the OAuth refresh and preserve an intervening header edit', async () => {
  const edited = { ...record, headers: { ...record.headers, 'X-Client': 'edited' } };
  getRegistryOwner.mockReturnValue(edited);
  updateServer.mockImplementation((_id, data) => {
    getRegistryOwner.mockReturnValue({ ...edited, ...data });
  });
  const token = Promise.withResolvers<string>();
  refreshAccessToken.mockReturnValue(token.promise);

  const first = refreshMcpOAuthRecord(record);
  const second = refreshMcpOAuthRecord(record);
  token.resolve('refreshed');
  const [firstRecord, secondRecord] = await Promise.all([first, second]);

  expect(refreshAccessToken).toHaveBeenCalledExactlyOnceWith(
    'remote',
    record.url,
    expect.any(AbortSignal),
  );
  expect(updateServer).toHaveBeenCalledExactlyOnceWith(record.id, {
    headers: { Authorization: 'Bearer refreshed', 'X-Client': 'edited' },
  });
  expect(firstRecord.headers?.Authorization).toBe('Bearer refreshed');
  expect(firstRecord.headers?.['X-Client']).toBe('edited');
  expect(secondRecord.headers?.Authorization).toBe('Bearer refreshed');
});

test('legacy siblings retain their own configured headers without using the official grant', async () => {
  const sibling = { ...record, id: 'older-duplicate-id' };
  refreshAccessToken.mockClear();
  getRegistryOwner.mockReturnValue(record);

  await expect(refreshMcpOAuthRecord(sibling)).resolves.toBe(sibling);
  expect(refreshAccessToken).not.toHaveBeenCalled();
});

test('background failure logs only the local server ID and preserves the stored header', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  refreshAccessToken.mockRejectedValueOnce(
    new Error('https://example.test/oauth?credential=fixture'),
  );
  const source = { ...record, registryId: 'raw-fixture-registry-id' };
  try {
    await expect(refreshMcpOAuthRecord(source)).resolves.toBe(source);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      '[McpAuth] failed to refresh OAuth token for MCP server fixture-server-id.',
    );
  } finally {
    warn.mockRestore();
  }
});
