import { expect, test, vi } from 'vitest';

import type { CodingAgentConfigOption } from '../../../shared/codingAgent';
import { WorkbenchApprovalMode } from '../../../shared/workbenchTask';
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
  setApprovalMode: ReturnType<typeof vi.fn>;
} => ({
  start: vi.fn().mockResolvedValue(undefined),
  cancel: vi.fn().mockResolvedValue(undefined),
  patchSession: vi.fn().mockResolvedValue(undefined),
  setApprovalMode: vi.fn(),
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

test('forwards the lane model override to the in-process runtime', async () => {
  const runtime = createRuntime();
  const driver = new BuiltinCodingDriver(runtime);
  const session = await driver.createSession({ workspaceRoot: '/workspace' });

  for await (const _event of driver.prompt({
    sessionId: session.id,
    workspaceRoot: '/workspace',
    prompt: 'work',
    modelOverride: 'deepseek/deepseek-v4-pro',
  })) {
    // The built-in runtime owns the stream projection.
  }

  expect(runtime.start).toHaveBeenCalledWith(
    session.id,
    '/workspace',
    'work',
    expect.objectContaining({ modelOverride: 'deepseek/deepseek-v4-pro' }),
  );
});

test('advertises config option support', async () => {
  const driver = new BuiltinCodingDriver(createRuntime());
  await expect(driver.getCapabilities()).resolves.toMatchObject({ supportsConfigOptions: true });
});

test('createSession exposes the thinking-level option with a medium default', async () => {
  const driver = new BuiltinCodingDriver(createRuntime());
  const session = await driver.createSession({ workspaceRoot: '/ws', localSessionId: 's1' });

  const thinking = findOption(session.configOptions, BuiltinCodingConfigId.ThinkingLevel);
  expect(thinking).toMatchObject({ type: 'select', currentValue: PiThinkingLevel.Medium });
  expect(thinking?.options?.map(candidate => candidate.value)).toEqual(
    Object.values(PiThinkingLevel),
  );
});

test('restores a persisted thinking level and rejects invalid persisted values', async () => {
  const driver = new BuiltinCodingDriver(createRuntime());
  const restored = await driver.createSession({
    workspaceRoot: '/ws',
    localSessionId: 's1',
    existingConfigOptions: [
      {
        id: BuiltinCodingConfigId.ThinkingLevel,
        name: 'Thinking',
        type: 'select',
        currentValue: 'high',
      },
    ],
  });
  expect(
    findOption(restored.configOptions, BuiltinCodingConfigId.ThinkingLevel)?.currentValue,
  ).toBe('high');

  const invalid = await driver.createSession({
    workspaceRoot: '/ws',
    localSessionId: 's2',
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
    findOption(invalid.configOptions, BuiltinCodingConfigId.ThinkingLevel)?.currentValue,
  ).toBe(PiThinkingLevel.Medium);
});

test('setConfigOption updates the selection and patches the live session', async () => {
  const runtime = createRuntime();
  const driver = new BuiltinCodingDriver(runtime);
  await driver.createSession({ workspaceRoot: '/ws', localSessionId: 's1' });

  const updated = await driver.setConfigOption('s1', BuiltinCodingConfigId.ThinkingLevel, 'high');

  expect(runtime.patchSession).toHaveBeenCalledWith('s1', { thinkingLevel: 'high' });
  expect(findOption(updated, BuiltinCodingConfigId.ThinkingLevel)?.currentValue).toBe('high');
});

test('setConfigOption applies the permission mode to the live session', async () => {
  const runtime = createRuntime();
  const driver = new BuiltinCodingDriver(runtime);
  await driver.createSession({ workspaceRoot: '/ws', localSessionId: 's1' });

  const updated = await driver.setConfigOption(
    's1',
    BuiltinCodingConfigId.PermissionMode,
    WorkbenchApprovalMode.AllowAll,
  );

  expect(runtime.setApprovalMode).toHaveBeenCalledWith('s1', WorkbenchApprovalMode.AllowAll);
  expect(findOption(updated, BuiltinCodingConfigId.PermissionMode)?.currentValue).toBe(
    WorkbenchApprovalMode.AllowAll,
  );
});

test('prompt forwards the selected permission mode to the runtime', async () => {
  const runtime = createRuntime();
  const driver = new BuiltinCodingDriver(runtime);
  await driver.createSession({ workspaceRoot: '/ws', localSessionId: 's1' });
  await driver.setConfigOption(
    's1',
    BuiltinCodingConfigId.PermissionMode,
    WorkbenchApprovalMode.Auto,
  );

  for await (const _event of driver.prompt({
    sessionId: 's1',
    workspaceRoot: '/ws',
    prompt: 'hi',
  })) {
    // The built-in driver never yields events; draining starts the runtime.
  }

  expect(runtime.start).toHaveBeenCalledWith(
    's1',
    '/ws',
    'hi',
    expect.objectContaining({ permissionMode: WorkbenchApprovalMode.Auto }),
  );
});

test('createSession restores a persisted permission mode and rejects invalid values', async () => {
  const driver = new BuiltinCodingDriver(createRuntime());
  const restored = await driver.createSession({
    workspaceRoot: '/ws',
    localSessionId: 's1',
    existingConfigOptions: [
      {
        id: BuiltinCodingConfigId.PermissionMode,
        name: 'Permission mode',
        type: 'select',
        currentValue: WorkbenchApprovalMode.Auto,
      },
    ],
  });
  expect(
    findOption(restored.configOptions, BuiltinCodingConfigId.PermissionMode)?.currentValue,
  ).toBe(WorkbenchApprovalMode.Auto);

  const invalid = await driver.createSession({
    workspaceRoot: '/ws',
    localSessionId: 's2',
    existingConfigOptions: [
      {
        id: BuiltinCodingConfigId.PermissionMode,
        name: 'Permission mode',
        type: 'select',
        currentValue: 'yolo',
      },
    ],
  });
  expect(
    findOption(invalid.configOptions, BuiltinCodingConfigId.PermissionMode)?.currentValue,
  ).toBe(WorkbenchApprovalMode.Ask);
});

test('setConfigOption rejects unknown options and values', async () => {
  const driver = new BuiltinCodingDriver(createRuntime());
  await driver.createSession({ workspaceRoot: '/ws', localSessionId: 's1' });
  await expect(driver.setConfigOption('s1', 'nope', 'x')).rejects.toThrow();
  await expect(
    driver.setConfigOption('s1', BuiltinCodingConfigId.ThinkingLevel, 'ludicrous'),
  ).rejects.toThrow();
});

test('prompt forwards the selected thinking level to the runtime', async () => {
  const runtime = createRuntime();
  const driver = new BuiltinCodingDriver(runtime);
  await driver.createSession({ workspaceRoot: '/ws', localSessionId: 's1' });
  await driver.setConfigOption('s1', BuiltinCodingConfigId.ThinkingLevel, 'high');

  for await (const _event of driver.prompt({
    sessionId: 's1',
    workspaceRoot: '/ws',
    prompt: 'hi',
  })) {
    // The built-in driver never yields events; draining starts the runtime.
  }

  expect(runtime.start).toHaveBeenCalledWith('s1', '/ws', 'hi', {
    thinkingLevel: 'high',
    permissionMode: WorkbenchApprovalMode.Ask,
  });
});

test('getDefaultConfigOptions builds options without binding them to a session', async () => {
  const driver = new BuiltinCodingDriver(createRuntime());
  const options = driver.getDefaultConfigOptions();
  expect(options).toEqual([
    expect.objectContaining({
      id: BuiltinCodingConfigId.ThinkingLevel,
      currentValue: PiThinkingLevel.Medium,
    }),
    expect.objectContaining({
      id: BuiltinCodingConfigId.PermissionMode,
      currentValue: WorkbenchApprovalMode.Ask,
    }),
  ]);
  // Defaults are not bound to any session yet.
  expect(driver.getSessionConfigOptions('anything')).toEqual([]);
});

test('disposeSession drops stored config options', async () => {
  const driver = new BuiltinCodingDriver(createRuntime());
  await driver.createSession({ workspaceRoot: '/ws', localSessionId: 's1' });
  expect(driver.getSessionConfigOptions('s1')).not.toHaveLength(0);
  await driver.disposeSession('s1');
  expect(driver.getSessionConfigOptions('s1')).toHaveLength(0);
});
