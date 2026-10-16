import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { projectMagpieCatalog } from './catalog';
import { MagpieManager } from './manager';
import { verifyMagpieBinary } from './integrity';
// Opt-in: build the pinned binary first. All agent configuration stays in a disposable HOME.
it.skipIf(process.env.ZHIYUAN_MAGPIE_SMOKE !== '1')(
  'discovers and updates a fixture CLI through unchanged upstream HTTP APIs, then stops',
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-magpie-integration-'));
    const config = path.join(root, '.codex', 'config.toml');
    await fs.mkdir(path.dirname(config));
    await fs.writeFile(config, 'model = "fixture-before"\n');
    await fs.writeFile(
      path.join(root, '.codex/models_cache.json'),
      JSON.stringify({
        models: [{ slug: 'fixture-after', display_name: 'Fixture model', visibility: 'list' }],
      }),
    );
    const manager = new MagpieManager({
      resourcesRoot: path.resolve(process.env.ZHIYUAN_MAGPIE_RESOURCES || 'resources/magpie'),
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
      expect((await manager.start()).state).toBe('running');
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
      expect((await manager.stop()).state).toBe('stopped');
    } finally {
      await manager.stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  },
  45_000,
);

it.skipIf(process.env.ZHIYUAN_MAGPIE_SMOKE !== '1')(
  'registers a running GPU fixture with upstream provider API, exposes metadata, and revokes its catalog',
  async () => {
    const { createServer } = await import('node:http');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-magpie-provider-'));
    const upstream = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/models')
        res.end(JSON.stringify({ data: [{ id: 'gpu-fixture', object: 'model' }] }));
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
      expect((await manager.start()).state).toBe('running');
      const binding = {
        id: 'zhiyuan-host-gpu',
        name: 'GPU fixture',
        api: 'openai-completions' as const,
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
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

it.skipIf(process.env.ZHIYUAN_MAGPIE_SMOKE !== '1')(
  'runs a native Durable submission through the real gateway to one loopback SSE generation',
  async () => {
    const { createServer } = await import('node:http');
    const { BACKGROUND_CONTEXT: context } = await import('@earendil-works/chord/context');
    const { createRegistry, Harness, MemoryStorage } = await import('@earendil-works/pi-durable');
    const { resolveDurableProvider } = await import('../libs/agentEngine/durable/provider');
    const { MagpieModelService, installMagpieModelService } = await import('./modelService');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-magpie-durable-'));
    const requests: Record<string, unknown>[] = [];
    const upstream = createServer(async (req, res) => {
      if (req.url === '/v1/models') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ data: [{ id: 'native-fixture', object: 'model' }] }));
        return;
      }
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
        res.writeHead(404).end();
        return;
      }
      let body = '';
      for await (const chunk of req) body += chunk.toString();
      requests.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
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
    const manager = new MagpieManager({
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
    let dispose: (() => void) | undefined;
    let harness: Awaited<ReturnType<typeof Harness.open>> | undefined;
    try {
      expect((await manager.start()).state).toBe('running');
      await manager.syncHostProviders([
        {
          id: 'zhiyuan-host-native',
          name: 'Native fixture',
          api: 'openai-completions',
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          models: [{ id: 'native-fixture', contextWindow: 32768, maxTokens: 4096 }],
        },
      ]);
      const modelId = 'zhiyuan-host-native/native-fixture';
      dispose = installMagpieModelService(
        new MagpieModelService(manager, {
          readDefaultModelId: () => modelId,
          writeDefaultModelId: () => {},
        }),
      );
      const provider = await resolveDurableProvider('native-gateway-fixture');
      expect(provider.model.modelId).toBe(modelId);
      harness = await Harness.open(
        new MemoryStorage(),
        {
          models: provider.models,
          registry: createRegistry(),
        },
        context,
      );
      const session = await harness.root(context, { agent: { model: provider.model } });
      const submission = await session.submit(
        {
          type: 'input',
          content: 'Say hello',
          requestId: 'native-gateway-once',
        },
        context,
      );
      expect((await submission.wait(context)).status).toBe('done');
      expect((await session.context(context)).messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'assistant',
            content: [{ type: 'text', text: 'Native gateway answer' }],
          }),
        ]),
      );
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({ model: 'native-fixture', stream: true });
      expect(
        (
          await session.submit(
            { type: 'input', content: 'Say hello', requestId: 'native-gateway-once' },
            context,
          )
        ).id,
      ).toBe(submission.id);
      expect(requests).toHaveLength(1);
    } finally {
      await harness?.close(context);
      dispose?.();
      await manager.stop();
      upstream.closeAllConnections();
      await new Promise<void>(resolve => upstream.close(() => resolve()));
      await fs.rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);
