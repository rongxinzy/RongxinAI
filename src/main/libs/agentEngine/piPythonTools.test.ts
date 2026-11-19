import * as anthropic from '@earendil-works/pi-ai/api/anthropic-messages';
import * as openai from '@earendil-works/pi-ai/api/openai-completions';
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript';
import { expect, test, vi } from 'vitest';

import { PythonRuntimeService } from '../../pythonRuntime/service';
import {
  buildPiPythonTools,
  PI_PYTHON_TOOL_MAX_OUTPUT_CHARS,
  PiPythonToolName,
  type PiPythonToolAuthorizationCall,
} from './piPythonTools';

type ExecutableTool = {
  name: string;
  description: string;
  parameters: import('typebox').TSchema;
  outputSchema?: import('typebox').TSchema;
  annotations?: import('@earendil-works/pi-coding-agent').ToolAnnotations;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<{
    content: Array<{ type: 'text'; text: string }>;
    details: unknown;
    structuredContent?: unknown;
  }>;
};

for (const allow of [false, true]) {
  test(`native Python tool ${allow ? 'executes after approval' : 'cannot start Runner after denial'}`, async () => {
    const packages = ['packaging', 'requests>=2.31,<3'];
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
    const executeTool = tools.find(tool => tool.name === PiPythonToolName.Execute)!;

    expect(executeTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(installTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(executeTool.outputSchema).toBeDefined();
    expect(installTool.outputSchema).toBeDefined();

    try {
      if (allow) {
        const result = await installTool.execute('python-call', {
          packages,
        });
        expect(JSON.parse(result.content[0].text)).toMatchObject({
          stdout: 'installed',
          exitCode: 0,
          environmentId: 'fixture',
        });
        expect(result.structuredContent).toMatchObject({
          stdout: 'installed',
          exitCode: 0,
          environmentId: 'fixture',
        });
      } else {
        await expect(installTool.execute('python-call', { packages })).rejects.toThrow('denied');
      }
      expect(authorize).toHaveBeenCalledOnce();
      expect(authorize.mock.calls[0][0]).toMatchObject({ toolName: 'python_install' });
      expect(install).toHaveBeenCalledTimes(allow ? 1 : 0);
      if (allow) {
        expect(install.mock.calls[0][0]).toEqual({
          workspace: '/workspace',
          packages,
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

test('bounds oversized python_execute stdout and traceback stderr within PI_PYTHON_TOOL_MAX_OUTPUT_CHARS as valid JSON', async () => {
  const service = new PythonRuntimeService({
    storageRoot: '/unused',
    runnerPath: '/must-not-run',
  });
  const bigStdout = 'PY-HEAD-' + 'x'.repeat(200_000) + '-PY-TAIL';
  const traceback = 'Traceback (most recent call last):\nValueError: boom';
  const spy = vi.spyOn(service, 'execute');

  const tools = buildPiPythonTools({
    service,
    workspace: '/workspace',
  }) as unknown as ExecutableTool[];
  const executeTool = tools.find(tool => tool.name === PiPythonToolName.Execute)!;

  try {
    spy.mockResolvedValueOnce({
      stdout: bigStdout,
      stderr: '',
      exitCode: 0,
      truncated: false,
      environmentId: 'env-1',
      runtimeId: 'rt-1',
    });
    const okRes = await executeTool.execute('call-ok', { code: 'print(1)' });
    const parsedOk = JSON.parse(okRes.content[0].text) as {
      stdout: string;
      stderr: string;
      truncated: boolean;
    };
    expect(parsedOk.truncated).toBe(true);
    expect(parsedOk.stdout.length + parsedOk.stderr.length).toBeLessThanOrEqual(
      PI_PYTHON_TOOL_MAX_OUTPUT_CHARS,
    );
    expect(parsedOk.stdout).toContain('PY-HEAD-');
    expect(parsedOk.stdout).toContain('-PY-TAIL');

    spy.mockResolvedValueOnce({
      stdout: bigStdout,
      stderr: traceback,
      exitCode: 1,
      truncated: false,
      environmentId: 'env-1',
      runtimeId: 'rt-1',
    });
    let thrown = '';
    try {
      await executeTool.execute('call-err', { code: 'raise ValueError("boom")' });
    } catch (err) {
      thrown = err instanceof Error ? err.message : String(err);
    }
    const parsedErr = JSON.parse(thrown) as {
      stdout: string;
      stderr: string;
      truncated: boolean;
    };
    expect(parsedErr.truncated).toBe(true);
    expect(parsedErr.stdout.length + parsedErr.stderr.length).toBeLessThanOrEqual(
      PI_PYTHON_TOOL_MAX_OUTPUT_CHARS,
    );
    expect(parsedErr.stderr).toBe(traceback);
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
