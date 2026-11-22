import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_MAGPIE_WORK_KEY } from '../../../../tests/helpers/createTestMagpie';
import { CoworkSessionMode } from '../../../shared/cowork/constants';
import { LOCAL_GPU_MAGPIE_PROVIDER_ID } from '../../../shared/magpie/constants';
import {
  MAGPIE_ROUTING_GROUP_PREFIX,
  MagpieProviderRouting,
} from '../../../shared/magpie/routingUsage';
import type { MagpieProviderSummary } from '../../../shared/magpie/types';
import {
  ZhiyuanManagedProviderBridge,
  zhiyuanManagedProviderBridge,
} from '../../enterpriseExtension/managedProviderBridge';
import { setLanguage } from '../../i18n';
import { projectMagpieCatalog } from '../../magpie/catalog';
import { ManagedMagpieProviderBindings } from '../../magpie/managedProviderBindings';
import { MagpieModelService } from '../../magpie/modelService';
import { MagpieRoutingUsageService } from '../../magpie/routingUsageService';
import { buildLlamaCppRunningModelBinding } from '../llamacppAgentBinding';
import { PiRuntimeAdapter } from './piRuntimeAdapter';

const mocks = vi.hoisted(() => {
  const session = {
    prompt: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn((_listener: (event: { type: string }) => void) => () => {}),
    abort: vi.fn().mockResolvedValue(undefined),
    abortBash: vi.fn(),
  };
  return {
    createAgentSession: vi.fn(async () => ({ session })),
    session,
  };
});

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: mocks.createAgentSession,
  formatSkillsForPrompt: vi.fn(() => ''),
  DefaultResourceLoader: class {
    async reload() {}
  },
  SessionManager: { inMemory: vi.fn(() => ({})) },
  SettingsManager: { create: vi.fn(() => ({ applyOverrides: vi.fn() })) },
  getAgentDir: vi.fn(() => '/tmp/pi-agent'),
  ModelRuntime: {
    create: vi.fn(async () => ({
      registerProvider: vi.fn(),
      registerNativeProvider: vi.fn(),
      setRuntimeApiKey: vi.fn().mockResolvedValue(undefined),
    })),
  },
  createCodemodeExtension: vi.fn(),
  createMcpExtension: vi.fn(),
  createToolSearchExtension: vi.fn(),
}));
vi.mock('@earendil-works/pi-ai/compat', async importOriginal => ({
  ...(await importOriginal<typeof import('@earendil-works/pi-ai/compat')>()),
  getModel: vi.fn(),
  completeSimple: vi.fn(),
}));
vi.mock('../coworkUtil', async importOriginal => ({
  ...(await importOriginal<typeof import('../coworkUtil')>()),
  applyApplicationRuntimeEnv: vi.fn(),
}));

