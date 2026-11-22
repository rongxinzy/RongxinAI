import Database from 'better-sqlite3';
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { expect, test, vi, type MockInstance } from 'vitest';

import { mcpContract } from '../../../shared/ipc/mcpContract';
import { applyCoreSchema } from '../../coreSchema';
import { t } from '../../i18n';
import { McpOAuthManager, MCP_OAUTH_STORE_PREFIX } from '../../libs/mcpOAuthManager';
import { McpStore } from '../../mcpStore';
import type { SqliteStore } from '../../sqliteStore';
import * as artifactWorkers from '../../workbenchTask/artifactWorkerPool';
import { registerMcpIpc } from './index';

vi.mock('electron', async importOriginal => {
  const electron = await importOriginal<typeof import('electron')>();
  return { ...electron, app: { ...electron.app, getAppPath: () => process.cwd() } };
});

vi.mock('../../appBootstrap/mcpBootstrap', () => ({
  ensureBuiltInMcpDefaultsDisabled: vi.fn(),
  refreshMcpBridge: vi.fn(async () => ({ tools: 0 })),
}));

const event = {} as IpcMainInvokeEvent;
const getHandler = (registration: MockInstance<typeof ipcMain.handle>, channel: string) =>
  registration.mock.calls.find(([registered]) => registered === channel)![1];

const authorization = (authorizationRequestId?: string) => ({
  authorizationRequestId,
  name: 'Fixture',
  description: '',
  registryId: 'fixture',
  transportType: 'http' as const,
  url: 'https://example.test/mcp',
});

const emptyStore = () => ({
  getRegistryOwner: () => null,
  listServers: () => [],
  createServer: vi.fn(),
  updateServer: vi.fn(),
});

test('marketplace and icon IPC share one load and a failed load can be retried', async () => {
  const registration = vi.spyOn(ipcMain, 'handle');
  const loaded =
    Promise.withResolvers<Awaited<ReturnType<typeof artifactWorkers.readMcpMarketplaceAsync>>>();
  const iconPath = 'server/icon.png';
  const read = vi
    .spyOn(artifactWorkers, 'readMcpMarketplaceAsync')
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockReturnValueOnce(loaded.promise);
  const shutdown = registerMcpIpc({
    onConfigurationChanged: vi.fn(),
    getMcpStore: vi.fn(),
    getStore: vi.fn(),
  });
  try {
    const catalog = getHandler(registration, mcpContract.fetchMarketplace.channel);
    const icon = getHandler(registration, mcpContract.loadIcon.channel);
    await expect(catalog(event)).resolves.toEqual({ success: false, error: 'unavailable' });
    const requested = [catalog(event), icon(event, iconPath), icon(event, 'unregistered')];
    expect(read).toHaveBeenCalledTimes(2);
    loaded.resolve({
      catalog: { categories: [], servers: [] },
      icons: new Map([[iconPath, { data: 'data:image/png;base64,Zg==' }]]),
    });
    await expect(Promise.all(requested)).resolves.toEqual([
      { success: true, data: { categories: [], servers: [] } },
      { success: true, data: 'data:image/png;base64,Zg==' },
      { success: false, error: 'MCP icon is not registered' },
    ]);
    await expect(icon(event, iconPath)).resolves.toMatchObject({ success: true });
    expect(read).toHaveBeenCalledTimes(2);
  } finally {
    await shutdown();
    read.mockRestore();
    registration.mockRestore();
  }
});

test('MCP authorization handlers share cancellation until each request settles', async () => {
  const registration = vi.spyOn(ipcMain, 'handle');
  const began = Promise.withResolvers<void>();
  const authorize = vi
    .spyOn(McpOAuthManager.prototype, 'authorize')
    .mockImplementationOnce((_id, _url, signal) => {
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
        began.resolve();
      });
    })
    .mockResolvedValueOnce('');
  try {
    registerMcpIpc({
      onConfigurationChanged: vi.fn(),
      getMcpStore: () => emptyStore() as unknown as McpStore,
      getStore: vi.fn(),
    });
    const requestHandler = getHandler(registration, mcpContract.authorize.channel);
    const cancelHandler = getHandler(registration, mcpContract.cancelAuthorize.channel);
    const request = (authorizationRequestId: string) =>
      requestHandler(event, authorization(authorizationRequestId));

    const pending = request('pending');
    await began.promise;
    await expect(cancelHandler(event, 'pending')).resolves.toEqual({ success: true });
    await expect(pending).resolves.toEqual({ success: false, error: 'cancelled' });

    await expect(request('settled')).resolves.toMatchObject({ success: false });
    await cancelHandler(event, 'settled');
    expect(authorize.mock.calls[1][2]?.aborted).toBe(false);
  } finally {
    authorize.mockRestore();
    registration.mockRestore();
  }
});

