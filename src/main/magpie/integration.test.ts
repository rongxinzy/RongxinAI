import { it, expect, vi } from 'vitest';
import { build } from 'esbuild';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { AISphere } from '../../shared/aisphere';
import { ApiFormat } from '../../shared/providers';
import { CompanionRequestState } from '../../shared/companion/constants';
import { DesktopPetBuiltinId } from '../../shared/desktopPet/catalog';
import { CoworkSessionMode } from '../../shared/cowork/constants';
import {
  MAGPIE_ROUTING_GROUP_PREFIX,
  MagpieProviderRouting,
} from '../../shared/magpie/routingUsage';
import { ZhiyuanModelPoolWorkload } from '../../shared/modelPool/constants';
import { CompanionChat } from '../companion/chat';
import { initializeCompanionSchema } from '../companion/schema';
import { ZhiyuanManagedProviderBridge } from '../enterpriseExtension/managedProviderBridge';
import { startEnterpriseModelGateway } from '../enterpriseExtension/modelGateway';
import { startAISphereGateway } from '../extensions/aisphere/gateway';
import { AISphereRequestPool } from '../extensions/aisphere/requestPool';
import { AISphereService } from '../extensions/aisphere/service';
import { PiRuntimeAdapter } from '../libs/agentEngine/piRuntimeAdapter';
import { projectMagpieCatalog } from './catalog';
import { RETIRED_OLLAMA_HOST_PROVIDER_ID } from './hostProviders';
import { MagpieManager } from './manager';
import { verifyMagpieBinary } from './integrity';
import { MAGPIE_RUNTIME_API_KEY, MagpieModelService, MagpieWorkHeader } from './modelService';

vi.mock('../libs/coworkUtil', async importOriginal => ({
  ...(await importOriginal<typeof import('../libs/coworkUtil')>()),
  applyApplicationRuntimeEnv: vi.fn(),
}));

// Opt-in: build the pinned binary first. All agent configuration stays in a disposable HOME.
it.skipIf(process.env.ZHIYUAN_MAGPIE_SMOKE !== '1')(
  'discovers and updates a fixture CLI through unchanged upstream HTTP APIs, then stops',
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-magpie-integration-'));
    const resourcesRoot = path.resolve(process.env.ZHIYUAN_MAGPIE_RESOURCES || 'resources/magpie');
    const config = path.join(root, '.codex', 'config.toml');
    await fs.mkdir(path.dirname(config));
    await fs.writeFile(config, 'model = "fixture-before"\n');
    await fs.writeFile(
      path.join(root, '.codex/models_cache.json'),
      JSON.stringify({
        models: [{ slug: 'fixture-after', display_name: 'Fixture model', visibility: 'list' }],
      }),
    );
    let windowsChild: ChildProcess | undefined;
    const spawnWindowsHelper = ((...args: Parameters<typeof spawn>) => {
      expect(args[0]).toBe(
        path.join(path.dirname(resourcesRoot), 'python-runtime', 'job-runner.exe'),
      );
      windowsChild = spawn(...args);
      return windowsChild;
    }) as typeof spawn;
    const manager = new MagpieManager({
      resourcesRoot,
      spawn: process.platform === 'win32' ? spawnWindowsHelper : undefined,
      parseCatalog: async bytes =>
        projectMagpieCatalog(JSON.parse(new TextDecoder().decode(bytes))),
      privateHome: path.join(root, 'service'),
      environment: {
        HOME: root,
        USERPROFILE: root,
        APPDATA: path.join(root, 'appdata'),
        LOCALAPPDATA: path.join(root, 'local'),
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: root,
        TMP: root,
      },
      // Vitest runs TS without the emitted worker JS; production uses the bounded worker.
      verify: (dir, signal) =>
        verifyMagpieBinary(dir, signal, async file => {
          const hash = createHash('sha256');
          for await (const chunk of createReadStream(file)) hash.update(chunk);
          return hash.digest('hex');
        }),
    });
    try {
      const started = await manager.start();
      expect(started).toMatchObject({ state: 'running', gatewayUrl: expect.any(String) });
      if (process.platform === 'win32') {
        expect(windowsChild).toMatchObject({
          pid: expect.any(Number),
          exitCode: null,
          signalCode: null,
        });
      }
      const field = (await manager.agents()).agents
        .find(a => a.id === 'codex')
        ?.models.find(f => f.key === 'model');
      expect(field?.value).toBe('fixture-before');
      const chosen = field?.options.find(
        option => option.value && option.value !== 'fixture-before',
      )?.value;
      expect(chosen).toBeTruthy();
      const result = await manager.setModel({ agentId: 'codex', field: 'model', value: chosen! });
      expect(
        result.agents.find(a => a.id === 'codex')?.models.find(f => f.key === 'model')?.value,
      ).toBe(chosen);
      expect(await fs.readFile(config, 'utf8')).toContain(`model = "${chosen}"`);
      expect(await manager.models()).toEqual([]);
      expect((await manager.shutdown()).state).toBe('stopped');
      if (windowsChild) {
        expect(windowsChild.exitCode ?? windowsChild.signalCode).not.toBeNull();
      }
      await expect
        .poll(
          async () => {
            try {
              await fetch(`${started.gatewayUrl}/api/hello`, { signal: AbortSignal.timeout(500) });
            } catch (error) {
              return (error as { cause?: NodeJS.ErrnoException }).cause?.code;
            }
          },
          { timeout: 5000 },
        )
        .toBe('ECONNREFUSED');
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  },
  45_000,
);

