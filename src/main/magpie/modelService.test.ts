import { describe, it, expect, vi } from 'vitest';
import { t } from '../i18n';
import { MagpieModelService } from './modelService';
import { ENTERPRISE_HOST_PROVIDER_PREFIX } from './hostProviders';
import type { MagpieModel, MagpieStatus } from '../../shared/magpie/types';
function fixture() {
  let state: MagpieStatus = {
    state: 'running',
    version: 'test',
    gatewayUrl: 'http://127.0.0.1:1234',
  };
  let selected: string | undefined;
  const backend = {
    status: () => state,
    models: vi.fn(async () => [{ id: 'vendor/model' }, { id: 'private/model' }]),
  };
  const beforeCatalog = vi.fn(async () => {});
  const routingUsage = {
    routingGroups: vi.fn(async () => ({ groups: [], models: [] })),
  };
  const service = new MagpieModelService(
    backend,
    {
      readDefaultModelId: () => selected,
      writeDefaultModelId: id => {
        selected = id;
      },
      beforeCatalog,
      allowedModel: model => model.id !== 'private/model',
    },
    routingUsage,
  );
  return {
    service,
    backend,
    routingUsage,
    beforeCatalog,
    setState: (s: MagpieStatus) => {
      state = s;
    },
  };
}
describe('single authoritative model service', () => {
  it('waits for an existing gateway startup before reading the first catalog', async () => {
    const f = fixture();
    const pending = Promise.withResolvers<void>();
    f.setState({ ...f.backend.status(), state: 'starting', gatewayUrl: undefined });
    const service = new MagpieModelService(
      { ...f.backend, waitForStartup: () => pending.promise },
      { readDefaultModelId: () => 'vendor/model', writeDefaultModelId: vi.fn() },
    );
    const reading = service.catalog();
    expect(f.backend.models).not.toHaveBeenCalled();
    f.setState({ ...f.backend.status(), state: 'running', gatewayUrl: 'http://127.0.0.1:1234' });
    pending.resolve();
    expect(await reading).toMatchObject({
      status: { state: 'running' },
      models: expect.arrayContaining([{ id: 'vendor/model' }]),
    });
  });

  it('automatically selects a Chat route that can pass explicit model admission', async () => {
    const { backend } = fixture();
    const managed = { id: `${ENTERPRISE_HOST_PROVIDER_PREFIX}fixture/model` };
    const ordinary = { id: 'vendor/chat' };
    let key: string | undefined;
    const service = new MagpieModelService(
      { ...backend, models: async () => [managed, ordinary], workKeyResolver: () => () => key },
      { readDefaultModelId: () => managed.id, writeDefaultModelId: vi.fn() },
    );

    await expect(service.resolve(managed.id)).rejects.toThrow('authorized desktop scope');
    expect((await service.resolveAutomatic())?.modelId).toBe(ordinary.id);
    await expect(service.resolveAutomatic(new Set([ordinary.id]))).resolves.toBeNull();

    key = 'fixture-scope';
    expect((await service.resolveAutomatic())?.modelId).toBe(managed.id);
    expect((await service.resolve(managed.id)).enterpriseChatRequest?.key()).toBe(key);
  });

  it('automatically selects a Work route using the same admission as an explicit Work model', async () => {
    const { backend } = fixture();
    const short = { id: 'vendor/short', context_window: 8192 };
    const task = { id: 'task', canonical_id: 'vendor/task', context_window: 32768 };
    const canonical = { id: 'vendor/task', context_window: 32768 };
    const workKey = vi.fn((): string | undefined => 'fixture-work-key');
    const service = new MagpieModelService(
      { ...backend, models: async () => [short, task, canonical], workKeyResolver: () => workKey },
      { readDefaultModelId: () => short.id, writeDefaultModelId: vi.fn() },
    );
    expect((await service.resolveAutomatic())?.modelId).toBe(short.id);
    await expect(service.resolve(short.id, { work: true })).rejects.toThrow();
    const selected = await service.resolveAutomatic(undefined, { work: true });
    expect(selected?.modelId).toBe(task.id);
    expect((await service.resolve(selected?.modelId, { work: true })).gatewayModel.id).toBe(
      canonical.id,
    );
    workKey.mockReturnValue(undefined);
    await expect(service.resolveAutomatic(undefined, { work: true })).resolves.toBeNull();
  });

  it('checks automatic Work capabilities on the executed route, including for a default alias', async () => {
    const { backend } = fixture();
    const alias: MagpieModel = {
      id: 'preferred',
      canonical_id: 'vendor/embedding',
      native_endpoints: ['/v1/chat/completions'],
    };
    const embedding: MagpieModel = {
      id: 'vendor/embedding',
      context_window: 32768,
      native_endpoints: ['/v1/embeddings'],
    };
    const chat: MagpieModel = {
      id: 'vendor/chat',
      context_window: 32768,
      native_endpoints: ['/v1/responses'],
      modalities: { input: ['text', 'image'], output: ['text'] },
    };
    const models = vi.fn(async () => [alias, embedding, chat]);
    const service = new MagpieModelService(
      { ...backend, models, workKeyResolver: () => () => 'fixture-work-key' },
      { readDefaultModelId: () => alias.id, writeDefaultModelId: vi.fn() },
    );

    expect((await service.resolveAutomatic(undefined, { work: true }))?.modelId).toBe(chat.id);
    expect(models).toHaveBeenCalledOnce();

    models.mockResolvedValueOnce([alias, embedding]);
    await expect(service.resolveAutomatic(undefined, { work: true })).resolves.toBeNull();

    models.mockResolvedValueOnce([
      { ...alias, canonical_id: chat.id, native_endpoints: embedding.native_endpoints },
      chat,
    ]);
    expect(await service.resolveAutomatic(undefined, { work: true, imageInput: true })).toEqual({
      modelId: alias.id,
      imageInput: true,
    });
  });

  it('rejects a declared audio-only input for explicit Chat and Work while keeping unknown input usable', async () => {
    const { backend } = fixture();
    const audio: MagpieModel = {
      id: 'vendor/audio',
      context_window: 32768,
      native_endpoints: ['/v1/chat/completions'],
      modalities: { input: ['audio'], output: ['text'] },
    };
    const unknown = { ...audio, id: 'vendor/unknown', modalities: { input: [], output: [] } };
    const service = new MagpieModelService(
      { ...backend, models: async () => [audio, unknown], workKeyResolver: () => () => 'fixture' },
      { readDefaultModelId: () => audio.id, writeDefaultModelId: vi.fn() },
    );

    for (const work of [false, true]) {
      await expect(service.resolve(audio.id, { work })).rejects.toThrow(
        t('coworkErrorModelTextUnsupported'),
      );
      await expect(service.resolve(unknown.id, { work })).resolves.toMatchObject({
        model: unknown,
      });
      expect((await service.resolveAutomatic(undefined, { work }))?.modelId).toBe(unknown.id);
    }
  });

  it('looks up all Work candidates without rebuilding the model index for each rejected scope', async () => {
    const { backend } = fixture();
    let idReads = 0;
    const models = Array.from({ length: 500 }, (_, index) => ({
      get id() {
        idReads++;
        return `provider/model-${index}`;
      },
      context_window: 32768,
    }));
    const service = new MagpieModelService(
      { ...backend, models: async () => models, workKeyResolver: () => () => undefined },
      { readDefaultModelId: () => undefined, writeDefaultModelId: vi.fn() },
    );

    await expect(service.resolveAutomatic(undefined, { work: true })).resolves.toBeNull();
    expect(idReads).toBeLessThan(models.length * 50);
  });

  it('keeps Pi recovery from reading a catalog rejected after a gateway change', async () => {
    const f = fixture();
    const route = await f.service.resolve('vendor/model');
    const old = Promise.withResolvers<{ id: string }[]>();
    f.backend.models.mockReturnValueOnce(old.promise);
    const reading = f.service.catalog();
    await vi.waitFor(() => expect(f.backend.models).toHaveBeenCalledTimes(2));

    f.setState({ ...f.backend.status(), gatewayUrl: 'http://127.0.0.1:4321' });
    old.resolve([{ id: 'previous/model' }]);
    await expect(reading).rejects.toThrow('Model service changed');
    expect(route.isCurrentRoute()).toBe(false);
  });

  it('does not replace a newer completed catalog when the older request finishes last', async () => {
    const f = fixture();
    const old = Promise.withResolvers<{ id: string }[]>();
    f.backend.models.mockReturnValueOnce(old.promise);
    const reading = f.service.catalog();
    await vi.waitFor(() => expect(f.backend.models).toHaveBeenCalledOnce());
    f.backend.models.mockResolvedValueOnce([{ id: 'new/model' }]);
    const route = await f.service.resolve('new/model');
    old.resolve([{ id: 'old/model' }]);
    expect((await reading).models).toEqual([{ id: 'new/model' }]);
    expect(route.isCurrentRoute()).toBe(true);
  });

  it('refreshes a catalog read that started before a route mutation', async () => {
    const f = fixture();
    const stale = Promise.withResolvers<MagpieModel[]>();
    f.backend.models.mockReturnValueOnce(stale.promise);
    const reading = f.service.catalog();
    await vi.waitFor(() => expect(f.backend.models).toHaveBeenCalledOnce());

    f.service.invalidateCatalog();
    f.backend.models.mockResolvedValueOnce([{ id: 'updated/model' }]);
    stale.resolve([{ id: 'previous/model' }]);
    expect((await reading).models).toEqual([{ id: 'updated/model' }]);
  });

  it('invalidates a cached model when a new process takes over the same gateway URL', async () => {
    const f = fixture();
    let owner = new AbortController();
    const service = new MagpieModelService(
      { ...f.backend, catalogOwner: () => owner.signal },
      { readDefaultModelId: () => null, writeDefaultModelId: () => {} },
    );
    const route = await service.resolve('vendor/model');
    expect(route.isCurrentRoute()).toBe(true);
    owner.abort();
    owner = new AbortController();
    expect(route.isCurrentRoute()).toBe(false);
    f.backend.models.mockResolvedValueOnce([{ id: 'next/model' }]);
    expect((await service.resolve('next/model')).model.id).toBe('next/model');
  });

  it('accepts a selected unified model without a legacy provider configuration or credential projection', async () => {
    const f = fixture();
    await f.service.selectDefault('vendor/model');
    expect(await f.service.checkReadiness()).toEqual({ hasConfig: true, config: null });
  });
  it('fails readiness when the selected model is revoked by the managed policy', async () => {
    const f = fixture();
    await f.service.selectDefault('vendor/model');
    f.backend.models.mockResolvedValue([{ id: 'private/model' }]);
    expect(await f.service.checkReadiness()).toEqual({
      hasConfig: false,
      config: null,
      error: expect.stringContaining('no longer available'),
    });
  });
  it('requires an explicit default model for readiness', async () => {
    const f = fixture();
    expect(await f.service.checkReadiness()).toEqual({
      hasConfig: false,
      config: null,
      error: expect.stringContaining('default model'),
    });
  });
  it('rejects readiness when the service is disabled without reading providers', async () => {
    const f = fixture();
    f.setState({ state: 'stopped', version: 'test' });
    expect(await f.service.checkReadiness()).toEqual({
      hasConfig: false,
      config: null,
      error: expect.stringContaining('Enable'),
    });
    expect(f.backend.models).not.toHaveBeenCalled();
  });
  it('requires an explicit selection and never falls back to the first or a legacy provider', async () => {
    const f = fixture();
    await expect(f.service.resolve()).rejects.toThrow('default model');
    await f.service.selectDefault('vendor/model');
    expect((await f.service.resolve()).model.id).toBe('vendor/model');
    f.backend.models.mockResolvedValue([]);
    await expect(f.service.resolve()).rejects.toThrow('no longer available');
  });
  it('hides routing groups whose leaf models fail managed policy', async () => {
    const f = fixture();
    f.routingUsage.routingGroups = vi.fn(async () => ({
      groups: [
        {
          id: 'mix',
          name: 'Mix',
          members: ['vendor/model', 'group/nested'],
          ready: true,
          memberInfo: [],
        },
        {
          id: 'nested',
          name: 'Nested',
          members: ['private/model'],
          ready: true,
          memberInfo: [],
        },
      ],
      models: [],
    }));
    f.backend.models.mockResolvedValue([
      { id: 'vendor/model' },
      { id: 'private/model' },
      { id: 'group/mix', display_name: 'Looks fine' },
    ]);
    expect((await f.service.catalog()).models.map(model => model.id)).toEqual(['vendor/model']);
  });
  it('rejects a Work alias when its canonical route is restricted', async () => {
    const f = fixture();
    const alias = { id: 'model', canonical_id: 'private/model' };
    f.backend.models.mockResolvedValue([{ id: 'private/model' }, alias]);

    expect((await f.service.resolve(alias.id)).model).toEqual(alias);
    await expect(f.service.resolve(alias.id, { work: true })).rejects.toThrow('restricted');
  });

  it('enforces managed policy on selection and explicit session overrides', async () => {
    const f = fixture();
    await expect(f.service.selectDefault('private/model')).rejects.toThrow('unavailable');
    await expect(f.service.resolve('private/model')).rejects.toThrow('restricted');
    expect((await f.service.catalog()).models).toEqual([{ id: 'vendor/model' }]);
  });
  it('never starts a stopped service or accesses upstream providers on a read', async () => {
    const f = fixture();
    f.setState({ state: 'stopped', version: 'test' });
    expect((await f.service.catalog()).models).toEqual([]);
    expect(f.beforeCatalog).not.toHaveBeenCalled();
    expect(f.backend.models).not.toHaveBeenCalled();
    await expect(f.service.resolve('vendor/model')).rejects.toThrow('Enable');
  });
  it('rejects a process change while the catalog is being read', async () => {
    const f = fixture();
    f.backend.models.mockImplementation(async () => {
      f.setState({ state: 'failed', version: 'test' });
      return [{ id: 'vendor/model' }];
    });
    await expect(f.service.catalog()).rejects.toThrow('changed');
  });
});