describe('unified model readiness and actual inference', () => {
  let adapter: PiRuntimeAdapter;
  const configureAdapter = (modelService?: MagpieModelService) => {
    adapter = new PiRuntimeAdapter({ modelService });
    adapter.on('error', () => {});
  };
  beforeEach(() => {
    vi.clearAllMocks();
    configureAdapter();
  });
  afterEach(() => {
    adapter.stopAllSessions();
  });

  it('adapts a bare Chat model using the provider that owns its catalog route', async () => {
    const modelId = 'shared-chat-model';
    const owner = 'openrouter-owned';
    const sharedProvider: Omit<MagpieProviderSummary, 'id' | 'name' | 'baseUrl'> = {
      api: 'openai-completions',
      models: [modelId],
      off: false,
      hasKey: true,
    };
    const resolution = new MagpieModelService(
      {
        status: () => ({ state: 'running', version: 'test', gatewayUrl: 'http://127.0.0.1:1234' }),
        models: async () => [{ id: modelId, owned_by: owner, canonical_id: `${owner}/${modelId}` }],
        providers: async () => [
          { ...sharedProvider, id: 'other', name: 'Other', baseUrl: 'https://other.test/v1' },
          { ...sharedProvider, id: owner, name: 'Actual', baseUrl: 'https://openrouter.ai/api/v1' },
        ],
      },
      { readDefaultModelId: () => modelId, writeDefaultModelId: () => {} },
    );
    configureAdapter(resolution);
    await adapter.startSession('bare-chat', 'Hello', { sessionMode: CoworkSessionMode.Chat });

    expect(mocks.createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({
          id: modelId,
          compat: expect.objectContaining({ sessionAffinityFormat: 'openrouter' }),
        }),
      }),
    );
  });

  it.each(['cloud', 'custom local', 'group', 'fallback', 'enterprise', 'enterprise alias'])(
    'preserves the actual owner of a %s model with the same raw enterprise name',
    async selection => {
      const modelId = 'shared-model';
      const enterpriseBaseUrl = 'https://enterprise.test/v1';
      const disposeEnterprise = zhiyuanManagedProviderBridge.registerSource({
        providerKey: 'custom_enterprise',
        exclusive: false,
        snapshot: async () => ({
          enabled: true,
          apiKey: 'enterprise-fixture-token',
          baseUrl: enterpriseBaseUrl,
          models: [{ id: modelId, name: 'Shared model' }],
        }),
      });
      try {
        await zhiyuanManagedProviderBridge.refresh();
        const enterpriseOwner =
          zhiyuanManagedProviderBridge.hostProviders('http://127.0.0.1:5678')[0].id;
        const canonical = `${enterpriseOwner}/${modelId}`;
        const cloud = { id: `cloud/${modelId}`, owned_by: 'cloud' };
        const bySelection = {
          cloud,
          'custom local': { id: `custom-local/${modelId}`, owned_by: 'custom-local' },
          group: { id: `group/${modelId}`, owned_by: enterpriseOwner },
          fallback: cloud,
          enterprise: { id: canonical, owned_by: enterpriseOwner },
          'enterprise alias': { id: modelId, owned_by: enterpriseOwner, canonical_id: canonical },
        };
        const chosen = bySelection[selection as keyof typeof bySelection];
        const gatewayUrl = 'http://127.0.0.1:1234';
        configureAdapter(
          new MagpieModelService(
            {
              status: () => ({ state: 'running', version: 'test', gatewayUrl }),
              models: async () => [chosen],
              workKeyResolver: () => () => 'scoped-test-key',
              providers: async () => [
                {
                  id: 'unavailable',
                  name: 'Unavailable',
                  api: 'openai-completions',
                  baseUrl: 'https://fallback-source.test/v1',
                  models: [modelId],
                  fallback: [cloud.id],
                  off: false,
                  hasKey: true,
                },
              ],
            },
            { readDefaultModelId: () => chosen.id, writeDefaultModelId: () => {} },
          ),
        );
        await adapter.startSession('shared-model-session', 'Hello', {
          sessionMode: CoworkSessionMode.Chat,
          modelOverride: selection === 'fallback' ? modelId : undefined,
        });
        expect(mocks.createAgentSession).toHaveBeenLastCalledWith(
          expect.objectContaining({
            model: expect.objectContaining({
              id: chosen.id,
              provider: 'magpie',
              baseUrl: `${gatewayUrl}/v1`,
            }),
          }),
        );
      } finally {
        disposeEnterprise();
      }
    },
  );

  it.each(['disabled', 'revoked', 'unselected', 'catalog-failed'] as const)(
    'rejects %s unified models even when a legacy provider is configured',
    async scenario => {
      const service = new MagpieModelService(
        {
          status: () => ({
            state: scenario === 'disabled' ? 'stopped' : 'running',
            version: 'test',
            gatewayUrl: 'http://127.0.0.1:1234',
          }),
          models: async () => {
            if (scenario === 'catalog-failed') throw new Error('Catalog unavailable');
            return scenario === 'revoked' ? [] : [{ id: 'fixture/model' }];
          },
        },
        {
          readDefaultModelId: () => (scenario === 'unselected' ? null : 'fixture/model'),
          writeDefaultModelId: () => {},
        },
      );
      configureAdapter(service);
      const readiness = await service.checkReadiness();
      expect(readiness.hasConfig).toBe(false);
      await expect(adapter.startSession('unified-rejected', 'Hello')).rejects.toThrow(
        readiness.error,
      );
      expect(mocks.createAgentSession).not.toHaveBeenCalled();
    },
  );

  it('uses the same selected unified model for readiness and actual inference', async () => {
    const models = vi.fn(async () => [{ id: 'fixture/model' }]);
    let generation = 0;
    const service = new MagpieModelService(
      {
        status: () => ({
          state: 'running',
          version: 'test',
          gatewayUrl: 'http://127.0.0.1:1234',
        }),
        workKeyResolver: () => {
          const owner = generation;
          return () => (owner === generation ? TEST_MAGPIE_WORK_KEY : undefined);
        },
        models,
      },
      { readDefaultModelId: () => 'fixture/model', writeDefaultModelId: () => {} },
    );
    configureAdapter(service);
    expect(await service.checkReadiness()).toEqual({ hasConfig: true, config: null });
    await adapter.startSession('unified-ready', 'Hello');
    expect(mocks.createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({ id: 'fixture/model', provider: 'magpie' }),
      }),
    );
    mocks.session.subscribe.mock.lastCall![0]({ type: 'agent_settled' });
    const readsAfterStart = models.mock.calls.length;
    await adapter.continueSession('unified-ready', 'Follow-up');
    expect(models).toHaveBeenCalledTimes(readsAfterStart);
    mocks.session.subscribe.mock.lastCall![0]({ type: 'agent_settled' });
    generation++;
    await adapter.continueSession('unified-ready', 'After a gateway restart');
    expect(models).toHaveBeenCalledTimes(readsAfterStart + 1);
    expect(mocks.createAgentSession).toHaveBeenCalledOnce();
  });

  it.each([
    { mode: CoworkSessionMode.Chat, port: 4321 },
    { mode: CoworkSessionMode.Work, port: 4321 },
    { mode: CoworkSessionMode.Chat, port: 1234 },
  ])('refreshes a $mode model when Magpie restarts on port $port', async ({ mode, port }) => {
    let owner = new AbortController();
    let gatewayUrl = 'http://127.0.0.1:1234';
    const service = new MagpieModelService(
      {
        status: () => ({ state: 'running', version: 'test', gatewayUrl }),
        catalogOwner: () => owner.signal,
        workKeyResolver: () => {
          const signal = owner.signal;
          return () => (signal.aborted ? undefined : TEST_MAGPIE_WORK_KEY);
        },
        models: async () => [{ id: 'fixture/model' }],
      },
      { readDefaultModelId: () => 'fixture/model', writeDefaultModelId: () => {} },
    );
    configureAdapter(service);
    const workspaceRoot = process.cwd();
    await adapter.startSession('gateway-restart', 'First turn', {
      sessionMode: mode,
      workspaceRoot,
    });
    mocks.session.subscribe.mock.lastCall![0]({ type: 'agent_settled' });
    owner.abort();
    owner = new AbortController();
    gatewayUrl = `http://127.0.0.1:${port}`;

    await adapter.continueSession('gateway-restart', 'Second turn');
    expect(mocks.createAgentSession).toHaveBeenCalledTimes(2);
    expect(mocks.createAgentSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cwd: workspaceRoot,
        model: expect.objectContaining({ id: 'fixture/model', baseUrl: `${gatewayUrl}/v1` }),
      }),
    );
    expect(mocks.session.prompt).toHaveBeenLastCalledWith('Second turn');
  });

  it.each([
    {
      selection: 'default',
      runtime: undefined,
      trained: 65536,
      error: /effective context window/i,
    },
    { selection: 'bare alias', runtime: 16384, trained: 8192, error: /trained for only 8192/i },
    {
      selection: 'provider fallback',
      runtime: 16384,
      trained: 65536,
      error: /too small a context window \(16384\)/i,
    },
  ])(
    'rejects an ineligible local GPU model in Work selected by $selection but keeps Chat transport',
    async ({ selection, runtime, trained, error }) => {
      setLanguage('en');
      const local = buildLlamaCppRunningModelBinding({
        name: selection === 'bare alias' ? 'local-model' : 'local/model',
        runtime_context_length: runtime,
        trained_context_length: trained,
      })!;
      const canonicalId = `${LOCAL_GPU_MAGPIE_PROVIDER_ID}/${local.id}`;
      const catalogId = selection === 'bare alias' ? local.id : canonicalId;
      const localMetadata = { owned_by: LOCAL_GPU_MAGPIE_PROVIDER_ID, context_window: runtime };
      const fallback = {
        id: 'fallback-provider',
        name: 'Unavailable provider',
        api: 'openai-completions' as const,
        baseUrl: 'https://fixture.test/v1',
        models: ['unavailable-model'],
        fallback: [catalogId],
        off: false,
        hasKey: true,
      };
      const bindings = new ManagedMagpieProviderBindings(
        new ZhiyuanManagedProviderBridge(),
        { syncHostProviders: async () => {} },
        { readLocalModels: async () => ({ baseUrl: 'http://127.0.0.1:4321/v1', models: [local] }) },
      );
      configureAdapter(
        new MagpieModelService(
          {
            status: () => ({
              state: 'running',
              version: 'test',
              gatewayUrl: 'http://127.0.0.1:1234',
            }),
            models: async () =>
              projectMagpieCatalog({
                data: [
                  { id: canonicalId, ...localMetadata },
                  ...(catalogId === canonicalId ? [] : [{ id: catalogId, ...localMetadata }]),
                ],
              }),
            providers: async () => [fallback],
          },
          {
            readDefaultModelId: () => catalogId,
            writeDefaultModelId: () => {},
            beforeCatalog: () => bindings.beforeCatalog(),
            readLocalGpuEligibility: id => bindings.localGpuEligibility(id),
          },
        ),
      );
      const modelOverride = selection === 'provider fallback' ? fallback.models[0] : undefined;

      await expect(
        adapter.startSession('local-work', 'Hello', {
          sessionMode: CoworkSessionMode.Work,
          modelOverride,
        }),
      ).rejects.toThrow(error);
      expect(mocks.createAgentSession).not.toHaveBeenCalled();
      await adapter.startSession('local-chat', 'Hello', {
        sessionMode: CoworkSessionMode.Chat,
        modelOverride,
      });
      expect(mocks.createAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({
            id: catalogId,
            provider: 'magpie',
            baseUrl: 'http://127.0.0.1:1234/v1',
          }),
        }),
      );
    },
  );

  it.each([
    { selection: 'nested fallback', runtime: 16384, rejectWork: true },
    { selection: 'provider fallback', runtime: 16384, rejectWork: true },
    { selection: 'manual', runtime: 16384, rejectWork: false },
    { selection: 'disabled subgroup', runtime: 16384, rejectWork: false },
    { selection: 'switched-off member', runtime: 16384, rejectWork: false },
    { selection: 'local first', runtime: 32768, rejectWork: false },
    { selection: 'bare group ID', runtime: 16384, rejectWork: true },
    { selection: 'normalized group alias', runtime: 16384, rejectWork: true },
    { selection: 'missing routing metadata', runtime: 16384, rejectWork: true },
    { selection: 'truncated group', runtime: 16384, rejectWork: true },
    { selection: 'catalog-hidden member', runtime: 16384, rejectWork: true },
  ])(
    'checks the reachable local GPU members of a $selection route',
    async ({ selection, runtime, rejectWork }) => {
      setLanguage('en');
      const local = buildLlamaCppRunningModelBinding({
        name: 'gpu:7b',
        runtime_context_length: runtime,
      })!;
      const localRef = `${LOCAL_GPU_MAGPIE_PROVIDER_ID}/${local.id}`;
      const groupId = selection === 'normalized group alias' ? 'top-normalized' : 'top';
      const groupRef = `${MAGPIE_ROUTING_GROUP_PREFIX}${groupId}`;
      const nestedRef = `${MAGPIE_ROUTING_GROUP_PREFIX}nested`;
      const cloud = { id: 'cloud/model', owned_by: 'cloud', context_window: 65536 };
      const manual = selection === 'manual';
      const localFirst = selection === 'local first';
      const selectedId =
        selection === 'normalized group alias'
          ? 'top.normalized'
          : selection === 'bare group ID'
            ? groupId
            : groupRef;
      const cloudMembers =
        selection === 'truncated group'
          ? Array.from({ length: 200 }, (_, index) => `cloud/model-${index}`)
          : [cloud.id];
      const groups = [
        {
          id: groupId,
          name: 'Top',
          ready: true,
          ...(manual ? { routing: MagpieProviderRouting.Manual, picked: cloud.id } : {}),
          ...(selection === 'switched-off member' ? { off: [nestedRef] } : {}),
          members:
            localFirst || manual ? [nestedRef, ...cloudMembers] : [...cloudMembers, nestedRef],
          memberInfo: [
            ...cloudMembers.map(id => ({
              id,
              provider: cloud.owned_by,
              model: id.slice('cloud/'.length),
              ready: true,
            })),
            { id: nestedRef, group: true, ready: true },
          ],
        },
        {
          id: 'nested',
          name: 'Nested',
          ready: true,
          ...(selection === 'disabled subgroup' ? { disabled: true } : {}),
          members: [`${localRef}:high`],
          memberInfo: [
            {
              id: `${localRef}:high`,
              provider: LOCAL_GPU_MAGPIE_PROVIDER_ID,
              model: local.id,
              ready: true,
            },
          ],
        },
      ];
      const status = () => ({
        state: 'running' as const,
        version: 'test',
        gatewayUrl: 'http://127.0.0.1:1234',
      });
      const providers: MagpieProviderSummary[] = [
        {
          id: 'missing',
          name: 'Unavailable provider',
          api: 'openai-completions',
          baseUrl: 'https://fixture.test/v1',
          models: ['unavailable-model'],
          fallback: [groupRef],
          off: false,
          hasKey: true,
        },
      ];
      const routing = new MagpieRoutingUsageService({
        ensureRunning: async () => status(),
        managementRequest: async () =>
          selection === 'missing routing metadata'
            ? new Response(null, { status: 503 })
            : Response.json({ groups }),
      });
      configureAdapter(
        new MagpieModelService(
          {
            status,
            workKeyResolver: () => () => TEST_MAGPIE_WORK_KEY,
            models: async () =>
              projectMagpieCatalog({
                data: [
                  cloud,
                  ...(selection === 'catalog-hidden member'
                    ? []
                    : [
                        {
                          id: localRef,
                          owned_by: LOCAL_GPU_MAGPIE_PROVIDER_ID,
                          context_window: runtime,
                        },
                      ]),
                  {
                    id: groupRef,
                    owned_by: localFirst ? LOCAL_GPU_MAGPIE_PROVIDER_ID : cloud.owned_by,
                    context_window: runtime,
                  },
                  ...(selectedId === groupRef
                    ? []
                    : [{ id: selectedId, owned_by: cloud.owned_by, context_window: runtime }]),
                ],
              }),
            providers: async () => providers,
          },
          {
            readDefaultModelId: () => selectedId,
            writeDefaultModelId: () => {},
            readLocalGpuEligibility: id => (id === localRef ? local.agentEligibility : undefined),
          },
          routing,
        ),
      );

      const modelOverride = selection === 'provider fallback' ? providers[0].models[0] : undefined;
      const work = adapter.startSession('group-work', 'Hello', {
        sessionMode: CoworkSessionMode.Work,
        modelOverride,
      });
      if (rejectWork) {
        await expect(work).rejects.toThrow(/too small a context window \(16384\)/i);
        expect(mocks.createAgentSession).not.toHaveBeenCalled();
      } else {
        await work;
        expect(mocks.createAgentSession).toHaveBeenCalledOnce();
      }
      await adapter.startSession('group-chat', 'Hello', {
        sessionMode: CoworkSessionMode.Chat,
        modelOverride,
      });
      expect(mocks.createAgentSession).toHaveBeenLastCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({ id: selectedId, provider: 'magpie' }),
        }),
      );
    },
  );

  it.each([
    { alias: 'route-a', groupId: 'route-a', twins: true, workRoute: 'group/route-a' },
    {
      alias: 'dotted.route',
      groupId: 'dotted-route',
      twins: false,
      workRoute: 'group/dotted-route',
    },
    { alias: 'ambiguous.route', groupId: 'ambiguous-route', twins: true, workRoute: undefined },
  ])(
    'pins Work to the proven catalog route for $alias',
    async ({ alias, groupId, twins, workRoute }) => {
      const groupRef = `${MAGPIE_ROUTING_GROUP_PREFIX}${groupId}`;
      const cloudRef = 'cloud/model';
      const groupMetadata = { owned_by: 'cloud', context_window: 32768 };
      const status = () => ({
        state: 'running' as const,
        version: 'test',
        gatewayUrl: 'http://127.0.0.1:1234',
      });
      const managementRequest = vi.fn(async () =>
        Response.json({
          groups: [
            {
              id: groupId,
              name: 'Route alias',
              ready: true,
              members: [cloudRef],
              memberInfo: [{ id: cloudRef, provider: 'cloud', model: 'model', ready: true }],
            },
          ],
        }),
      );
      configureAdapter(
        new MagpieModelService(
          {
            status,
            workKeyResolver: () => () => TEST_MAGPIE_WORK_KEY,
            models: async () =>
              projectMagpieCatalog({
                data: [
                  { id: groupRef, ...groupMetadata },
                  ...(twins ? [{ id: 'group/other-route', ...groupMetadata }] : []),
                  { id: cloudRef, ...groupMetadata, native_endpoints: ['/v1/chat/completions'] },
                  { id: alias, ...groupMetadata },
                ],
              }),
          },
          { readDefaultModelId: () => alias, writeDefaultModelId: () => {} },
          new MagpieRoutingUsageService({ ensureRunning: async () => status(), managementRequest }),
        ),
      );

      const work = adapter.startSession('alias-work', 'Hello', {
        sessionMode: CoworkSessionMode.Work,
      });
      if (workRoute) {
        await work;
        expect(mocks.createAgentSession.mock.lastCall?.[0].model.id).toBe(workRoute);
      } else {
        await expect(work).rejects.toThrow('no longer available');
        expect(mocks.createAgentSession).not.toHaveBeenCalled();
      }
      await adapter.startSession('alias-chat', 'Hello', { sessionMode: CoworkSessionMode.Chat });
      expect(mocks.createAgentSession.mock.lastCall?.[0].model.id).toBe(alias);
    },
  );

  it.each([CoworkSessionMode.Work, CoworkSessionMode.Chat])(
    'rechecks the selected route of a live %s session only when required',
    async mode => {
      setLanguage('en');
      const local = buildLlamaCppRunningModelBinding({
        name: 'gpu',
        runtime_context_length: 16384,
      })!;
      const localRef = `${LOCAL_GPU_MAGPIE_PROVIDER_ID}/${local.id}`;
      const cloudRef = 'cloud/model';
      const groupId = 'dynamic';
      const groupRef = `${MAGPIE_ROUTING_GROUP_PREFIX}${groupId}`;
      let defaultModelId = groupRef;
      let includesLocal = false;
      const status = () => ({
        state: 'running' as const,
        version: 'test',
        gatewayUrl: 'http://127.0.0.1:1234',
      });
      const managementRequest = vi.fn(async () =>
        Response.json({
          groups: [
            {
              id: groupId,
              name: 'Dynamic',
              ready: true,
              members: includesLocal ? [cloudRef, localRef] : [cloudRef],
              memberInfo: [
                { id: cloudRef, provider: 'cloud', model: 'model', ready: true },
                ...(includesLocal
                  ? [
                      {
                        id: localRef,
                        provider: LOCAL_GPU_MAGPIE_PROVIDER_ID,
                        model: local.id,
                        ready: true,
                      },
                    ]
                  : []),
              ],
            },
          ],
        }),
      );
      configureAdapter(
        new MagpieModelService(
          {
            status,
            workKeyResolver: () => () => TEST_MAGPIE_WORK_KEY,
            models: async () => [
              { id: groupRef, owned_by: 'cloud', context_window: 32768 },
              { id: cloudRef, owned_by: 'cloud', context_window: 32768 },
              { id: localRef, owned_by: LOCAL_GPU_MAGPIE_PROVIDER_ID, context_window: 16384 },
            ],
          },
          {
            readDefaultModelId: () => defaultModelId,
            writeDefaultModelId: () => {},
            readLocalGpuEligibility: id => (id === localRef ? local.agentEligibility : undefined),
          },
          new MagpieRoutingUsageService({ ensureRunning: async () => status(), managementRequest }),
        ),
      );
      const onMessage = vi.fn();
      adapter.on('message', onMessage);
      await adapter.startSession('live-route', 'Initial turn', { sessionMode: mode });
      mocks.session.subscribe.mock.lastCall![0]({ type: 'agent_settled' });
      expect(adapter.isSessionRunning('live-route')).toBe(false);
      expect(mocks.session.prompt).toHaveBeenCalledOnce();
      expect(managementRequest).toHaveBeenCalledOnce();
      onMessage.mockClear();

      includesLocal = true;
      defaultModelId = cloudRef;
      if (mode === CoworkSessionMode.Work) {
        await expect(adapter.continueSession('live-route', 'Unsafe turn')).rejects.toThrow(
          /too small a context window/i,
        );
        expect(mocks.session.prompt).toHaveBeenCalledOnce();
        expect(onMessage).not.toHaveBeenCalled();
        expect(adapter.isSessionRunning('live-route')).toBe(false);
        includesLocal = false;
      }
      await adapter.continueSession('live-route', 'Next turn');
      expect(mocks.session.prompt).toHaveBeenCalledTimes(2);
      expect(mocks.createAgentSession).toHaveBeenCalledOnce();
      expect(managementRequest).toHaveBeenCalledTimes(mode === CoworkSessionMode.Work ? 3 : 1);

      if (mode === CoworkSessionMode.Work) {
        mocks.session.subscribe.mock.lastCall![0]({ type: 'agent_settled' });
        const requestStarted = Promise.withResolvers<void>();
        const response = Promise.withResolvers<Response>();
        managementRequest.mockImplementationOnce(() => {
          requestStarted.resolve();
          return response.promise;
        });
        const onSettled = vi.fn();
        const continuing = adapter.continueSession('live-route', 'Pending input', { onSettled });
        await requestStarted.promise;
        await expect(adapter.continueSession('live-route', 'Duplicate')).rejects.toThrow(
          /already active/,
        );
        await expect(
          adapter.enqueuePendingMessage('live-route', 'Queued input'),
        ).resolves.toMatchObject({
          success: false,
        });
        adapter.stopSession('live-route');
        response.resolve(new Response(null, { status: 503 }));
        await continuing;
        expect(onSettled).toHaveBeenCalledExactlyOnceWith({ ok: false, error: expect.any(String) });
        expect(mocks.session.prompt).toHaveBeenCalledTimes(2);
      }
    },
  );
});
