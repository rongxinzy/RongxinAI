import { expect, test, vi } from 'vitest';

import type { CodingAgentConfigOption } from '../../../shared/codingAgent';
import { PiThinkingLevel } from '../../libs/agentEngine/piRuntimeTypes';
import {
  BuiltinCodingConfigId,
  BuiltinCodingDriver,
  type BuiltinCodingRuntime,
} from './builtinCodingDriver';

const createRuntime = (
  overrides?: Partial<BuiltinCodingRuntime>,
): BuiltinCodingRuntime & {
  start: ReturnType<typeof vi.fn>;
  patchSession: ReturnType<typeof vi.fn>;
} => ({
  start: vi.fn().mockResolvedValue(undefined),
  cancel: vi.fn().mockResolvedValue(undefined),
  patchSession: vi.fn().mockResolvedValue(undefined),
  listModelOptions: () => [
    { value: 'openai/gpt-5', name: 'GPT-5' },
    { value: 'anthropic/claude-opus', name: 'Claude Opus' },
  ],
  getCurrentModelRef: () => 'openai/gpt-5',
  ...overrides,
});

const findOption = (options: CodingAgentConfigOption[], id: string) =>
  options.find(candidate => candidate.id === id);

test('starts the in-process runtime while the room owns streamed event projection', async () => {
  const calls: string[] = [];
  const driver = new BuiltinCodingDriver({
    start: async sessionId => {
      calls.push(sessionId);
    },
    cancel: async sessionId => {
      calls.push(`cancel:${sessionId}`);
    },
  });
  const session = await driver.createSession({ workspaceRoot: '/workspace' });
  const events = [];
  for await (const event of driver.prompt({
    sessionId: session.id,
    workspaceRoot: '/workspace',
    prompt: 'work',
  }))
    events.push(event);
  expect((await driver.getCapabilities()).supportsFilesystem).toBe(true);
  expect(events).toEqual([]);
  await driver.cancel(session.id);
  expect(calls).toEqual([session.id, `cancel:${session.id}`]);
});

test('advertises config option support', async () => {
  const driver = new BuiltinCodingDriver(createRuntime());
  await expect(driver.getCapabilities()).resolves.toMatchObject({ supportsConfigOptions: true });
});

test('createSession exposes model and thinking-level options with defaults', async () => {
  const driver = new BuiltinCodingDriver(createRuntime());
  const session = await driver.createSession({ workspaceRoot: '/ws', localSessionId: 's1' });

  const model = findOption(session.configOptions, BuiltinCodingConfigId.Model);
  expect(model).toMatchObject({
    type: 'select',
    currentValue: 'openai/gpt-5',
  });
  expect(model?.options?.map(candidate => candidate.value)).toEqual([
    'openai/gpt-5',
    'anthropic/claude-opus',
  ]);

  const thinking = findOption(session.configOptions, BuiltinCodingConfigId.ThinkingLevel);
  expect(thinking).toMatchObject({ type: 'select', currentValue: PiThinkingLevel.Medium });
  expect(thinking?.options?.map(candidate => candidate.value)).toEqual(
    Object.values(PiThinkingLevel),
  );
});

test('omits the model option when no model is selectable', async () => {
  const driver = new BuiltinCodingDriver(
    createRuntime({ listModelOptions: () => [], getCurrentModelRef: () => null }),
  );
  const session = await driver.createSession({ workspaceRoot: '/ws', localSessionId: 's1' });
  expect(findOption(session.configOptions, BuiltinCodingConfigId.Model)).toBeUndefined();
  expect(findOption(session.configOptions, BuiltinCodingConfigId.ThinkingLevel)).toBeDefined();
});

test('keeps an unlisted current model selectable', async () => {
  const driver = new BuiltinCodingDriver(
    createRuntime({ getCurrentModelRef: () => 'llamacpp/qwen-local' }),
  );
  const session = await driver.createSession({ workspaceRoot: '/ws', localSessionId: 's1' });
  const model = findOption(session.configOptions, BuiltinCodingConfigId.Model);
  expect(model?.currentValue).toBe('llamacpp/qwen-local');
  expect(model?.options?.some(candidate => candidate.value === 'llamacpp/qwen-local')).toBe(true);
});

