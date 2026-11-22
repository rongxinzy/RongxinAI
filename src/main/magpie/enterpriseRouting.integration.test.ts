import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

import { ZhiyuanModelPoolHeader, ZhiyuanModelPoolWorkload } from '../../shared/modelPool/constants';
import { ZhiyuanManagedProviderBridge } from '../enterpriseExtension/managedProviderBridge';
import { projectMagpieCatalog } from './catalog';
import { verifyMagpieBinary } from './integrity';
import { MagpieManager } from './manager';
import {
  MAGPIE_RUNTIME_API_KEY,
  MAGPIE_ENTERPRISE_CHAT_WORKLOAD,
  MagpieWorkHeader,
} from './modelService';

it.skipIf(process.env.ZHIYUAN_MAGPIE_SMOKE !== '1')(
  'relays enterprise conversation headers only to owned loopback providers',
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-magpie-enterprise-route-'));
    const requests: Array<{ url: string; headers: IncomingHttpHeaders }> = [];
    const upstream = createServer((request, response) => {
      request.resume();
      response.setHeader('content-type', 'application/json');
      if (request.method === 'POST') requests.push({ url: request.url!, headers: request.headers });
      response.end(request.method === 'GET' ? '{"data":[]}' : '{}');
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const { port } = upstream.address() as { port: number };
    const loopback = `http://127.0.0.1:${port}`;
    const forwardKey = createHash('sha256').update('forward-fixture').digest('hex');
    const manager = new MagpieManager({
      enterpriseForward: () => ({ key: forwardKey, origin: loopback }),
      resourcesRoot: path.resolve(process.env.ZHIYUAN_MAGPIE_RESOURCES || 'resources/magpie'),
      privateHome: path.join(root, 'service'),
      environment: { HOME: root, USERPROFILE: root, PATH: path.join(root, 'empty-bin') },
      parseCatalog: async bytes =>
        projectMagpieCatalog(JSON.parse(new TextDecoder().decode(bytes))),
      verify: (dir, signal) =>
        verifyMagpieBinary(dir, signal, async file => {
          const hash = createHash('sha256');
          for await (const chunk of createReadStream(file)) hash.update(chunk);
          return hash.digest('hex');
        }),
    });
    const cases = [
      {
        id: 'zhiyuan-host-enterprise-openai-fixture',
        api: 'openai-completions',
        upstreamPath: '/openai/v1',
        route: '/v1/chat/completions',
        protocolKey: 'authorization',
        expectedPath: '/openai/v1/chat/completions',
        enterprise: true,
      },
      {
        id: 'zhiyuan-host-enterprise-anthropic-fixture',
        api: 'anthropic-messages',
        upstreamPath: '/anthropic',
        route: '/v1/messages',
        protocolKey: 'x-api-key',
        expectedPath: '/anthropic/v1/messages',
        enterprise: true,
      },
      {
        id: 'zhiyuan-host-unrelated-fixture',
        api: 'openai-completions',
        upstreamPath: '/other/v1',
        route: '/v1/chat/completions',
        protocolKey: 'authorization',
        expectedPath: '/other/v1/chat/completions',
        enterprise: false,
      },
    ] as const;
    try {
      const { state, gatewayUrl } = await manager.start();
      expect(state).toBe('running');
      await manager.syncHostProviders(
        cases.map(fixture => ({
          id: fixture.id,
          name: fixture.id,
          api: fixture.api,
          baseUrl: loopback + fixture.upstreamPath,
          apiKey: `local-${fixture.id}`,
          models: [{ id: 'fixture-model' }],
        })),
      );
      const workKey = manager.workKeyResolver(gatewayUrl!)!()!;
      for (const fixture of cases) {
        const model = `${fixture.id}/fixture-model`;
        for (const workload of [ZhiyuanModelPoolWorkload.Chat, ZhiyuanModelPoolWorkload.Work]) {
          const work = workload === ZhiyuanModelPoolWorkload.Work;
          const scoped = work || fixture.enterprise;
          const key = scoped ? workKey : MAGPIE_RUNTIME_API_KEY;
          const response = await fetch(gatewayUrl + fixture.route, {
            method: 'POST',
            headers: {
              [fixture.protocolKey]:
                fixture.protocolKey === 'authorization' ? `Bearer ${key}` : key,
              'content-type': 'application/json',
              'x-magpie-session': 'fixture-conversation',
              'x-session-affinity': 'fixture-affinity',
              'x-session-id': 'fixture-session',
              'x-client-request-id': 'fixture-request',
              session_id: 'fixture-openai-session',
              [ZhiyuanModelPoolHeader.ConversationId]: 'fixture-conversation',
              [ZhiyuanModelPoolHeader.Workload]: workload,
              'x-unrelated-private-header': 'never-relay-this',
              ...(scoped
                ? {
                    [MagpieWorkHeader.Workload]: work ? workload : MAGPIE_ENTERPRISE_CHAT_WORKLOAD,
                    [MagpieWorkHeader.Models]: JSON.stringify([model]),
                  }
                : {}),
            },
            body: JSON.stringify({
              model,
              max_tokens: 512,
              messages: [{ role: 'user', content: 'fixture' }],
            }),
            signal: AbortSignal.timeout(5_000),
          });
          expect(response.status, await response.text()).toBe(200);
          const request = requests.at(-1)!;
          expect(request.url).toBe(fixture.expectedPath);
          expect(request.headers['x-session-affinity']).toBe(
            fixture.enterprise ? 'fixture-affinity' : undefined,
          );
          expect(request.headers['x-session-id']).toBe(
            fixture.enterprise ? 'fixture-session' : undefined,
          );
          expect(request.headers['x-client-request-id']).toBe(
            fixture.enterprise ? 'fixture-request' : undefined,
          );
          expect(request.headers.session_id).toBe(
            fixture.enterprise ? 'fixture-openai-session' : undefined,
          );
          expect(request.headers[ZhiyuanModelPoolHeader.ConversationId]).toBe(
            fixture.enterprise ? 'fixture-conversation' : undefined,
          );
          expect(request.headers[ZhiyuanModelPoolHeader.Workload]).toBe(
            fixture.enterprise ? workload : undefined,
          );
          expect(request.headers[fixture.protocolKey]).toBe(
            fixture.protocolKey === 'authorization'
              ? `Bearer local-${fixture.id}`
              : `local-${fixture.id}`,
          );
          expect(request.headers['x-unrelated-private-header']).toBeUndefined();
          expect(request.headers['x-zhiyuan-enterprise-forward']).toBe(
            fixture.enterprise ? forwardKey : undefined,
          );
          expect(request.headers[MagpieWorkHeader.Workload.toLowerCase()]).toBeUndefined();
          expect(request.headers[MagpieWorkHeader.Models.toLowerCase()]).toBeUndefined();
          expect(Object.values(request.headers).join('\n')).not.toContain(key);
        }
      }
      for (const [key, proxied] of [
        [undefined, false],
        [MAGPIE_RUNTIME_API_KEY, false],
        [workKey, true],
      ] as const) {
        const denied = await fetch(gatewayUrl + cases[0].route, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(key ? { authorization: `Bearer ${key}` } : {}),
            ...(proxied
              ? {
                  'x-forwarded-for': '192.0.2.10',
                  [MagpieWorkHeader.Workload]: MAGPIE_ENTERPRISE_CHAT_WORKLOAD,
                  [MagpieWorkHeader.Models]: JSON.stringify([`${cases[0].id}/fixture-model`]),
                }
              : {}),
            'x-zhiyuan-enterprise-forward': forwardKey,
          },
          body: JSON.stringify({
            model: `${cases[0].id}/fixture-model`,
            messages: [{ role: 'user', content: 'fixture' }],
          }),
          signal: AbortSignal.timeout(5_000),
        });
        expect(denied.ok).toBe(false);
        await denied.body?.cancel();
      }
      expect(requests).toHaveLength(cases.length * 2);
    } finally {
      await manager.stop();
      upstream.closeAllConnections();
      await new Promise<void>(resolve => upstream.close(() => resolve()));
      await fs.rm(root, { recursive: true, force: true });
    }
  },
  30_000,
);

