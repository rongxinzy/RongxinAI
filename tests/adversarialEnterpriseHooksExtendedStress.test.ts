import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startEnterpriseModelGateway } from '../src/main/enterpriseExtension/modelGateway';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { Model } from '@earendil-works/pi-ai';
import { describe, expect, it, vi } from 'vitest';
import { zhiyuanManagedProviderBridge } from '../src/main/enterpriseExtension/managedProviderBridge';
import { resolvePiModel } from '../src/main/libs/agentEngine/piMagpiePiModel';
import { getPiModules } from '../src/main/libs/agentEngine/piRuntimeSessionState';
import {
  MAGPIE_RUNTIME_API_KEY,
  MAGPIE_ENTERPRISE_CHAT_WORKLOAD,
  MagpieWorkHeader,
  MagpieModelService,
} from '../src/main/magpie/modelService';
import {
  ZhiyuanModelPoolHeader,
  ZhiyuanModelPoolWorkload,
} from '../src/shared/modelPool/constants';
import { ApiFormat } from '../src/shared/providers';

describe('Enterprise native provider wire contract', () => {
  it.each([ApiFormat.OpenAI, ApiFormat.Anthropic])(
    'keeps %s instructions and token rotation through the enterprise transport',
    async apiFormat => {
      const openai = apiFormat === ApiFormat.OpenAI;
      const calls: Array<{
        path?: string;
        bearer?: string;
        apiKey?: string | string[];
        conversation?: string | string[];
      }> = [];
      const instructionRoles: string[] = [];
      const instructions = 'Enterprise provider system instructions';
      const instructionBodies: string[] = [];
      const upstream = createServer(async (request, response) => {
        calls.push({
          path: request.url,
          bearer: request.headers.authorization,
          apiKey: request.headers['x-api-key'],
          conversation: request.headers[ZhiyuanModelPoolHeader.ConversationId],
        });
        let body = '';
        for await (const chunk of request) body += chunk.toString();
        const payload = JSON.parse(body) as { messages: { role: string }[]; system?: unknown };
        instructionRoles.push(payload.messages[0].role);
        instructionBodies.push(JSON.stringify(payload.system ?? payload.messages[0]));
        response.writeHead([401, 403][calls.length - 1] ?? 400, {
          'Content-Type': 'application/json',
        });
        response.end(JSON.stringify({ error: { message: 'auth wire fixture' } }));
      });
      const scopedKey = 'scoped-fixture-key';
      const router = createServer(async (request, response) => {
        const upstreamAddress = upstream.address() as { port: number };
        let endpoint = `http://127.0.0.1:${upstreamAddress.port}${request.url}`;
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (
          request.headers[MagpieWorkHeader.Workload.toLowerCase()] ===
          MAGPIE_ENTERPRISE_CHAT_WORKLOAD
        ) {
          const callerKey =
            request.headers.authorization?.replace(/^Bearer /, '') ?? request.headers['x-api-key'];
          if (callerKey !== scopedKey || !transport) {
            response.writeHead(401).end();
            return;
          }
          const [provider] = zhiyuanManagedProviderBridge.hostProviders(transport.origin);
          const scope = JSON.parse(String(request.headers[MagpieWorkHeader.Models.toLowerCase()]));
          expect(scope).toEqual([`${provider.id}/shared`]);
          endpoint = `${provider.baseUrl}${openai ? '/chat/completions' : '/v1/messages'}`;
          headers.authorization = `Bearer ${provider.apiKey}`;
          headers['x-zhiyuan-enterprise-forward'] = transport.key;
          headers[ZhiyuanModelPoolHeader.ConversationId] = String(
            request.headers[ZhiyuanModelPoolHeader.ConversationId],
          );
        } else {
          headers.authorization = request.headers.authorization ?? '';
        }
        let body = '';
        for await (const chunk of request) body += chunk.toString();
        const result = await fetch(endpoint, { method: 'POST', headers, body });
        response.writeHead(result.status, { 'content-type': 'application/json' });
        response.end(await result.text());
      });
      const root = await mkdtemp(join(tmpdir(), 'enterprise-native-auth-'));
      let unbind: (() => void) | undefined;
      let transport: Awaited<ReturnType<typeof startEnterpriseModelGateway>> | undefined;
      try {
        for (const server of [upstream, router]) {
          await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
          });
        }
        const upstreamUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
        const gatewayUrl = `http://127.0.0.1:${(router.address() as { port: number }).port}`;
        const baseUrl = openai ? `${upstreamUrl}/v1` : upstreamUrl;
        const ordinaryRef = 'ordinary/shared';
        let key = 'active-token-001';
        let notifySourceChanged = () => {};
        const bridge = zhiyuanManagedProviderBridge;
        unbind = bridge.registerSource({
          providerKey: 'custom_enterprise_stress',
          exclusive: false,
          snapshot: async () => ({
            enabled: true,
            apiKey: key,
            baseUrl,
            apiFormat,
            models: [{ id: 'shared', name: 'Shared model' }],
          }),
          onDidChange: listener => {
            notifySourceChanged = listener;
            return () => {};
          },
        });
        await bridge.refresh();
        transport = await startEnterpriseModelGateway(bridge);
        const binding = bridge.hostProviders(transport.origin)[0];
        const provider = binding.id;
        const enterpriseRef = `${provider}/shared`;
        const modelService = new MagpieModelService(
          {
            status: () => ({ state: 'running', version: 'test', gatewayUrl }),
            workKeyResolver: () => () => scopedKey,
            models: async () => [
              {
                id: enterpriseRef,
                owned_by: provider,
                reasoning: true,
                native_endpoints: openai ? ['/v1/chat/completions'] : ['/v1/messages'],
              },
              { id: ordinaryRef, owned_by: 'ordinary' },
            ],
          },
          { readDefaultModelId: () => enterpriseRef, writeDefaultModelId: () => {} },
        );
        const runtime = await ModelRuntime.create({
          authPath: join(root, 'auth.json'),
          modelsPath: null,
          allowModelNetwork: false,
        });
        const createRuntime = vi.fn(async () => runtime);
        const pi = { ...(await getPiModules()), ModelRuntime: { create: createRuntime } };
        const chosen = await resolvePiModel(pi, modelService, enterpriseRef, undefined, {
          conversationId: 'conversation-fixture',
          workload: ZhiyuanModelPoolWorkload.Chat,
        });
        expect(chosen.requestOptions).toBeUndefined();
        expect(chosen.model.provider).toBe('magpie');
        const onResponse = vi.fn();
        const send = async (model: Record<string, unknown>) => {
          const result = await runtime.completeSimple(
            model as unknown as Model,
            {
              systemPrompt: instructions,
              messages: [{ role: 'user', content: 'Hello', timestamp: 0 }],
            },
            { onResponse },
          );
          expect(result.errorMessage).toContain('auth wire fixture');
        };
        await send(chosen.model);
        key = 'rotated-token-002';
        await send(chosen.model);
        expect(onResponse).not.toHaveBeenCalled();
        notifySourceChanged();
        await vi.waitFor(async () =>
          expect((await bridge.resolveTransport(provider, binding.apiKey!))?.token).toBe(
            'rotated-token-002',
          ),
        );
        await send(chosen.model);
        const ordinary = await resolvePiModel(pi, modelService, ordinaryRef, runtime);
        await send(ordinary.model);
        expect(calls).toEqual([
          ...['active-token-001', 'active-token-001', 'rotated-token-002'].map(token => ({
            path: openai ? '/v1/chat/completions' : expect.stringMatching(/^\/v1\/messages\b/),
            bearer: openai ? `Bearer ${token}` : undefined,
            apiKey: openai ? undefined : token,
            conversation: 'conversation-fixture',
          })),
          {
            path: '/v1/chat/completions',
            bearer: `Bearer ${MAGPIE_RUNTIME_API_KEY}`,
            apiKey: undefined,
            conversation: undefined,
          },
        ]);
        expect(instructionRoles).toEqual([...Array(3).fill(openai ? 'system' : 'user'), 'system']);
        for (const instructionBody of instructionBodies)
          expect(instructionBody).toContain(instructions);
        expect(createRuntime).toHaveBeenCalledExactlyOnceWith({ allowModelNetwork: false });
      } finally {
        unbind?.();
        await transport?.close();
        for (const server of [router, upstream]) {
          server.closeAllConnections();
          await new Promise<void>(resolve => server.close(() => resolve()));
        }
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
