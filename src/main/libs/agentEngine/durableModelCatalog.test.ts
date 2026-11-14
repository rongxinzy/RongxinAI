import { expect, test, vi } from 'vitest';
import { ZhiyuanModelPoolHeader } from '../../../shared/modelPool/constants';
import { zhiyuanManagedProviderBridge as bridge } from '../../enterpriseExtension/managedProviderBridge';
import { catalogHttpFixture } from './durableModelCatalog.testHarness';

const context = {
  systemPrompt: 'Enterprise rules.',
  messages: [{ role: 'user' as const, content: 'Hello.', timestamp: 1 }],
};

test('native HTTP uses enterprise credentials and model-pool headers, while mapping developer immutably', async () => {
  const f = await catalogHttpFixture();
  let original: unknown;
  const result = await f.catalog.models.completeSimple(f.model, context, {
    maxRetries: 0,
    onPayload: payload => {
      const body = payload as { messages: Array<Record<string, unknown>> };
      expect(body.messages[0].role).toBe('developer');
      for (const message of body.messages) Object.freeze(message);
      Object.freeze(body.messages);
      original = Object.freeze(body);
      return original;
    },
  });
  expect(result.stopReason).toBe('stop');
  expect(f.requests).toHaveLength(1);
  expect(f.requests[0].headers.authorization).toBe('Bearer initial-enterprise-fixture-token');
  expect(f.requests[0].headers[ZhiyuanModelPoolHeader.ConversationId.toLowerCase()]).toBe(
    'conversation',
  );
  expect(f.requests[0].headers[ZhiyuanModelPoolHeader.Workload.toLowerCase()]).toBe('work');
  expect(f.requests[0].body.messages).toEqual([
    { role: 'system', content: 'Enterprise rules.' },
    { role: 'user', content: 'Hello.' },
  ]);
  expect((original as { messages: Array<{ role: string }> }).messages[0].role).toBe('developer');
});

test.each([401, 403])(
  'native HTTP %i invalidates the enterprise token and the next request resolves a fresh token',
  async status => {
    const f = await catalogHttpFixture();
    f.setStatus(status);
    const before = f.snapshots();
    const rejected = await f.catalog.models.completeSimple(f.model, context, { maxRetries: 0 });
    expect(rejected.stopReason).toBe('error');
    expect(f.snapshots()).toBe(before);
    f.setToken('refreshed-enterprise-fixture-token');
    f.setStatus(200);
    const recovered = await f.catalog.models.completeSimple(f.model, context, { maxRetries: 0 });
    expect(recovered.stopReason).toBe('stop');
    expect(f.snapshots()).toBeGreaterThan(before);
    expect(f.requests.map(request => request.headers.authorization)).toEqual([
      'Bearer initial-enterprise-fixture-token',
      'Bearer refreshed-enterprise-fixture-token',
    ]);
  },
);

test('Anthropic native requests preserve protocol instructions and use x-api-key', async () => {
  const f = await catalogHttpFixture('anthropic-messages');
  const result = await f.catalog.models.completeSimple(f.model, context, { maxRetries: 0 });
  expect(result.stopReason).toBe('stop');
  expect(f.requests[0].headers['x-api-key']).toBe('initial-enterprise-fixture-token');
  expect(JSON.stringify(f.requests[0].body.system)).toContain('Enterprise rules.');
  expect(f.requests[0].body.messages).toEqual([
    {
      role: 'user',
      content: [{ type: 'text', text: 'Hello.', cache_control: { type: 'ephemeral' } }],
    },
  ]);
});

test('ordinary provider HTTP leaves developer roles and runtime credentials intact', async () => {
  const f = await catalogHttpFixture();
  const provider = 'ordinary';
  f.catalog.registerProvider(provider, {
    api: 'openai-completions',
    baseUrl: f.definition.baseUrl,
    models: [{ ...f.definition, provider }],
  });
  await f.catalog.setRuntimeApiKey(provider, 'ordinary-fixture-key');
  const model = f.catalog.getModel(provider, 'fixture')!;
  const invalidate = vi.spyOn(bridge, 'invalidateToken');
  try {
    await f.catalog.models.completeSimple(model, context, { maxRetries: 0 });
    expect((f.requests[0].body.messages as Array<{ role: string }>)[0].role).toBe('developer');
    expect(f.requests[0].headers.authorization).toBe('Bearer ordinary-fixture-key');
    f.setStatus(401);
    const result = await f.catalog.models.completeSimple(model, context, { maxRetries: 0 });
    expect(result.stopReason).toBe('error');
    expect(invalidate).not.toHaveBeenCalled();
  } finally {
    invalidate.mockRestore();
  }
});

test('managed native transport replaces stale authorization headers without mutating caller headers', async () => {
  const f = await catalogHttpFixture();
  const headers = Object.freeze({ Authorization: 'Bearer stale-token', 'x-api-key': 'stale-key' });
  await f.catalog.models.completeSimple(f.model, context, { maxRetries: 0, headers });
  expect(f.requests[0].headers.authorization).toBe('Bearer initial-enterprise-fixture-token');
  expect(f.requests[0].headers['x-api-key']).toBe('initial-enterprise-fixture-token');
  expect(headers.Authorization).toBe('Bearer stale-token');
});

test('native model switching retains existing provider model identities and dispatches both protocols', async () => {
  const { DurableSession } = await import('./durableSession.mjs');
  const f = await catalogHttpFixture();
  const session = await DurableSession.open({
    model: f.model as unknown as Record<string, unknown>,
    modelRuntime: f.catalog,
  });
  try {
    f.catalog.registerProvider(f.model.provider, {
      api: 'anthropic-messages',
      baseUrl: f.definition.baseUrl,
      models: [{ ...f.definition, id: 'second', api: 'anthropic-messages', compat: undefined }],
    });
    expect(f.catalog.getModel(f.model.provider, 'fixture')).toBeDefined();
    await session.prompt('The existing model remains runnable.');
    const second = f.catalog.getModel(f.model.provider, 'second')!;
    await session.setModel(second);
    await session.prompt('Use the added model.');
    await session.setModel(f.model);
    await session.prompt('Switch back without a model-not-found failure.');
    expect(f.requests.map(request => request.body.model)).toEqual(['fixture', 'second', 'fixture']);
    expect(f.requests[0].headers.authorization).toContain('Bearer');
    expect(f.requests[1].headers['x-api-key']).toBe('initial-enterprise-fixture-token');
  } finally {
    await session.close();
  }
});