test('restores persisted selections from existing config options', async () => {
  const driver = new BuiltinCodingDriver(createRuntime());
  const session = await driver.createSession({
    workspaceRoot: '/ws',
    localSessionId: 's1',
    existingConfigOptions: [
      {
        id: BuiltinCodingConfigId.Model,
        name: 'Model',
        type: 'select',
        currentValue: 'anthropic/claude-opus',
      },
      {
        id: BuiltinCodingConfigId.ThinkingLevel,
        name: 'Thinking',
        type: 'select',
        currentValue: 'high',
      },
    ],
  });
  expect(findOption(session.configOptions, BuiltinCodingConfigId.Model)?.currentValue).toBe(
    'anthropic/claude-opus',
  );
  expect(
    findOption(session.configOptions, BuiltinCodingConfigId.ThinkingLevel)?.currentValue,
  ).toBe('high');
});

test('falls back to medium for an invalid persisted thinking level', async () => {
  const driver = new BuiltinCodingDriver(createRuntime());
  const session = await driver.createSession({
    workspaceRoot: '/ws',
    localSessionId: 's1',
    existingConfigOptions: [
      {
        id: BuiltinCodingConfigId.ThinkingLevel,
        name: 'Thinking',
        type: 'select',
        currentValue: 'ludicrous',
      },
    ],
  });
  expect(
    findOption(session.configOptions, BuiltinCodingConfigId.ThinkingLevel)?.currentValue,
  ).toBe(PiThinkingLevel.Medium);
});

test('setConfigOption updates the selection and patches the live session', async () => {
  const runtime = createRuntime();
  const driver = new BuiltinCodingDriver(runtime);
  await driver.createSession({ workspaceRoot: '/ws', localSessionId: 's1' });

  const afterModel = await driver.setConfigOption(
    's1',
    BuiltinCodingConfigId.Model,
    'anthropic/claude-opus',
  );
  expect(runtime.patchSession).toHaveBeenCalledWith('s1', { model: 'anthropic/claude-opus' });
  expect(findOption(afterModel, BuiltinCodingConfigId.Model)?.currentValue).toBe(
    'anthropic/claude-opus',
  );

  const afterThinking = await driver.setConfigOption(
    's1',
    BuiltinCodingConfigId.ThinkingLevel,
    'high',
  );
  expect(runtime.patchSession).toHaveBeenCalledWith('s1', { thinkingLevel: 'high' });
  expect(findOption(afterThinking, BuiltinCodingConfigId.ThinkingLevel)?.currentValue).toBe('high');
});

test('setConfigOption rejects unknown options and values', async () => {
  const driver = new BuiltinCodingDriver(createRuntime());
  await driver.createSession({ workspaceRoot: '/ws', localSessionId: 's1' });
  await expect(driver.setConfigOption('s1', 'nope', 'x')).rejects.toThrow();
  await expect(
    driver.setConfigOption('s1', BuiltinCodingConfigId.ThinkingLevel, 'ludicrous'),
  ).rejects.toThrow();
});

test('prompt forwards the selected model and thinking level to the runtime', async () => {
  const runtime = createRuntime();
  const driver = new BuiltinCodingDriver(runtime);
  await driver.createSession({ workspaceRoot: '/ws', localSessionId: 's1' });
  await driver.setConfigOption('s1', BuiltinCodingConfigId.Model, 'anthropic/claude-opus');
  await driver.setConfigOption('s1', BuiltinCodingConfigId.ThinkingLevel, 'high');

  for await (const _event of driver.prompt({
    sessionId: 's1',
    workspaceRoot: '/ws',
    prompt: 'hi',
  })) {
    // The built-in driver never yields events; draining starts the runtime.
  }

  expect(runtime.start).toHaveBeenCalledWith('s1', '/ws', 'hi', {
    modelOverride: 'anthropic/claude-opus',
    thinkingLevel: 'high',
  });
});

test('disposeSession drops stored config options', async () => {
  const driver = new BuiltinCodingDriver(createRuntime());
  await driver.createSession({ workspaceRoot: '/ws', localSessionId: 's1' });
  expect(driver.getSessionConfigOptions('s1')).not.toHaveLength(0);
  await driver.disposeSession('s1');
  expect(driver.getSessionConfigOptions('s1')).toHaveLength(0);
});