it.skipIf(process.env.ZHIYUAN_MAGPIE_SMOKE !== '1')(
  'preserves a running GPU binding and a custom provider when retiring the old Ollama binding on restart',
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-magpie-provider-'));
    const upstream = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/models')
        res.end(
          JSON.stringify({
            data: ['gpu-fixture', 'retired-fixture', 'custom-fixture'].map(id => ({
              id,
              object: 'model',
            })),
          }),
        );
      else {
        res.statusCode = 404;
        res.end('{}');
      }
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const address = upstream.address() as { port: number };
    const manager = new MagpieManager({
      resourcesRoot: path.resolve(process.env.ZHIYUAN_MAGPIE_RESOURCES || 'resources/magpie'),
      privateHome: path.join(root, 'service'),
      environment: { HOME: root, USERPROFILE: root, PATH: process.env.PATH, TEMP: root, TMP: root },
      parseCatalog: async bytes =>
        projectMagpieCatalog(JSON.parse(new TextDecoder().decode(bytes))),
      verify: (dir, signal) =>
        verifyMagpieBinary(dir, signal, async file => {
          const hash = createHash('sha256');
          for await (const chunk of createReadStream(file)) hash.update(chunk);
          return hash.digest('hex');
        }),
    });
    try {
      const started = await manager.start();
      expect(started.state).toBe('running');
      const binding = {
        id: 'zhiyuan-host-gpu',
        name: 'GPU fixture',
        api: 'openai-completions' as const,
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        // Native Magpie rejects adding the same endpoint and key twice.
        apiKey: 'gpu-fixture-key',
        models: [
          {
            id: 'gpu-fixture',
            contextWindow: 65536,
            maxTokens: 8192,
            input: ['text', 'image'] as ('text' | 'image')[],
          },
        ],
      };
      await manager.syncHostProviders([binding]);
      const [model] = await manager.models();
      expect(model).toMatchObject({
        id: 'zhiyuan-host-gpu/gpu-fixture',
        context_window: 65536,
        max_output_tokens: 8192,
        modalities: { input: expect.arrayContaining(['text', 'image']) },
        native_endpoints: expect.arrayContaining(['/v1/chat/completions']),
      });
      await manager.syncHostProviders([binding]);
      expect((await manager.models()).map(m => m.id)).toEqual(['zhiyuan-host-gpu/gpu-fixture']);
      await manager.syncHostProviders([]);
      expect(await manager.models()).toEqual([]);
      await manager.syncHostProviders([binding]);
      expect((await manager.models()).map(m => m.id)).toEqual(['zhiyuan-host-gpu/gpu-fixture']);

      const retiredModel = `${RETIRED_OLLAMA_HOST_PROVIDER_ID}/retired-fixture`;
      const customProvider = 'custom-loopback-fixture';
      const customModel = `${customProvider}/custom-fixture`;
      await manager.syncHostProviders([
        binding,
        {
          id: RETIRED_OLLAMA_HOST_PROVIDER_ID,
          name: 'Old Ollama fixture',
          api: binding.api,
          baseUrl: binding.baseUrl,
          models: [{ id: 'retired-fixture' }],
        },
      ]);
      const customInput = {
        name: 'External loopback fixture',
        api: binding.api,
        baseUrl: binding.baseUrl,
        models: ['custom-fixture'],
      };
      expect(await manager.testProvider(customInput)).toMatchObject({
        ok: true,
        discoveredModels: expect.arrayContaining(['custom-fixture']),
      });
      await manager.saveProvider({ ...customInput, id: customProvider });

      const rawModels = async (gatewayUrl: string): Promise<string[]> => {
        const response = await fetch(`${gatewayUrl}/v1/models`, {
          signal: AbortSignal.timeout(5_000),
        });
        expect(response.ok).toBe(true);
        const { data } = (await response.json()) as { data: { id: string }[] };
        return data.map(model => model.id);
      };
      const retainedModels = ['zhiyuan-host-gpu/gpu-fixture', customModel];
      expect(await rawModels(started.gatewayUrl!)).toEqual(
        expect.arrayContaining([...retainedModels, retiredModel]),
      );
      expect((await manager.stop()).state).toBe('stopped');
      const restarted = await manager.start();
      expect(restarted.state).toBe('running');
      const firstModels = await rawModels(restarted.gatewayUrl!);
      expect(firstModels).toEqual(expect.arrayContaining(retainedModels));
      expect(firstModels).not.toContain(retiredModel);
      await expect(
        manager.updatePreferences({ disabledModels: [customModel] }),
      ).resolves.toMatchObject({
        disabledModels: [customModel],
      });
      expect(await rawModels(restarted.gatewayUrl!)).not.toContain(customModel);
      await expect(manager.updatePreferences({ disabledModels: [] })).resolves.toMatchObject({
        disabledModels: [],
      });
      expect(await rawModels(restarted.gatewayUrl!)).toEqual(
        expect.arrayContaining(retainedModels),
      );
      const providerState = await manager.managementRequest('/api/providers');
      expect(providerState.ok).toBe(true);
      expect(await providerState.json()).toMatchObject({
        providers: expect.arrayContaining([
          expect.objectContaining({ id: RETIRED_OLLAMA_HOST_PROVIDER_ID, off: true }),
          expect.objectContaining({ id: customProvider, off: false }),
        ]),
      });
    } finally {
      await manager.stop();
      await new Promise<void>(resolve => upstream.close(() => resolve()));
      await fs.rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);

it.skipIf(process.env.ZHIYUAN_MAGPIE_SMOKE !== '1')(
  'keeps subscriptions off until explicit opt-in, uses the official privacy API, and disables without deleting account files',
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-magpie-subscriptions-'));
    const accountFile = path.join(root, '.codex', 'auth.json');
    await fs.mkdir(path.dirname(accountFile));
    // Intentionally not a credential or valid account; no remote login is performed.
    await fs.writeFile(accountFile, 'invalid-test-fixture-not-a-credential');
    let enabled = false;
    let stopDuringPreferenceWrite = false;
    const manager = new MagpieManager({
      resourcesRoot: path.resolve(process.env.ZHIYUAN_MAGPIE_RESOURCES || 'resources/magpie'),
      privateHome: path.join(root, 'service'),
      // No real user directories, executable discovery or desktop credential helpers.
      environment: {
        HOME: root,
        USERPROFILE: root,
        PATH: path.join(root, 'empty-bin'),
        TEMP: root,
        TMP: root,
      },
      subscriptionAccounts: {
        read: () => enabled,
        write: async value => {
          enabled = value;
          if (stopDuringPreferenceWrite) await manager.stop();
        },
      },
      parseCatalog: async bytes =>
        projectMagpieCatalog(JSON.parse(new TextDecoder().decode(bytes))),
      verify: (dir, signal) =>
        verifyMagpieBinary(dir, signal, async file => {
          const hash = createHash('sha256');
          for await (const chunk of createReadStream(file)) hash.update(chunk);
          return hash.digest('hex');
        }),
    });
    const settings = async () => {
      const connection = manager.managementConnection();
      const response = await fetch(`${connection.url}/api/settings`, {
        headers: { Cookie: `${connection.cookieName}=${connection.key}` },
      });
      return response.json() as Promise<{ noAccountDiscovery: boolean; noAccountsEnv: boolean }>;
    };
    try {
      expect((await manager.start()).subscriptionAccountsEnabled).toBe(false);
      expect((await settings()).noAccountDiscovery).toBe(true);
      await expect(manager.signInStatus('fake-flow')).rejects.toThrow('unavailable');
      expect((await manager.setSubscriptionAccounts(true)).state).toBe('running');
      expect(enabled).toBe(true);
      const enabledState = await settings();
      expect(enabledState.noAccountDiscovery).not.toBe(true);
      expect(enabledState.noAccountsEnv).not.toBe(true);
      expect((await manager.setSubscriptionAccounts(false)).subscriptionAccountsEnabled).toBe(
        false,
      );
      expect((await settings()).noAccountDiscovery).toBe(true);
      expect(await fs.readFile(accountFile, 'utf8')).toBe('invalid-test-fixture-not-a-credential');
      stopDuringPreferenceWrite = true;
      expect((await manager.setSubscriptionAccounts(true)).state).toBe('stopped');
      expect(manager.status().state).toBe('stopped');
    } finally {
      await manager.stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);

it
  .skipIf(process.env.ZHIYUAN_MAGPIE_SMOKE !== '1')
  .each(['local', 'organization', 'enterprise', 'enterprise-anthropic'])(
  'runs companion Pi turns through the real %s gateway and restores native history',
  async provider => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-magpie-companion-'));
    const anthropic = provider === 'enterprise-anthropic';
    const isEnterprise = provider === 'enterprise' || anthropic;
    const requests: Record<string, unknown>[] = [];
    const headers: IncomingHttpHeaders[] = [];
    const organizationKey = 'organization-fixture-key';
    const upstream = createServer(async (req, res) => {
      if (req.url === '/v1/models') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ data: [{ id: 'native-fixture', object: 'model' }] }));
        return;
      }
      const upstreamPath = anthropic ? '/per-model/v1/messages' : '/v1/chat/completions';
      if (req.method !== 'POST' || req.url !== upstreamPath) {
        res.writeHead(404).end();
        return;
      }
      if (
        provider !== 'local' &&
        (anthropic ? req.headers['x-api-key'] : req.headers.authorization) !==
          (anthropic ? organizationKey : `Bearer ${organizationKey}`)
      ) {
        res.writeHead(401).end();
        return;
      }
      let body = '';
      for await (const chunk of req) body += chunk.toString();
      requests.push(JSON.parse(body));
      headers.push(req.headers);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (anthropic) {
        for (const event of [
          {
            type: 'message_start',
            message: {
              id: 'fixture-message',
              type: 'message',
              role: 'assistant',
              model: 'native-fixture',
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 1, output_tokens: 0 },
            },
          },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'Native gateway answer' },
          },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: 1 },
          },
          { type: 'message_stop' },
        ]) {
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        }
        res.end();
        return;
      }
      const event = (delta: object, finish_reason: string | null) => {
        res.write(
          `data: ${JSON.stringify({
            id: 'fixture-completion',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'native-fixture',
            choices: [{ index: 0, delta, finish_reason }],
          })}\n\n`,
        );
      };
      event({ role: 'assistant', content: 'Native gateway answer' }, null);
      event({}, 'stop');
      res.end('data: [DONE]\n\n');
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const address = upstream.address() as { port: number };
    const enterprise = isEnterprise ? new ZhiyuanManagedProviderBridge() : undefined;
    let enterpriseGateway: Awaited<ReturnType<typeof startEnterpriseModelGateway>> | undefined;
    let logout: (() => void) | undefined;
    const manager = new MagpieManager({
      enterpriseForward: () => enterpriseGateway,
      resourcesRoot: path.resolve(process.env.ZHIYUAN_MAGPIE_RESOURCES || 'resources/magpie'),
      privateHome: path.join(root, 'service'),
      environment: {
        HOME: root,
        USERPROFILE: root,
        PATH: path.join(root, 'empty-bin'),
        TEMP: root,
        TMP: root,
      },
      parseCatalog: async bytes =>
        projectMagpieCatalog(JSON.parse(new TextDecoder().decode(bytes))),
      verify: (dir, signal) =>
        verifyMagpieBinary(dir, signal, async file => {
          const hash = createHash('sha256');
          for await (const chunk of createReadStream(file)) hash.update(chunk);
          return hash.digest('hex');
        }),
    });
    let organization: AISphereService | undefined;
    const db = new Database(':memory:');
    initializeCompanionSchema(db);
    let runtime: PiRuntimeAdapter | undefined;
    try {
      const baseUrl = `http://127.0.0.1:${address.port}/v1`;
      if (enterprise) {
        logout = enterprise.registerSource({
          providerKey: 'custom_enterprise',
          exclusive: true,
          snapshot: async () => ({
            enabled: true,
            baseUrl: anthropic ? baseUrl.replace(/\/v1$/, '/per-model') : baseUrl,
            apiFormat: anthropic ? ApiFormat.Anthropic : ApiFormat.OpenAI,
            apiKey: organizationKey,
            models: [
              {
                id: 'native-fixture',
                name: 'Native Enterprise',
                contextWindow: 32768,
                maxTokens: 4096,
              },
            ],
          }),
        });
        await enterprise.refresh();
        enterpriseGateway = await startEnterpriseModelGateway(enterprise);
      }
      expect((await manager.start()).state).toBe('running');
      organization =
        provider === 'organization'
          ? new AISphereService(async url =>
              Response.json(
                url.endsWith(AISphere.VerifyPath)
                  ? { data: 'ok' }
                  : {
                      code: 0,
                      model_list: [
                        {
                          name: 'native-fixture',
                          url: `${baseUrl}/chat/completions`,
                          api_key: organizationKey,
                          context_length: 32768,
                          max_output: 4096,
                        },
                      ],
                    },
              ),
            )
          : undefined;
      if (organization) {
        const workerFile = path.join(root, 'aisphereWorker.cjs');
        await build({
          entryPoints: [path.resolve('src/main/extensions/aisphere/requestWorker.ts')],
          outfile: workerFile,
          bundle: true,
          platform: 'node',
          format: 'cjs',
        });
        await organization.initialize({ get: () => undefined, set: () => {} }, () =>
          startAISphereGateway(organization, undefined, new AISphereRequestPool(workerFile)),
        );
        await organization.connect('http://organization.test');
      }
      const binding = enterprise?.hostProviders(enterpriseGateway?.origin)[0] ??
        organization?.hostProvider() ?? {
          id: 'zhiyuan-host-native',
          name: 'Native fixture',
          api: 'openai-completions' as const,
          baseUrl,
          models: [{ id: 'native-fixture', contextWindow: 32768, maxTokens: 4096 }],
        };
      await manager.syncHostProviders([binding]);
      const modelId = `${binding.id}/native-fixture`;
      const modelService = new MagpieModelService(
        manager,
        {
          readDefaultModelId: () => modelId,
          writeDefaultModelId: () => {},
          allowedModel: model =>
            enterprise?.allowedModel(model.canonical_id ?? model.id) ??
            organization?.allowedModel(model.id, model.owned_by) ??
            true,
        },
        manager.routingUsage,
      );
      runtime = new PiRuntimeAdapter({ modelService, piSessionStoreRoot: root });
      const chat = new CompanionChat(db, modelService, runtime);
      const profile = {
        petId: randomUUID(),
        personaId: DesktopPetBuiltinId.Xiaoyuan,
        characterId: DesktopPetBuiltinId.Xiaoyuan,
        createdAt: Date.now(),
      };
      const { availability, receipt } = await chat.submit(
        profile,
        'native-gateway-once',
        'Say hello',
      );
      expect(availability.modelId).toBe(modelId);
      expect(receipt).not.toBeNull();
      await expect
        .poll(() => chat.history(profile), { timeout: 15_000 })
        .toMatchObject({
          lastReply: { ...receipt, state: CompanionRequestState.Answered },
          messages: [
            { role: 'user', text: 'Say hello' },
            { role: 'assistant', text: 'Native gateway answer' },
          ],
        });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({ model: 'native-fixture', stream: true });
      expect(requests[0].tools ?? []).toEqual([]);
      expect(JSON.stringify(requests[0])).toContain('You are Xiaoyuan');
      expect((await chat.submit(profile, 'native-gateway-once', 'Say hello')).receipt).toEqual(
        receipt,
      );
      expect(requests).toHaveLength(1);

      runtime.stopAllSessions();
      runtime = new PiRuntimeAdapter({ modelService, piSessionStoreRoot: root });
      const reopened = new CompanionChat(db, modelService, runtime);
      expect(reopened.history(profile).messages.at(-1)?.text).toBe('Native gateway answer');
      const next = (await reopened.submit(profile, 'after-restart', 'Continue')).receipt!;
      await expect
        .poll(() => reopened.history(profile).lastReply, { timeout: 15_000 })
        .toEqual({ ...next, state: CompanionRequestState.Answered });
      expect(requests).toHaveLength(2);
      expect(JSON.stringify(requests[1].messages)).toContain('Native gateway answer');

      if (provider !== 'organization') {
        const gatewayUrl = manager.status().gatewayUrl!;
        const workKey = manager.workKeyResolver(gatewayUrl)!()!;
        const groupId = 'native-work-fixture';
        await manager.routingUsage.saveRoutingGroup({
          id: groupId,
          name: 'Native Work fixture',
          members: [modelId],
          routing: MagpieProviderRouting.Ordered,
        });
        const errors: unknown[] = [];
        runtime.on('error', (_sessionId, error) => errors.push(error));
        for (const [index, route] of [
          modelId,
          `${MAGPIE_ROUTING_GROUP_PREFIX}${groupId}`,
        ].entries()) {
          await runtime.startSession(`native-scoped-work-${index}`, 'Say hello in Work', {
            workspaceRoot: root,
            modelOverride: route,
            sessionMode: CoworkSessionMode.Work,
          });
        }
        expect(errors).toEqual([]);
        expect(requests).toHaveLength(4);
        for (const index of [2, 3]) {
          expect(requests[index]).toMatchObject({ model: 'native-fixture', stream: true });
          expect(Object.values(headers[index]).join('\n')).not.toContain(workKey);
          expect(headers[index][MagpieWorkHeader.Models.toLowerCase()]).toBeUndefined();
        }

        for (const [key, workload, models, expected] of [
          [MAGPIE_RUNTIME_API_KEY, ZhiyuanModelPoolWorkload.Work, [modelId], 401],
          [workKey, undefined, [modelId], 401],
          [workKey, ZhiyuanModelPoolWorkload.Work, ['different/model'], 403],
        ] as const) {
          const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${key}`,
              ...(workload ? { [MagpieWorkHeader.Workload]: workload } : {}),
              [MagpieWorkHeader.Models]: JSON.stringify(models),
            },
            body: JSON.stringify({
              model: modelId,
              messages: [{ role: 'user', content: 'Hello' }],
            }),
          });
          await response.body?.cancel();
          expect(response.status).toBe(expected);
        }
        expect(requests).toHaveLength(4);
      }
      if (enterpriseGateway) {
        expect(headers.map(header => header['x-zhiyuan-workload'])).toEqual([
          'chat',
          'chat',
          'work',
          'work',
        ]);
        expect(headers.every(header => Boolean(header['x-zhiyuan-conversation-id']))).toBe(true);
        expect(headers.every(header => header['x-zhiyuan-enterprise-forward'] === undefined)).toBe(
          true,
        );
        const payload = JSON.stringify({
          model: 'native-fixture',
          messages: [{ role: 'user', content: 'Hello' }],
        });
        const hostEndpoint = binding.baseUrl + (anthropic ? '/v1/messages' : '/chat/completions');
        const denied = await fetch(hostEndpoint, {
          method: 'POST',
          headers: { authorization: `Bearer ${binding.apiKey}` },
          body: payload,
        });
        expect(denied.status).toBe(403);
        await denied.body?.cancel();
        logout?.();
        const revoked = await fetch(hostEndpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${binding.apiKey}`,
            'x-zhiyuan-enterprise-forward': enterpriseGateway.key,
          },
          body: payload,
        });
        expect(revoked.status).toBe(403);
        await revoked.body?.cancel();
        expect(requests).toHaveLength(4);
      }
    } finally {
      runtime?.stopAllSessions();
      db.close();
      await manager.stop();
      await organization?.shutdown();
      logout?.();
      await enterpriseGateway?.close();
      upstream.closeAllConnections();
      await new Promise<void>(resolve => upstream.close(() => resolve()));
      await fs.rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);

