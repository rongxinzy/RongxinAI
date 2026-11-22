import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { expect, test, vi } from 'vitest';

import { createTestMagpie, TEST_MAGPIE_WORK_KEY } from '../helpers/createTestMagpie';
import { CoworkSessionMode } from '../../src/shared/cowork/constants';
import { ZhiyuanModelPoolWorkload } from '../../src/shared/modelPool/constants';
import { PiRuntimeAdapter } from '../../src/main/libs/agentEngine/piRuntimeAdapter';
import { resolveAnySearchGateway } from '../../src/main/libs/anysearchGatewayCredentials';
import { MagpieWorkHeader } from '../../src/main/magpie/modelService';

vi.mock('../../src/main/libs/anysearchGatewayCredentials', () => ({
  resolveAnySearchGateway: vi.fn(),
}));

test('native Pi researcher calls the hosted search tool and returns retrieved sources', async () => {
  if (typeof app.getAppPath !== 'function') app.getAppPath = () => process.cwd();
  const root = await mkdtemp(path.join(tmpdir(), 'zhiyuan-research-search-'));
  const searches: unknown[] = [];
  const parentTools: string[][] = [];
  const childTools: string[][] = [];
  const modelScopes: unknown[] = [];
  let childSawSearchResult = false;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk.toString();
    if (req.url === '/v1/search') {
      searches.push({ authorization: req.headers.authorization, query: JSON.parse(body) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          data: {
            results: [
              {
                title: 'Fixture source',
                url: 'https://example.com/result',
                snippet: 'Primary document.',
              },
            ],
          },
        }),
      );
      return;
    }
    const request = JSON.parse(body) as {
      tools?: { function: { name: string } }[];
      messages: unknown[];
    };
    const names = request.tools?.map(tool => tool.function.name) ?? [];
    const parent = names.includes('subagent');
    modelScopes.push({
      parent,
      authorization: req.headers.authorization,
      workload: req.headers[MagpieWorkHeader.Workload.toLowerCase()],
      models: req.headers[MagpieWorkHeader.Models.toLowerCase()],
    });
    const calls = parent ? parentTools : childTools;
    calls.push(names);
    const first = calls.length === 1;
    const id = parent ? 'parent' : 'child';
    if (!parent && !first)
      childSawSearchResult = JSON.stringify(request.messages).includes(
        'https://example.com/result',
      );
    const delta = first
      ? {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: `tool-${id}`,
              type: 'function',
              function: parent
                ? {
                    name: 'subagent',
                    arguments: JSON.stringify({
                      agent: 'researcher',
                      task: 'Find a current source.',
                    }),
                  }
                : {
                    name: 'web_search',
                    arguments: JSON.stringify({ query: 'current source', maxResults: 1 }),
                  },
            },
          ],
        }
      : { role: 'assistant', content: 'Source https://example.com/result' };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const [payload, finish_reason] of [
      [delta, null],
      [{}, first ? 'tool_calls' : 'stop'],
    ]) {
      res.write(
        `data: ${JSON.stringify({
          id: `completion-${id}`,
          object: 'chat.completion.chunk',
          model: 'fixture',
          choices: [{ index: 0, delta: payload, finish_reason }],
        })}\n\n`,
      );
    }
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const gatewayUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  vi.mocked(resolveAnySearchGateway).mockReturnValue({
    url: gatewayUrl,
    token: 'search-fixture-token',
  });
  const gateway = createTestMagpie({ gatewayUrl, defaultModelId: 'fixture' });
  gateway.upsert('fixture', { context_window: 32768, max_output_tokens: 4096 });
  const runtime = new PiRuntimeAdapter({ modelService: gateway.modelService });
  const errors: unknown[] = [];
  runtime.on('error', (_sessionId, error) => errors.push(error));
  try {
    await runtime.startSession('research-search', 'Find a current source with the researcher.', {
      workspaceRoot: root,
      sessionMode: CoworkSessionMode.Work,
    });
    expect(errors).toEqual([]);
    expect(parentTools).toHaveLength(2);
    expect(childTools).toHaveLength(2);
    expect(modelScopes).toEqual(
      [true, false, false, true].map(parent => ({
        parent,
        authorization: `Bearer ${TEST_MAGPIE_WORK_KEY}`,
        workload: ZhiyuanModelPoolWorkload.Work,
        models: JSON.stringify(['fixture/fixture']),
      })),
    );
    expect(childTools[0]).toContain('web_search');
    expect(childTools[0]).not.toContain('subagent');
    expect(childSawSearchResult).toBe(true);
    expect(searches).toEqual([
      {
        authorization: 'Bearer search-fixture-token',
        query: { query: 'current source', max_results: 1 },
      },
    ]);
  } finally {
    const { drained, viewerStopped } = runtime.shutdown();
    await Promise.all([drained, viewerStopped]);
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
