import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai';
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import {
  createRegistry,
  defineExtension,
  Harness,
  MemoryStorage,
} from '@earendil-works/pi-durable';
import { obj, str } from '@earendil-works/pi-schema';
import { expect, test, vi } from 'vitest';
import { WorkbenchApprovalMode } from '../../../shared/workbenchTask';
import { getDurableInvocation } from './durableInvocation.mjs';
import { createDurableResourcePolicy } from './durableResourcePolicy';
import { formatDurableSkills, loadDurableSkills } from './durableSkills';
import { toDurableTool, type ToolDefinition } from './durableToolTypes';
import { buildDurableMcpTools } from './durableMcpTools';

const context = BACKGROUND_CONTEXT;

test('discovers selected app skills with root precedence and refuses escaping symlinks', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'durable-skills-'));
  try {
    const first = path.join(await realpath(directory), 'app');
    const second = path.join(directory, 'bundled');
    const external = path.join(directory, 'external');
    await Promise.all([first, second, external].map(root => mkdir(root)));
    for (const root of [first, second]) {
      await mkdir(path.join(root, 'report'));
      await writeFile(
        path.join(root, 'report', 'SKILL.md'),
        `---\nname: report\ndescription: Build a report\n---\n${root}`,
      );
    }
    await writeFile(path.join(external, 'SKILL.md'), '---\nname: private\n---\nprivate');
    await symlink(external, path.join(first, 'private'), 'dir');
    await mkdir(path.join(first, 'linked-file'));
    await symlink(path.join(external, 'SKILL.md'), path.join(first, 'linked-file', 'SKILL.md'));
    const result = await loadDurableSkills([first, second], ['report', 'private', 'linked-file']);
    expect(result.skills).toEqual([
      {
        name: 'report',
        description: 'Build a report',
        filePath: path.join(first, 'report', 'SKILL.md'),
        baseDir: path.join(first, 'report'),
      },
    ]);
    expect(formatDurableSkills(result.skills)).toContain(path.join(first, 'report', 'SKILL.md'));
    expect((await loadDurableSkills([first], [])).skills).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('runs host tools as native Durable tasks with persisted receipts and invocation ownership', async () => {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('record', { value: 'kept' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage('done'),
  ]);
  const parameters = obj({ value: str() });
  const execution = vi.fn();
  const definition: ToolDefinition<typeof parameters, { value: string }> = {
    name: 'record',
    label: 'Record',
    description: 'Record a value.',
    parameters,
    outputSchema: parameters,
    annotations: { idempotentHint: true },
    async execute(callId, args) {
      expect(getDurableInvocation().api.callId).toBe(callId);
      execution(args.value);
      return {
        content: [{ type: 'text', text: args.value }],
        details: { value: args.value },
        structuredContent: { value: args.value },
      };
    },
  };
  const tool = toDurableTool(definition);
  expect(tool.replay).toBe('unsafe');
  expect(tool.annotations).toEqual({ idempotentHint: true });
  const registry = createRegistry();
  registry.install(defineExtension({ name: 'test.host-tools', tools: [tool] }));
  const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);
  try {
    const model = faux.getModel();
    const conversation = await harness.root(context, {
      agent: { model: { provider: model.provider, modelId: model.id } },
    });
    const original = await conversation.submit(
      { type: 'input', content: 'Record it.', requestId: 'one' },
      context,
    );
    expect((await original.wait(context)).status).toBe('done');
    const repeated = await conversation.submit(
      { type: 'input', content: 'Record it.', requestId: 'one' },
      context,
    );
    expect(repeated.id).toBe(original.id);
    expect(execution).toHaveBeenCalledExactlyOnceWith('kept');
    const entries = await conversation.entries({}, 20, undefined, context);
    expect(entries.items.some(entry => entry.kind === 'pi.tool-result')).toBe(true);
  } finally {
    await harness.close(context);
  }
});

test('MCP exposes only allowed native tools and preserves images without replaying external effects', async () => {
  const callTool = vi.fn(async () => ({
    content: [{ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' }],
    isError: false,
  }));
  const manager = {
    lastEnabledRecords: [
      { id: 'docs', name: 'docs', enabled: true, exposure: 'direct' },
      { id: 'private', name: 'private', enabled: true, exposure: 'hidden' },
      { id: 'code', name: 'code', enabled: true },
      { id: 'deferred', name: 'deferred', enabled: true, exposure: 'deferred' },
      { id: 'broken', name: 'broken', enabled: true, credentialsError: 'unreadable' },
    ],
    toolManifest: ['docs', 'private', 'code', 'deferred', 'broken'].map(server => ({
      server,
      name: 'read',
      description: 'Read the requested content.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true, idempotentHint: true },
    })),
    callTool,
  };
  const { tools, annotations } = buildDurableMcpTools(manager as never);
  expect(annotations.get('mcp__docs__read')).toEqual({ readOnlyHint: true, idempotentHint: true });
  expect(tools.map(tool => tool.name)).toEqual([
    'mcp__docs__read',
    'mcp__code__read',
    'mcp__deferred__read',
  ]);
  expect(tools[1].callers).toEqual(['tools']);
  expect(tools[2].deferred).toBe(true);
  expect(tools.every(tool => tool.replay === 'unsafe')).toBe(true);
  expect(buildDurableMcpTools(manager as never, ['docs']).tools).toHaveLength(1);
  const result = await tools[0].execute({}, {} as never, context);
  expect(result.output).toEqual([{ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' }]);
  expect(callTool).toHaveBeenCalledWith('docs', 'read', {}, { signal: undefined });
});

test('native Durable beforeTool enforces read-only planning and foreground approval', async () => {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const execution = vi.fn();
  const authorizeToolCall = vi.fn(async () => ({ allow: false, reason: 'User denied.' }));
  const state = {
    planMode: true,
    piSession: { getToolDefinition: () => ({ annotations: { readOnlyHint: false } }) },
  };
  const policy = createDurableResourcePolicy(
    { activeSessions: new Map([['work', state]]), authorizeToolCall } as never,
    {
      sessionId: 'work',
      getRunId: () => 'run',
      getApprovalMode: () => WorkbenchApprovalMode.Ask,
    },
  );
  const registry = createRegistry();
  registry.install(policy);
  registry.install(
    defineExtension({
      name: 'test.effect',
      tools: [
        toDurableTool({
          name: 'effect',
          label: 'Effect',
          description: 'Perform an effect.',
          parameters: obj({}),
          execute: async () => {
            execution();
            return { content: [{ type: 'text', text: 'executed' }] };
          },
        }),
      ],
    }),
  );
  const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);
  try {
    const model = faux.getModel();
    const conversation = await harness.root(context, {
      agent: { model: { provider: model.provider, modelId: model.id } },
    });
    for (const planMode of [true, false]) {
      state.planMode = planMode;
      faux.setResponses([
        fauxAssistantMessage(fauxToolCall('effect', {}), { stopReason: 'toolUse' }),
        fauxAssistantMessage('blocked'),
      ]);
      const submission = await conversation.submit({ type: 'input', content: 'Run.' }, context);
      expect((await submission.wait(context)).status).toBe('done');
    }
    expect(execution).not.toHaveBeenCalled();
    expect(authorizeToolCall).toHaveBeenCalledTimes(1);
    expect(authorizeToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'work', runId: 'run', toolName: 'effect' }),
    );
  } finally {
    await harness.close(context);
  }
});