it.skipIf(process.env.ZHIYUAN_MAGPIE_SMOKE !== '1')(
  'registers multiple enterprise models from one source with the bundled gateway',
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-magpie-enterprise-'));
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
    const bridge = new ZhiyuanManagedProviderBridge();
    const dispose = bridge.registerSource({
      providerKey: 'custom_enterprise',
      exclusive: true,
      snapshot: async () => ({
        enabled: true,
        baseUrl: 'https://enterprise.invalid/v1',
        apiKey: 'enterprise-fixture-token',
        models: [
          { id: 'model-a', name: 'Model A' },
          { id: 'model-b', name: 'Model B' },
        ],
      }),
    });
    try {
      await bridge.refresh();
      const providers = bridge.hostProviders('http://127.0.0.1:43123');
      expect(providers).toHaveLength(2);
      const { state, gatewayUrl } = await manager.start();
      expect(state).toBe('running');
      await manager.syncHostProviders(providers);
      const response = await fetch(`${gatewayUrl}/v1/models`, {
        signal: AbortSignal.timeout(5_000),
      });
      expect(response.ok).toBe(true);
      expect(await response.json()).toMatchObject({
        data: expect.arrayContaining(
          providers.map(provider =>
            expect.objectContaining({ id: `${provider.id}/${provider.models[0].id}` }),
          ),
        ),
      });
    } finally {
      dispose();
      await manager.stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);