it('only actual model resolution requests an authorized lazy startup', async () => {
  let status: MagpieStatus = { state: 'stopped', version: 'test', enabled: true };
  const ensureRunning = vi.fn(async () => {
    status = { ...status, state: 'running', gatewayUrl: 'http://127.0.0.1:1234' };
    return status;
  });
  const service = new MagpieModelService(
    { status: () => status, models: async () => [{ id: 'fixture/model' }], ensureRunning },
    {
      readDefaultModelId: () => 'fixture/model',
      writeDefaultModelId: () => {},
    },
  );
  await service.catalog();
  expect(ensureRunning).not.toHaveBeenCalled();
  expect((await service.resolve()).model.id).toBe('fixture/model');
  expect(ensureRunning).toHaveBeenCalledTimes(1);
});

describe('fallback chains and observability', () => {
  it('scopes Work to the selected model and eligible configured fallbacks', async () => {
    const gatewayUrl = 'http://127.0.0.1:1234';
    const workKey = vi.fn(() => 'sk-fixture-work' as string | undefined);
    let revoked = false;
    let fallback = ['备用😀', 'spare/small', 'spare/revoked', 'spare/audio'];
    const service = new MagpieModelService(
      {
        status: () => ({ state: 'running', version: 'test', gatewayUrl }),
        workKeyResolver: url => (url === gatewayUrl ? workKey : undefined),
        models: async () => [
          { id: 'primary/model' },
          { id: 'spare/备用😀', context_window: 32768 },
          { id: '备用😀', canonical_id: 'spare/备用😀' },
          { id: 'spare/small', context_window: 8192 },
          { id: 'spare/revoked', context_window: 32768 },
          {
            id: 'spare/audio',
            context_window: 32768,
            modalities: { input: ['audio'], output: ['text'] },
            native_endpoints: ['/v1/chat/completions'],
          },
          { id: 'spare/unrelated', context_window: 32768 },
        ],
        providers: async () => [
          {
            id: 'primary',
            name: 'Primary',
            api: 'openai-completions',
            baseUrl: 'https://fixture.test/v1',
            models: ['model'],
            fallback,
            off: false,
            hasKey: true,
          },
        ],
      },
      {
        readDefaultModelId: () => 'primary/model',
        writeDefaultModelId: () => {},
        allowedModel: model => !revoked || model.id !== 'spare/revoked',
      },
    );

    expect((await service.resolve()).workRequest).toBeUndefined();
    expect((await service.resolve('spare/small')).gatewayModel.id).toBe('spare/small');
    await expect(service.resolve('spare/small', { work: true })).rejects.toThrow(/8192/);
    await expect(service.resolve('spare/audio', { work: true })).rejects.toThrow(
      t('coworkErrorModelTextUnsupported'),
    );
    const { workRequest } = await service.resolve(undefined, { work: true });
    expect(workRequest?.key()).toBe('sk-fixture-work');
    expect(workRequest?.models()).toBe(
      '["primary/model","spare/\\u5907\\u7528\\ud83d\\ude00","spare/revoked"]',
    );
    revoked = true;
    expect(JSON.parse(workRequest!.models()!)).toEqual(['primary/model', 'spare/备用😀']);
    fallback = ['spare/unrelated'];
    service.invalidateCatalog();
    expect(workRequest?.models()).toBeUndefined();
    await service.catalog();
    expect(JSON.parse(workRequest!.models()!)).toEqual(['primary/model', 'spare/unrelated']);
    workKey.mockReturnValue(undefined);
    expect(workRequest?.key()).toBeUndefined();
  });

  it('falls back to compatible model within provider fallback chain when primary is missing', async () => {
    const status: MagpieStatus = {
      state: 'running',
      version: 'test',
      gatewayUrl: 'http://127.0.0.1:1234',
    };
    const backend = {
      status: () => status,
      models: vi.fn(async () => [{ id: 'gpt-4o-mini' }]),
      providers: vi.fn(async () => [
        {
          id: 'custom-openai',
          name: 'OpenAI',
          api: 'openai-completions' as const,
          baseUrl: 'https://api.openai.com/v1',
          models: ['gpt-4o'],
          fallback: ['gpt-4o-mini'],
          off: false,
          hasKey: true,
        },
      ]),
    };
    const service = new MagpieModelService(backend, {
      readDefaultModelId: () => 'gpt-4o',
      writeDefaultModelId: () => {},
    });
    const resolution = await service.resolve('gpt-4o');
    expect(resolution.model.id).toBe('gpt-4o-mini');
    expect(backend.providers).toHaveBeenCalledOnce();
    expect(resolution.provider?.id).toBe('custom-openai');
    expect(resolution.provider?.baseUrl).toBe('https://api.openai.com/v1');
    await expect(service.resolve('gpt-4o', { requirePublishedModel: true })).rejects.toThrow(
      'selected model is no longer available',
    );
    await expect(
      service.resolve('gpt-4o-mini', { requirePublishedModel: true }),
    ).resolves.toMatchObject({
      gatewayModel: { id: 'gpt-4o-mini' },
    });
  });

  it('resolves a missing qualified Work model through the first executable fallback', async () => {
    const gatewayUrl = 'http://127.0.0.1:1234';
    let primaryVisible = false;
    let firstTextContext = 8192;
    const service = new MagpieModelService(
      {
        status: () => ({ state: 'running', version: 'test', gatewayUrl }),
        workKeyResolver: () => () => 'fixture-scope',
        models: async () => [
          ...(primaryVisible ? [{ id: 'primary/configured', context_window: 32768 }] : []),
          { id: 'spare/audio', modalities: { input: ['audio'], output: ['text'] } },
          { id: 'spare/small', context_window: firstTextContext },
          { id: 'spare/text', context_window: 32768 },
        ],
        providers: async () => [
          {
            id: 'primary',
            name: 'Primary',
            api: 'openai-completions',
            baseUrl: 'https://fixture.test/v1',
            models: ['configured'],
            fallback: ['spare/audio', 'spare/small', 'spare/text'],
            off: false,
            hasKey: true,
          },
        ],
      },
      { readDefaultModelId: () => 'primary/configured', writeDefaultModelId: vi.fn() },
    );

    const selected = await service.resolve(undefined, { work: true });
    expect(selected.gatewayModel.id).toBe('spare/text');
    expect(selected.workRequest?.models()).toBe('["spare/text"]');
    expect(selected.isCurrentRoute()).toBe(true);
    await expect(service.resolve('configured', { work: true })).resolves.toMatchObject({
      gatewayModel: { id: 'spare/text' },
    });
    await expect(service.resolve('primary/unknown', { work: true })).rejects.toThrow(
      'selected model is no longer available',
    );
    firstTextContext = 32768;
    await service.catalog();
    expect(selected.isCurrentRoute()).toBe(false);
    const earlier = await service.resolve(undefined, { work: true });
    expect(earlier.gatewayModel.id).toBe('spare/small');
    primaryVisible = true;
    await service.catalog();
    expect(earlier.isCurrentRoute()).toBe(false);
    await expect(service.resolve(undefined, { work: true })).resolves.toMatchObject({
      gatewayModel: { id: 'primary/configured' },
    });
  });

  it('delegates recordError to backend', () => {
    const status: MagpieStatus = { state: 'running', version: 'test' };
    const recordError = vi.fn();
    const service = new MagpieModelService(
      { status: () => status, models: async () => [], recordError },
      { readDefaultModelId: () => null, writeDefaultModelId: () => {} },
    );
    service.recordError('429 Rate limited', 'custom-openai');
    expect(recordError).toHaveBeenCalledWith('429 Rate limited', 'custom-openai');
  });

  it('drops unconfigured 1M catalog guesses on private/LAN endpoints while preserving explicit contexts', async () => {
    const status: MagpieStatus = {
      state: 'running',
      version: 'test',
      gatewayUrl: 'http://127.0.0.1:1234',
    };
    const backend = {
      status: () => status,
      models: vi.fn(async () => [
        { id: 'lan-selfhost/qwen3-coder', context_window: 1_000_000 },
        { id: 'lan-configured/qwen3-coder', context_window: 1_000_000 },
        { id: 'cloud-official/qwen3-coder', context_window: 1_000_000 },
      ]),
      providers: vi.fn(async () => [
        {
          id: 'lan-selfhost',
          name: 'LAN Model',
          api: 'openai-completions' as const,
          baseUrl: 'http://172.18.5.188:3000/v1',
          models: ['qwen3-coder'],
          off: false,
          hasKey: true,
        },
        {
          id: 'lan-configured',
          name: 'Configured LAN Model',
          api: 'openai-completions' as const,
          baseUrl: 'http://192.168.1.10:8000/v1',
          models: ['qwen3-coder'],
          contexts: { 'qwen3-coder': 1_000_000 },
          off: false,
          hasKey: true,
        },
        {
          id: 'cloud-official',
          name: 'Cloud',
          api: 'openai-completions' as const,
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          models: ['qwen3-coder'],
          off: false,
          hasKey: true,
        },
      ]),
    };
    const service = new MagpieModelService(backend, {
      readDefaultModelId: () => 'lan-selfhost/qwen3-coder',
      writeDefaultModelId: () => {},
    });
    const catalog = await service.catalog();
    expect(
      catalog.models.find(m => m.id === 'lan-selfhost/qwen3-coder')?.context_window,
    ).toBeUndefined();
    expect(catalog.models.find(m => m.id === 'lan-configured/qwen3-coder')?.context_window).toBe(
      1_000_000,
    );
    expect(catalog.models.find(m => m.id === 'cloud-official/qwen3-coder')?.context_window).toBe(
      1_000_000,
    );
  });
});
