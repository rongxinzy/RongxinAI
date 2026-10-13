import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  fetch: vi.fn(),
}));

const intranetMocks = vi.hoisted(() => ({
  probe: vi.fn(async () => false),
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

vi.mock('./libs/zhiyuanIntranet', () => ({
  probeZhiyuanIntranet: intranetMocks.probe,
  warmZhiyuanIntranetProbe: () => undefined,
  zhiyuanIntranetApiKey: () => 'intranet-api-key',
}));

import { ModelPoolIpc } from '../shared/ipc/channels';
import { ModelPoolStreamSchema } from '../shared/ipc/schemas';
import {
  ZhiyuanModelPool,
  ZhiyuanModelPoolHeader,
  ZhiyuanModelPoolWorkload,
} from '../shared/modelPool/constants';
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
  intranetMocks.probe.mockReset();
  intranetMocks.probe.mockResolvedValue(false);
  vi.stubEnv(
    'ZHIYUAN_MODEL_POOL_BASE_URL',
    'https://zhiyuan-model-pool-staging.windflyme5.workers.dev',
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Model Pool IPC', () => {
  test('cancels while awaiting credentials without starting inference', async () => {
    const manager = createSessionManager();
    let resolveToken: (token: string) => void = () => undefined;
    vi.spyOn(manager, 'getModelPoolAccessToken').mockImplementation(
      () =>
        new Promise(resolve => {
          resolveToken = resolve;
        }),
    );
    registerModelPoolIpcHandlers(manager);
    const pending = electronMocks.handlers.get(ModelPoolIpc.Stream)?.(
      { sender: { send: vi.fn() } },
      { requestId: 'cancel-auth', conversationId: 'session', body: {} },
    );
    expect(electronMocks.handlers.get(ModelPoolIpc.CancelStream)?.({}, 'cancel-auth')).toBe(true);
    // Token acquisition now happens after route resolution, so wait until the
    // handler is actually awaiting credentials before releasing the promise.
    await vi.waitFor(() => expect(manager.getModelPoolAccessToken).toHaveBeenCalled());
    resolveToken('token');
    await expect(pending).resolves.toMatchObject({ ok: false });
    expect(electronMocks.fetch).not.toHaveBeenCalled();
  });
  test('cancels the response reader and emits abort instead of completion', async () => {
    const cancelled = vi.fn();
    electronMocks.fetch.mockResolvedValue(
      new Response(new ReadableStream({ cancel: cancelled }), {
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
    registerModelPoolIpcHandlers(createSessionManager());
    const send = vi.fn();
    await electronMocks.handlers.get(ModelPoolIpc.Stream)?.(
      { sender: { send } },
      { requestId: 'cancel-reader', conversationId: 'session', body: {} },
    );
    electronMocks.handlers.get(ModelPoolIpc.CancelStream)?.({}, 'cancel-reader');
    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith(ModelPoolIpc.streamAbort('cancel-reader')),
    );
    expect(cancelled).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalledWith(ModelPoolIpc.streamDone('cancel-reader'));
  });
  test('requires a stable conversation ID and rejects unsafe header values', () => {
    const input = { requestId: 'request-1', body: {} };
    for (const conversationId of [undefined, '', 'line\r\nbreak', 'x'.repeat(161)]) {
      expect(ModelPoolStreamSchema.input.safeParse({ ...input, conversationId }).success).toBe(
        false,
      );
    }
    expect(
      ModelPoolStreamSchema.input.safeParse({ ...input, conversationId: 'chat-1' }).success,
    ).toBe(true);
  });
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

  test('reports the intranet model under the logical free model id', async () => {
    intranetMocks.probe.mockResolvedValue(true);
    const sessionManager = createSessionManager();
    electronMocks.fetch.mockResolvedValue(
      Response.json({
        object: 'list',
        data: [{ id: ZhiyuanModelPool.IntranetModelId, object: 'model' }],
      }),
    );
    registerModelPoolIpcHandlers(sessionManager);
    const handler = electronMocks.handlers.get(ModelPoolIpc.ListModels);

    await expect(handler?.({})).resolves.toEqual({
      ok: true,
      status: 200,
      models: [ZhiyuanModelPool.FreeModelId],
    });
    expect(electronMocks.fetch).toHaveBeenCalledWith('http://172.18.5.188:3000/v1/models', {
      headers: { Authorization: 'Bearer intranet-api-key' },
    });
    expect(sessionManager.getModelPoolAccessToken).not.toHaveBeenCalled();
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
          conversationId: 'conversation-1',
          body: { model: 'untrusted-model', messages: [{ role: 'user', content: 'hello' }] },
        },
      ),
    ).resolves.toMatchObject({ ok: true, status: 200 });
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(ModelPoolIpc.streamDone('request-1')));

    const [url, init] = electronMocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://zhiyuan-model-pool-staging.windflyme5.workers.dev/v1/chat/completions',
    );
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer model-pool-access-token',
      [ZhiyuanModelPoolHeader.ConversationId]: 'conversation-1',
      [ZhiyuanModelPoolHeader.Workload]: ZhiyuanModelPoolWorkload.Chat,
    });
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
        {
          requestId: 'request-2',
          conversationId: 'conversation-1',
          body: { messages: [{ role: 'user', content: 'hello' }] },
        },
      ),
    ).resolves.toMatchObject({ ok: true, status: 200 });

    expect(sessionManager.getModelPoolAccessToken).toHaveBeenNthCalledWith(1);
    expect(sessionManager.getModelPoolAccessToken).toHaveBeenNthCalledWith(2, {
      forceRefresh: true,
    });
    expect(electronMocks.fetch).toHaveBeenCalledTimes(2);
    for (const [, init] of electronMocks.fetch.mock.calls as [string, RequestInit][]) {
      expect(init.headers).toMatchObject({
        [ZhiyuanModelPoolHeader.ConversationId]: 'conversation-1',
      });
    }
  });

  test('prefers the intranet gateway for streaming when it is reachable', async () => {
    intranetMocks.probe.mockResolvedValue(true);
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
          requestId: 'intranet-1',
          conversationId: 'conversation-1',
          body: { messages: [{ role: 'user', content: 'hello' }] },
        },
      ),
    ).resolves.toMatchObject({ ok: true, status: 200 });
    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith(ModelPoolIpc.streamDone('intranet-1')),
    );

    const [url, init] = electronMocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://172.18.5.188:3000/v1/chat/completions');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer intranet-api-key' });
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: ZhiyuanModelPool.IntranetModelId,
      stream: true,
    });
    expect(sessionManager.getModelPoolAccessToken).not.toHaveBeenCalled();
  });

  test('does not refresh community credentials for an intranet authentication rejection', async () => {
    intranetMocks.probe.mockResolvedValue(true);
    const sessionManager = createSessionManager();
    electronMocks.fetch.mockResolvedValue(new Response('unauthorized', { status: 401 }));
    registerModelPoolIpcHandlers(sessionManager);
    const handler = electronMocks.handlers.get(ModelPoolIpc.Stream);

    await expect(
      handler?.(
        { sender: { send: vi.fn() } },
        {
          requestId: 'intranet-2',
          conversationId: 'conversation-1',
          body: { messages: [{ role: 'user', content: 'hello' }] },
        },
      ),
    ).resolves.toMatchObject({ ok: false, status: 401 });

    expect(sessionManager.getModelPoolAccessToken).not.toHaveBeenCalled();
    expect(electronMocks.fetch).toHaveBeenCalledTimes(1);
  });
});
