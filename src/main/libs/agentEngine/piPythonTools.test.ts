import * as anthropic from '@earendil-works/pi-ai/api/anthropic-messages';
import * as openai from '@earendil-works/pi-ai/api/openai-completions';
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript';
import { expect, test, vi } from 'vitest';

import { PythonRuntimeService } from '../../pythonRuntime/service';
import {
  buildPiPythonTools,
  PiPythonToolName,
  type PiPythonToolAuthorizationCall,
} from './piPythonTools';

type ExecutableTool = {
  name: string;
  description: string;
  parameters: import('typebox').TSchema;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<{ content: Array<{ type: 'text'; text: string }>; details: unknown }>;
};

for (const allow of [false, true]) {
  test(`native Python tool ${allow ? 'executes after approval' : 'cannot start Runner after denial'}`, async () => {
    const service = new PythonRuntimeService({
      storageRoot: '/unused',
      runnerPath: '/must-not-run',
    });
    const install = vi.spyOn(service, 'install').mockResolvedValue({
      stdout: 'installed',
      stderr: '',
      exitCode: 0,
      truncated: false,
      environmentId: 'fixture',
      runtimeId: 'fixture',
    });
    const authorize = vi.fn(async (_call: PiPythonToolAuthorizationCall) => ({
      allow,
      reason: 'denied',
    }));
    const tools = buildPiPythonTools({
      service,
      workspace: '/workspace',
      authorize,
    }) as unknown as ExecutableTool[];

    expect(tools.every(tool => /^[a-zA-Z0-9_-]{1,64}$/.test(tool.name))).toBe(true);
    const installTool = tools.find(tool => tool.name === PiPythonToolName.Install)!;

    try {
      if (allow) {
        const result = await installTool.execute('python-call', {
          packages: ['packaging==25.0'],
        });
        expect(JSON.parse(result.content[0].text)).toMatchObject({
          stdout: 'installed',
          exitCode: 0,
          environmentId: 'fixture',
        });
      } else {
        await expect(
          installTool.execute('python-call', { packages: ['packaging==25.0'] }),
        ).rejects.toThrow('denied');
      }
      expect(authorize).toHaveBeenCalledOnce();
      expect(authorize.mock.calls[0][0]).toMatchObject({ toolName: 'python_install' });
      expect(install).toHaveBeenCalledTimes(allow ? 1 : 0);
      if (allow) {
        expect(install.mock.calls[0][0]).toEqual({
          workspace: '/workspace',
          packages: ['packaging==25.0'],
        });
      }
    } finally {
      await service.shutdown();
    }
  });
}

test('python_execute surfaces non-zero exit codes as tool errors with serialized output', async () => {
  const service = new PythonRuntimeService({
    storageRoot: '/unused',
    runnerPath: '/must-not-run',
  });
  vi.spyOn(service, 'execute').mockResolvedValue({
    stdout: '',
    stderr: 'ZeroDivisionError',
    exitCode: 1,
    truncated: false,
    environmentId: 'fixture-env',
    runtimeId: 'fixture-runtime',
  });
  const tools = buildPiPythonTools({
    service,
    workspace: '/workspace',
  }) as unknown as ExecutableTool[];
  const executeTool = tools.find(tool => tool.name === PiPythonToolName.Execute)!;

  try {
    await expect(executeTool.execute('call-1', { code: '1/0' })).rejects.toThrow(
      'ZeroDivisionError',
    );
  } finally {
    await service.shutdown();
  }
});

test('real OpenAI and Anthropic serializers send portable Python names', async () => {
  const service = new PythonRuntimeService({ storageRoot: '/unused', runnerPath: '/unused' });
  const tools = buildPiPythonTools({
    service,
    workspace: '/workspace',
  }) as unknown as ExecutableTool[];
  const context = normalizeContext({
    messages: [{ role: 'user', content: 'test', timestamp: 1 }],
    tools,
  });
  const bodies: Array<{ tools: Array<{ name?: string; function?: { name: string } }> }> = [];
  const fetchRequest: typeof fetch = async (_input, init) => {
    if (typeof init?.body !== 'string') throw new Error('Expected serialized JSON');
    bodies.push(JSON.parse(init.body));
    return new Response(
      JSON.stringify({
        error: { message: 'fixture ends after serialization', type: 'invalid_request_error' },
      }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  };
  const base = {
    id: 'fixture',
    name: 'Fixture',
    provider: 'fixture',
    baseUrl: 'https://unused.invalid',
    reasoning: false,
    input: ['text' as const],
    contextWindow: 32000,
    maxTokens: 100,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  try {
    await openai
      .stream({ ...base, api: 'openai-completions' }, context, {
        apiKey: 'fixture-only',
        fetch: fetchRequest,
      })
      .result();
    await anthropic
      .stream({ ...base, api: 'anthropic-messages' }, context, {
        apiKey: 'fixture-only',
        fetch: fetchRequest,
      })
      .result();
    expect(bodies).toHaveLength(2);
    expect(bodies[0].tools.map(tool => tool.function?.name)).toEqual([
      'python_execute',
      'python_install',
    ]);
    expect(bodies[1].tools.map(tool => tool.name)).toEqual(['python_execute', 'python_install']);
  } finally {
    await service.shutdown();
  }
});
