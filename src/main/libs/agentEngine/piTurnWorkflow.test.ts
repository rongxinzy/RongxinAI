import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { CoworkSessionMode } from '../../../shared/cowork/constants';
import { AcademicResearchSkillIds, CoreSkillId } from '../../../shared/skills/constants';
import { PiRuntimeAdapter } from './piRuntimeAdapter';
import { installTestMagpie } from '../../../../tests/helpers/installTestMagpie';
import { resolvePiTurnWorkflowSkills } from './piTurnWorkflow';
import { PiAgentLoopToolName } from './piAgentLoop';
import { PiResearchStateToolName } from './piResearchTypes';
import { PiSkillScriptToolName } from './piSkillScriptTool';
import { PiAgentEventType } from './piStreamConstants';

const mocks = vi.hoisted(() => {
  const session = {
    prompt: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
    abort: vi.fn().mockResolvedValue(undefined),
    abortBash: vi.fn(),
    bindExtensions: vi.fn().mockResolvedValue(undefined),
  };
  return { session, create: vi.fn().mockResolvedValue({ session }) };
});

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: mocks.create,
  DefaultResourceLoader: class {
    async reload() {}
  },
  SessionManager: { inMemory: () => ({}) },
  SettingsManager: { create: () => ({ applyOverrides() {} }) },
  getAgentDir: () => os.tmpdir(),
  ModelRuntime: {
    create: async () => ({ registerProvider() {}, async setRuntimeApiKey() {}, getModel() {} }),
  },
  createCodemodeExtension: undefined,
  createToolSearchExtension: undefined,
  createMcpExtension: undefined,
}));
vi.mock('@earendil-works/pi-ai/compat', () => ({
  getModel: () => null,
  completeSimple: vi.fn(),
}));
vi.mock('../coworkUtil', async importOriginal => ({
  ...(await importOriginal<typeof import('../coworkUtil')>()),
  applyApplicationRuntimeEnv: vi.fn(),
  resolveGitBashPathForPi: () => undefined,
}));

let adapter: PiRuntimeAdapter;
let workspaceRoot: string;
let disposeMagpie: (() => void) | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  disposeMagpie?.();
  disposeMagpie = installTestMagpie().dispose;
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-turn-workflow-'));
  adapter = new PiRuntimeAdapter();
});
afterEach(() => {
  adapter.stopSession('session');
  disposeMagpie?.();
  disposeMagpie = undefined;
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test.each([[...AcademicResearchSkillIds], [CoreSkillId.PresentationStudio]])(
  'stored workflow skills remain available without forcing a plain follow-up: %j',
  async (...skillIds) => {
    await adapter.startSession('session', 'What was the previous task?', {
      workspaceRoot,
      sessionMode: CoworkSessionMode.Work,
      skillIds,
      attachedSkillIds: [],
    });
    const options = mocks.create.mock.calls[0]?.[0] as {
      customTools: Array<{ name: string }>;
    };
    expect(options.customTools.map(tool => tool.name)).not.toContain(PiResearchStateToolName);
    expect(options.customTools.map(tool => tool.name)).not.toContain(PiAgentLoopToolName);
    expect(options.customTools.map(tool => tool.name)).toContain(PiSkillScriptToolName);
    expect(mocks.session.prompt).toHaveBeenCalledWith('What was the previous task?');
    const listener = mocks.session.subscribe.mock.calls[0]?.[0] as (event: {
      type: string;
    }) => void;
    listener({ type: PiAgentEventType.AgentEnd });
    listener({ type: PiAgentEventType.AgentSettled });
    await vi.waitFor(() => expect(adapter.isSessionRunning('session')).toBe(false));
    expect(mocks.session.prompt).toHaveBeenCalledTimes(1);
  },
);

test('clearing turn attachments on a live research session removes its completion gate', async () => {
  await adapter.startSession('session', 'Research agents.', {
    workspaceRoot,
    sessionMode: CoworkSessionMode.Work,
    skillIds: [...AcademicResearchSkillIds],
    attachedSkillIds: [...AcademicResearchSkillIds],
  });
  await adapter.continueSession('session', 'Just recall the previous task.', {
    skillIds: [...AcademicResearchSkillIds],
    attachedSkillIds: [],
  });
  expect(mocks.create).toHaveBeenCalledTimes(2);
  const options = mocks.create.mock.calls[1]?.[0] as {
    customTools: Array<{ name: string }>;
  };
  expect(options.customTools.map(tool => tool.name)).not.toContain(PiResearchStateToolName);
  expect(mocks.session.prompt).toHaveBeenLastCalledWith('Just recall the previous task.');
});

test('explicit research selection and internal continuation retain controlled workflows', () => {
  expect(
    resolvePiTurnWorkflowSkills({
      attachedSkillIds: [...AcademicResearchSkillIds],
      availableSkillIds: [],
    }),
  ).toEqual(AcademicResearchSkillIds);
  expect(
    resolvePiTurnWorkflowSkills({
      availableSkillIds: [...AcademicResearchSkillIds],
      previousWorkflowSkillIds: [],
    }),
  ).toEqual([]);
  expect(resolvePiTurnWorkflowSkills({ availableSkillIds: [...AcademicResearchSkillIds] })).toEqual(
    AcademicResearchSkillIds,
  );
});
