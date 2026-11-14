import { createServer, type IncomingHttpHeaders } from 'node:http';
import { once } from 'node:events';
import type { Api, Model } from '@earendil-works/pi-ai';
import { afterEach } from 'vitest';
import { zhiyuanManagedProviderBridge as bridge } from '../../enterpriseExtension/managedProviderBridge';
import { ZhiyuanModelPoolHeader } from '../../../shared/modelPool/constants';
import { DurableModelCatalog } from './durableModelCatalog.mjs';

interface CapturedRequest {
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}
const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

export async function catalogHttpFixture(
  api: 'openai-completions' | 'anthropic-messages' = 'openai-completions',
) {
  const requests: CapturedRequest[] = [];
  let status = 200;
  let token = 'initial-enterprise-fixture-token';
  let snapshots = 0;
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += String(chunk);
    requests.push({ headers: request.headers, body: JSON.parse(raw) as Record<string, unknown> });
    if (status !== 200) {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          error: { message: 'Unauthorized fixture request.', type: 'authentication_error' },
        }),
      );
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (new URL(request.url ?? '/', 'http://fixture').pathname.endsWith('/messages')) {
      const events = [
        {
          type: 'message_start',
          message: {
            id: 'msg',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'fixture',
            usage: { input_tokens: 1, output_tokens: 0 },
          },
        },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Native response.' },
        },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 2 },
        },
        { type: 'message_stop' },
      ];
      for (const event of events)
        response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    } else {
      response.write(
        `data: ${JSON.stringify({ id: 'completion', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: 'Native response.' }, finish_reason: 'stop' }] })}\n\n`,
      );
      response.write('data: [DONE]\n\n');
    }
    response.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address is missing.');
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const dispose = bridge.registerSource({
    providerKey: 'custom_native_catalog',
    snapshot: async () => {
      snapshots++;
      return {
        enabled: true,
        apiKey: token,
        baseUrl,
        models: [{ id: 'fixture', name: 'Fixture', contextWindow: 8192, piRuntime: { api } }],
      };
    },
  });
  cleanup.push(dispose);
  await bridge.refresh();
  const provider = bridge.hostProviders()[0].id;
  const catalog = new DurableModelCatalog();
  const definition: Model<Api> = {
    id: 'fixture',
    name: 'Fixture',
    provider,
    api,
    baseUrl,
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 32,
    headers: {
      [ZhiyuanModelPoolHeader.ConversationId]: 'conversation',
      [ZhiyuanModelPoolHeader.Workload]: 'work',
    },
    ...(api === 'openai-completions' ? { compat: { supportsDeveloperRole: true } } : {}),
  };
  catalog.registerProvider(provider, { api, baseUrl, models: [definition] });
  const model = catalog.getModel(provider, 'fixture');
  if (!model) throw new Error('Native model is unavailable.');
  return {
    catalog,
    model,
    definition,
    requests,
    snapshots: () => snapshots,
    setStatus: (value: number) => {
      status = value;
    },
    setToken: (value: string) => {
      token = value;
    },
  };
}