test('quit drains named and unnamed authorizations and rejects replacement or future requests', async () => {
  const registration = vi.spyOn(ipcMain, 'handle');
  const named = Promise.withResolvers<string>();
  const unnamed = Promise.withResolvers<string>();
  const namedStarted = Promise.withResolvers<AbortSignal | undefined>();
  const unnamedStarted = Promise.withResolvers<AbortSignal | undefined>();
  const authorize = vi
    .spyOn(McpOAuthManager.prototype, 'authorize')
    .mockImplementationOnce((_id, _url, signal) => {
      namedStarted.resolve(signal);
      return named.promise;
    })
    .mockImplementationOnce((_id, _url, signal) => {
      unnamedStarted.resolve(signal);
      return unnamed.promise;
    });
  const store = emptyStore();
  const getMcpStore = vi.fn(() => store as unknown as McpStore);
  const getStore = vi.fn();
  try {
    const shutdown = registerMcpIpc({ onConfigurationChanged: vi.fn(), getMcpStore, getStore });
    const request = getHandler(registration, mcpContract.authorize.channel);
    const cancel = getHandler(registration, mcpContract.cancelAuthorize.channel);
    const existing = request(event, authorization('repeat'));
    const namedSignal = await namedStarted.promise;
    await cancel(event, 'repeat');
    expect(namedSignal?.aborted).toBe(true);

    await expect(request(event, authorization('repeat'))).resolves.toMatchObject({
      success: false,
      error: t('mcpIntegrationOperationBusy'),
    });
    const anonymous = request(event, { ...authorization(), registryId: 'other-fixture' });
    const unnamedSignal = await unnamedStarted.promise;
    const drained = vi.fn();
    const quitting = shutdown().then(drained);
    expect(unnamedSignal?.aborted).toBe(true);

    await expect(request(event, authorization('new'))).resolves.toMatchObject({
      success: false,
      error: t('mcpAuthorizationShuttingDown'),
    });
    expect(drained).not.toHaveBeenCalled();
    unnamed.resolve('too-late');
    await expect(anonymous).resolves.toMatchObject({ success: false });
    expect(drained).not.toHaveBeenCalled();
    named.resolve('too-late');
    await expect(existing).resolves.toMatchObject({ success: false });
    await quitting;
    expect(drained).toHaveBeenCalledOnce();
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(getStore).toHaveBeenCalledTimes(2);
    expect(store.createServer).not.toHaveBeenCalled();
    expect(store.updateServer).not.toHaveBeenCalled();
  } finally {
    named.resolve('');
    unnamed.resolve('');
    authorize.mockRestore();
    registration.mockRestore();
  }
});

test('different request IDs cannot authorize the same registry concurrently', async () => {
  const registration = vi.spyOn(ipcMain, 'handle');
  const started = Promise.withResolvers<void>();
  const pending = Promise.withResolvers<string>();
  const authorize = vi
    .spyOn(McpOAuthManager.prototype, 'authorize')
    .mockImplementationOnce(() => {
      started.resolve();
      return pending.promise;
    })
    .mockResolvedValue('');
  try {
    registerMcpIpc({
      onConfigurationChanged: vi.fn(),
      getMcpStore: () => emptyStore() as unknown as McpStore,
      getStore: vi.fn(),
    });
    const request = getHandler(registration, mcpContract.authorize.channel);
    const first = request(event, authorization('first'));
    await started.promise;
    await expect(request(event, authorization('second'))).resolves.toEqual({
      success: false,
      error: t('mcpIntegrationOperationBusy'),
    });
    pending.resolve('');
    await first;
    expect(authorize).toHaveBeenCalledOnce();
  } finally {
    pending.resolve('');
    authorize.mockRestore();
    registration.mockRestore();
  }
});