it.skipIf(process.env.ZHIYUAN_MAGPIE_SMOKE !== '1')(
  'keeps a stored provider key when the editor saves with a blank key field',
  async () => {
    const { createServer } = await import('node:http');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-magpie-provider-key-'));
    const dummyKey = 'sk-zhiyuan-fixture-00000001';
    const upstream = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/models') {
        res.end(JSON.stringify({ data: [{ id: 'fixture-key-model', object: 'model' }] }));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const address = upstream.address() as { port: number };
    const manager = new MagpieManager({
      resourcesRoot: path.resolve(process.env.ZHIYUAN_MAGPIE_RESOURCES || 'resources/magpie'),
      privateHome: path.join(root, 'service'),
      environment: { HOME: root, USERPROFILE: root, PATH: process.env.PATH, TEMP: root, TMP: root },
      parseCatalog: async bytes =>
        projectMagpieCatalog(JSON.parse(new TextDecoder().decode(bytes))),
      verify: (dir, signal) =>
        verifyMagpieBinary(dir, signal, async file => {
          const hash = createHash('sha256');
          for await (const chunk of createReadStream(file)) hash.update(chunk);
          return hash.digest('hex');
        }),
    });
    try {
      expect((await manager.start()).state).toBe('running');
      const created = await manager.saveProvider({
        name: 'Key retention fixture',
        api: 'openai-completions',
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        key: dummyKey,
        models: ['fixture-key-model'],
      });
      const provider = created.find(p => p.name === 'Key retention fixture');
      expect(provider?.hasKey).toBe(true);
      expect(provider?.keyMasked).toBeTruthy();
      const maskedBefore = provider!.keyMasked!;

      const renamed = await manager.saveProvider({
        id: provider!.id,
        name: 'Key retention fixture renamed',
        api: 'openai-completions',
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        models: provider!.models,
      });
      const after = renamed.find(p => p.id === provider!.id);
      expect(after).toMatchObject({
        hasKey: true,
        keyMasked: maskedBefore,
        models: ['fixture-key-model'],
      });
    } finally {
      await manager.stop();
      await new Promise<void>(resolve => upstream.close(() => resolve()));
      await fs.rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);

it.skipIf(process.env.ZHIYUAN_MAGPIE_SMOKE !== '1')(
  'reports legacy none placeholder keys as keyless after provider/key lookup',
  async () => {
    const { createServer } = await import('node:http');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-magpie-provider-legacy-none-'));
    const upstream = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/models') {
        res.end(JSON.stringify({ data: [{ id: 'fixture-none-model', object: 'model' }] }));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const address = upstream.address() as { port: number };
    const manager = new MagpieManager({
      resourcesRoot: path.resolve(process.env.ZHIYUAN_MAGPIE_RESOURCES || 'resources/magpie'),
      privateHome: path.join(root, 'service'),
      environment: { HOME: root, USERPROFILE: root, PATH: process.env.PATH, TEMP: root, TMP: root },
      parseCatalog: async bytes =>
        projectMagpieCatalog(JSON.parse(new TextDecoder().decode(bytes))),
      verify: (dir, signal) =>
        verifyMagpieBinary(dir, signal, async file => {
          const hash = createHash('sha256');
          for await (const chunk of createReadStream(file)) hash.update(chunk);
          return hash.digest('hex');
        }),
    });
    try {
      expect((await manager.start()).state).toBe('running');
      const connection = manager.managementConnection();
      const saveResponse = await fetch(`${connection.url}/api/provider/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${connection.cookieName}=${connection.key}`,
        },
        body: JSON.stringify({
          id: 'legacy-none-fixture',
          from: 'legacy-none-fixture',
          name: 'Legacy none fixture',
          chat: `http://127.0.0.1:${address.port}/v1`,
          responses: '',
          anthropic: '',
          key: 'none',
          models: ['fixture-none-model'],
          noModels: false,
          fallback: [],
          proxy: 'direct',
          unredacted: true,
          off: false,
          headers: {},
          extraBody: {},
          new: true,
        }),
      });
      expect(saveResponse.ok).toBe(true);
      const provider = (await manager.providers()).find(p => p.id === 'legacy-none-fixture');
      expect(provider?.hasKey).toBe(false);
      expect(provider?.keyMasked).toBeUndefined();
    } finally {
      await manager.stop();
      await new Promise<void>(resolve => upstream.close(() => resolve()));
      await fs.rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);

it.skipIf(process.env.ZHIYUAN_MAGPIE_SMOKE !== '1')(
  'testProvider uses the stored key when the key field is blank',
  async () => {
    const { createServer } = await import('node:http');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-magpie-provider-testconn-'));
    const dummyKey = 'sk-zhiyuan-fixture-testconn01';
    let sawStoredKey = false;
    const upstream = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/models') {
        if (req.headers.authorization === `Bearer ${dummyKey}`) sawStoredKey = true;
        res.end(JSON.stringify({ data: [{ id: 'fixture-key-model', object: 'model' }] }));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const address = upstream.address() as { port: number };
    const manager = new MagpieManager({
      resourcesRoot: path.resolve(process.env.ZHIYUAN_MAGPIE_RESOURCES || 'resources/magpie'),
      privateHome: path.join(root, 'service'),
      environment: { HOME: root, USERPROFILE: root, PATH: process.env.PATH, TEMP: root, TMP: root },
      parseCatalog: async bytes =>
        projectMagpieCatalog(JSON.parse(new TextDecoder().decode(bytes))),
      verify: (dir, signal) =>
        verifyMagpieBinary(dir, signal, async file => {
          const hash = createHash('sha256');
          for await (const chunk of createReadStream(file)) hash.update(chunk);
          return hash.digest('hex');
        }),
    });
    try {
      expect((await manager.start()).state).toBe('running');
      const created = await manager.saveProvider({
        name: 'Test connection fixture',
        api: 'openai-completions',
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        key: dummyKey,
        models: ['fixture-key-model'],
      });
      const provider = created.find(p => p.name === 'Test connection fixture');
      expect(provider?.hasKey).toBe(true);
      const result = await manager.testProvider({
        id: provider!.id,
        name: provider!.name,
        api: 'openai-completions',
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        models: provider!.models,
      });
      expect(result.ok).toBe(true);
      expect(sawStoredKey).toBe(true);
    } finally {
      await manager.stop();
      await new Promise<void>(resolve => upstream.close(() => resolve()));
      await fs.rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);

it.skipIf(process.env.ZHIYUAN_MAGPIE_SMOKE !== '1')(
  'does not promote the full vendor catalog into picks when editing a provider',
  async () => {
    const { createServer } = await import('node:http');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-magpie-provider-models-'));
    const catalog = ['fixture/a', 'fixture/b', 'fixture/c', 'fixture/d', 'fixture/e'];
    const upstream = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/models') {
        res.end(
          JSON.stringify({
            data: catalog.map(id => ({ id, object: 'model' })),
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const address = upstream.address() as { port: number };
    const manager = new MagpieManager({
      resourcesRoot: path.resolve(process.env.ZHIYUAN_MAGPIE_RESOURCES || 'resources/magpie'),
      privateHome: path.join(root, 'service'),
      environment: { HOME: root, USERPROFILE: root, PATH: process.env.PATH, TEMP: root, TMP: root },
      parseCatalog: async bytes =>
        projectMagpieCatalog(JSON.parse(new TextDecoder().decode(bytes))),
      verify: (dir, signal) =>
        verifyMagpieBinary(dir, signal, async file => {
          const hash = createHash('sha256');
          for await (const chunk of createReadStream(file)) hash.update(chunk);
          return hash.digest('hex');
        }),
    });
    const readExposed = async (id: string) => {
      const connection = manager.managementConnection();
      const response = await fetch(`${connection.url}/api/providers`, {
        headers: { Cookie: `${connection.cookieName}=${connection.key}` },
      });
      const body = (await response.json()) as {
        providers?: Array<{ id: string; exposed?: number }>;
      };
      const row = body.providers?.find(p => p.id === id);
      if (!row) throw new Error(`provider ${id} missing from upstream state`);
      return row.exposed ?? 0;
    };
    try {
      expect((await manager.start()).state).toBe('running');
      const created = await manager.saveProvider({
        name: 'Exposure fixture',
        api: 'openai-completions',
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        models: ['fixture/a', 'fixture/b'],
      });
      const provider = created.find(p => p.name === 'Exposure fixture');
      expect(provider?.models).toEqual(['fixture/a', 'fixture/b']);
      expect(await readExposed(provider!.id)).toBe(2);

      const edited = await manager.saveProvider({
        id: provider!.id,
        name: 'Exposure fixture renamed',
        api: 'openai-completions',
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        models: provider!.models,
      });
      expect(edited.find(p => p.id === provider!.id)?.models).toEqual(['fixture/a', 'fixture/b']);
      expect(await readExposed(provider!.id)).toBe(2);
    } finally {
      await manager.stop();
      await new Promise<void>(resolve => upstream.close(() => resolve()));
      await fs.rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);
