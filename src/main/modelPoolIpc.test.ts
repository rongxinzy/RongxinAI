import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  fetch: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { isPackaged: false },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      electronMocks.handlers.set(channel, handler);
    },
  },
  session: { defaultSession: { fetch: electronMocks.fetch } },
}));

import { ModelPoolIpc } from '../shared/ipc/channels';
import type { CommunityAuthSessionManager } from './communityAuthSession';
import { registerModelPoolIpcHandlers } from './modelPoolIpc';

function createSessionManager() {
  return {
    getModelPoolAccessToken: vi.fn(async () => 'model-pool-access-token'),
    getUser: vi.fn(() => ({ id: 'user-1', email: 'user@example.com' })),
  } as unknown as CommunityAuthSessionManager;
}

beforeEach(() => {
  electronMocks.handlers.clear();
  electronMocks.fetch.mockReset();
  vi.stubEnv(
    'ZHIYUAN_MODEL_POOL_BASE_URL',
    'https://zhiyuan-model-pool-staging.windflyme5.workers.dev',
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Model Pool IPC', () => {
  test('lists only logical models returned for the authenticated account', async () => {
    const sessionManager = createSessionManager();
    electronMocks.fetch.mockResolvedValue(
      Response.json({
        object: 'list',
        data: [
          { id: 'zhiyuan-free', object: 'model', owned_by: 'zhiyuan' },
          { id: 42, object: 'model' },
        ],
      }),
    );
    registerModelPoolIpcHandlers(sessionManager);
    const handler = electronMocks.handlers.get(ModelPoolIpc.ListModels);

    await expect(handler?.({})).resolves.toEqual({
      ok: true,
      status: 200,
      models: ['zhiyuan-free'],
    });
    expect(electronMocks.fetch).toHaveBeenCalledWith(
      'https://zhiyuan-model-pool-staging.windflyme5.workers.dev/v1/models',
      { headers: { Authorization: 'Bearer model-pool-access-token' } },
    );
  });

  test('does not expose models when the business policy rejects the account', async () => {
    const sessionManager = createSessionManager();
    electronMocks.fetch.mockResolvedValue(
      Response.json(
        { error: { code: 'entitlement_required', message: 'not entitled' } },
        { status: 403 },
      ),
    );
    registerModelPoolIpcHandlers(sessionManager);
    const handler = electronMocks.handlers.get(ModelPoolIpc.ListModels);

    await expect(handler?.({})).resolves.toMatchObject({
      ok: false,
      status: 403,
      models: [],
    });
  });

  test('owns the endpoint and authorization header in the main process', async () => {
    const sessionManager = createSessionManager();
    electronMocks.fetch.mockResolvedValue(
      new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
    registerModelPoolIpcHandlers(sessionManager);
    const handler = electronMocks.handlers.get(ModelPoolIpc.Stream);
    const send = vi.fn();

    await expect(
      handler?.(
        { sender: { send } },
        {
          requestId: 'request-1',
          body: { model: 'untrusted-model', messages: [{ role: 'user', content: 'hello' }] },
        },
      ),
    ).resolves.toMatchObject({ ok: true, status: 200 });
    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith(ModelPoolIpc.streamDone('request-1')),
    );

    const [url, init] = electronMocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://zhiyuan-model-pool-staging.windflyme5.workers.dev/v1/chat/completions',
    );
    expect(init.headers).toMatchObject({ Authorization: 'Bearer model-pool-access-token' });
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'zhiyuan-free',
      stream: true,
    });
  });

  test('refreshes once after an authentication rejection', async () => {
    const sessionManager = createSessionManager();
    electronMocks.fetch
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response('data: [DONE]\n\n', { status: 200 }));
    registerModelPoolIpcHandlers(sessionManager);
    const handler = electronMocks.handlers.get(ModelPoolIpc.Stream);

    await expect(
      handler?.(
        { sender: { send: vi.fn() } },
        { requestId: 'request-2', body: { messages: [{ role: 'user', content: 'hello' }] } },
      ),
    ).resolves.toMatchObject({ ok: true, status: 200 });

    expect(sessionManager.getModelPoolAccessToken).toHaveBeenNthCalledWith(1);
    expect(sessionManager.getModelPoolAccessToken).toHaveBeenNthCalledWith(2, {
      forceRefresh: true,
    });
    expect(electronMocks.fetch).toHaveBeenCalledTimes(2);
  });
});
