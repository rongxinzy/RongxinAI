import { beforeEach, expect, test, vi } from 'vitest';
import type { ToolDefinition } from './durableToolTypes';
import { runDurableToolForTest } from './durableRuntime.testHarness';
import type { PiEvent } from './piRuntimeSessionState';
vi.mock('../skillRuntimeRunner', () => ({ runManagedSkillScript: vi.fn() }));
import { runManagedSkillScript, type SkillScriptRunResult } from '../skillRuntimeRunner';
import { buildPiSkillScriptTool } from './piSkillScriptTool';
import { PiToolEventType } from './constants';

const result: SkillScriptRunResult = {
  ok: false,
  status: 'failed',
  errorCode: 'SKILL_SCRIPT_FAILED',
  error: 'exit code 1',
  runtime: 'python',
  command: '/managed/python',
  args: [],
  scriptPath: '/skills/pdf/check.py',
  exitCode: 1,
  stdout: 'partial output',
  stderr: 'ModuleNotFoundError: missing library',
  durationMs: 1,
  timedOut: false,
};

beforeEach(() => {
  vi.mocked(runManagedSkillScript).mockReset();
});

async function runTool(
  allowedSkillIds: string[],
  skillRoots?: Readonly<Record<string, string>>,
): Promise<PiEvent[]> {
  const tool = buildPiSkillScriptTool({
    workspaceRoot: '/workspace',
    allowedSkillIds,
    skillRoots,
  }) as unknown as ToolDefinition;
  return runDurableToolForTest(tool, { skillId: 'pdf', script: 'check.py' });
}

test('Pi emits an error tool result for failed scripts and retains diagnostics', async () => {
  vi.mocked(runManagedSkillScript).mockResolvedValue(result);
  const events = await runTool(['pdf']);
  const end = events.find(event => event.type === PiToolEventType.ExecutionEnd);
  expect(end).toMatchObject({ isError: true });
  const encoded = JSON.stringify(end);
  expect(encoded).toContain(result.errorCode);
  expect(encoded).toContain(result.stderr);
  expect(encoded).toContain(result.stdout);
});

test('Pi emits an error without executing an unselected skill', async () => {
  const events = await runTool([]);
  expect(events.find(event => event.type === PiToolEventType.ExecutionEnd)).toMatchObject({
    isError: true,
  });
  expect(runManagedSkillScript).not.toHaveBeenCalled();
});

test('Pi reports successful scripts normally', async () => {
  vi.mocked(runManagedSkillScript).mockResolvedValue({
    ...result,
    ok: true,
    status: 'completed',
    exitCode: 0,
    error: undefined,
    errorCode: undefined,
    stderr: '',
  });
  const events = await runTool(['pdf']);
  expect(events.find(event => event.type === PiToolEventType.ExecutionEnd)).toMatchObject({
    isError: false,
  });
});

test('passes the trusted root for nested expert skills to the runner', async () => {
  vi.mocked(runManagedSkillScript).mockResolvedValue({
    ...result,
    ok: true,
    status: 'completed',
    exitCode: 0,
    error: undefined,
    errorCode: undefined,
    stderr: '',
  });
  await runTool(['pdf'], { pdf: '/skills' });
  expect(runManagedSkillScript).toHaveBeenCalledWith(
    expect.objectContaining({ skillsRoot: '/skills' }),
  );
});

test('reads the current selection and root when a skill is added during execution', async () => {
  let selection: { skillIds: string[]; skillRoots: Record<string, string> } = {
    skillIds: [],
    skillRoots: {},
  };
  const tool = buildPiSkillScriptTool({
    workspaceRoot: '/workspace',
    allowedSkillIds: [],
    getSkillSelection: () => selection,
  }) as unknown as ToolDefinition;
  await expect(tool.execute('before', { skillId: 'pdf', script: 'check.py' })).rejects.toThrow(
    'SKILL_NOT_SELECTED',
  );
  selection = { skillIds: ['pdf'], skillRoots: { pdf: '/expert' } };
  vi.mocked(runManagedSkillScript).mockResolvedValue({
    ...result,
    ok: true,
    status: 'completed',
    exitCode: 0,
  });
  await tool.execute('after', { skillId: 'pdf', script: 'check.py' });
  expect(runManagedSkillScript).toHaveBeenCalledWith(
    expect.objectContaining({ skillsRoot: '/expert' }),
  );
  selection = { skillIds: [], skillRoots: {} };
  await expect(tool.execute('removed', { skillId: 'pdf', script: 'check.py' })).rejects.toThrow(
    'SKILL_NOT_SELECTED',
  );
});