test('reauthorization updates only the existing registry row credentials', async () => {
  const db = new Database(':memory:');
  const registration = vi.spyOn(ipcMain, 'handle');
  const started = Promise.withResolvers<void>();
  const token = Promise.withResolvers<string>();
  const authorize = vi.spyOn(McpOAuthManager.prototype, 'authorize').mockImplementation(() => {
    started.resolve();
    return token.promise;
  });
  try {
    applyCoreSchema(db, '/unused-mcp-ipc-fixture');
    const store = new McpStore(db);
    const existing = store.createServer({
      ...authorization(),
      name: 'Renamed integration',
      description: 'My configuration',
      isBuiltIn: true,
      timeout: 91,
      exposure: 'deferred',
      headers: { authorization: 'Bearer fixture-old', 'X-Custom': 'keep' },
    });
    store.setEnabled(existing.id, true);
    registerMcpIpc({
      onConfigurationChanged: vi.fn(),
      getMcpStore: () => store,
      getStore: vi.fn(),
    });
    const request = getHandler(registration, mcpContract.authorize.channel);

    const pending = request(event, authorization());
    await started.promise;
    store.updateServer(existing.id, {
      headers: { authorization: 'Bearer fixture-intervening', 'X-Custom': 'latest' },
    });
    token.resolve('fixture-renewed');

    await expect(pending).resolves.toMatchObject({ success: true });
    expect(store.listServers()).toHaveLength(1);
    expect(store.getServer(existing.id)).toMatchObject({
      id: existing.id,
      name: existing.name,
      description: existing.description,
      url: existing.url,
      enabled: true,
      isBuiltIn: true,
      timeout: 91,
      exposure: 'deferred',
    });
    expect(store.getServer(existing.id)?.headers).toEqual({
      Authorization: 'Bearer fixture-renewed',
      'X-Custom': 'latest',
    });
  } finally {
    token.resolve('');
    db.close();
    authorize.mockRestore();
    registration.mockRestore();
  }
});

test('reauthorization refuses to project a token onto a changed registry endpoint', async () => {
  const db = new Database(':memory:');
  const registration = vi.spyOn(ipcMain, 'handle');
  const started = Promise.withResolvers<void>();
  const token = Promise.withResolvers<string>();
  const authorize = vi.spyOn(McpOAuthManager.prototype, 'authorize').mockImplementation(() => {
    started.resolve();
    return token.promise;
  });
  try {
    applyCoreSchema(db, '/unused-mcp-ipc-fixture');
    const store = new McpStore(db);
    const existing = store.createServer(authorization());
    registerMcpIpc({
      onConfigurationChanged: vi.fn(),
      getMcpStore: () => store,
      getStore: vi.fn(),
    });
    const request = getHandler(registration, mcpContract.authorize.channel);
    const pending = request(event, authorization());
    await started.promise;
    const url = 'https://other.example.test/mcp';
    store.updateServer(existing.id, { url });
    token.resolve('fixture-late');

    await expect(pending).resolves.toEqual({
      success: false,
      error: t('mcpAuthorizationEndpointMismatch'),
    });
    expect(store.listServers()).toHaveLength(1);
    expect(store.getServer(existing.id)?.url).toBe(url);
    expect(store.getServer(existing.id)?.headers).toBeUndefined();
  } finally {
    token.resolve('');
    db.close();
    authorize.mockRestore();
    registration.mockRestore();
  }
});

test('removing a legacy sibling preserves the grant and removing its owner does not transfer it', async () => {
  const db = new Database(':memory:');
  const registration = vi.spyOn(ipcMain, 'handle');
  const registryKey = `${MCP_OAUTH_STORE_PREFIX}fixture`;
  const saved = new Set([registryKey]);
  const kv = {
    delete: (key: string) => {
      saved.delete(key);
    },
  };
  try {
    applyCoreSchema(db, '/unused-mcp-ipc-fixture');
    const insert = db.prepare(`
      INSERT INTO mcp_servers (id, name, transport_type, config_json, created_at, updated_at)
      VALUES (?, ?, 'http', ?, 1, 1)
    `);
    insert.run('z-sibling', 'Duplicate', JSON.stringify({ registryId: 'fixture' }));
    insert.run('a-owner', 'Original', JSON.stringify({ registryId: 'fixture' }));
    insert.run(
      'm-sibling',
      'Keep my settings',
      JSON.stringify({ registryId: 'fixture', timeout: 91 }),
    );
    const store = new McpStore(db);
    expect(store.getRegistryOwner('fixture')?.id).toBe('a-owner');
    registerMcpIpc({
      onConfigurationChanged: vi.fn(),
      getMcpStore: () => store,
      getStore: () => kv as unknown as SqliteStore,
    });
    const remove = getHandler(registration, mcpContract.delete.channel);

    await expect(remove(event, 'z-sibling')).resolves.toMatchObject({ success: true });
    expect(saved.has(registryKey)).toBe(true);
    await expect(remove(event, 'a-owner')).resolves.toMatchObject({ success: true });
    expect(saved.has(registryKey)).toBe(false);
    expect(store.listServers()).toMatchObject([
      { id: 'm-sibling', name: 'Keep my settings', timeout: 91 },
    ]);
  } finally {
    db.close();
    registration.mockRestore();
  }
});
