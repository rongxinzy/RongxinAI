import { runAgentLoop, type AgentEvent, type AgentTool } from '@earendil-works/pi-agent-core';
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Model,
} from '@earendil-works/pi-ai';
import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('../skillRuntimeRunner', () => ({ runManagedSkillScript: vi.fn() }));
import { runManagedSkillScript, type SkillScriptRunResult } from '../skillRuntimeRunner';
import { buildPiSkillScriptTool, PiSkillScriptToolName } from './piSkillScriptTool';
import { PiToolEventType } from './constants';
import { PiMessageRole } from './piSubagentExecution';
import { PiAssistantStopReason, PiContentBlockType } from './piWriteTokenLimit';

const model: Model<'openai-completions'> = {
  id: 'test',
  name: 'Test',
  api: 'openai-completions',
  provider: 'openai',
  baseUrl: 'http://unused.invalid',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32768,
  maxTokens: 4096,
};
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

async function runTool(allowedSkillIds: string[]): Promise<AgentEvent[]> {
  const tool = buildPiSkillScriptTool({
    workspaceRoot: '/workspace',
    allowedSkillIds,
  }) as unknown as AgentTool;
  const events: AgentEvent[] = [];
  const assistant: AssistantMessage = {
    role: PiMessageRole.Assistant,
    api: model.api,
    provider: model.provider,
    model: model.id,
    content: [
      {
        type: PiContentBlockType.ToolCall,
        id: 'call',
        name: PiSkillScriptToolName,
        arguments: { skillId: 'pdf', script: 'check.py' },
      },
    ],
    stopReason: PiAssistantStopReason.ToolUse,
    timestamp: 1,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
  await runAgentLoop(
    [],
    { systemPrompt: '', messages: [], tools: [tool] },
    {
      model,
      convertToLlm: () => [],
      shouldStopAfterTurn: () => true,
    },
    event => {
      events.push(event);
    },
    undefined,
    () => {
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'done', reason: PiAssistantStopReason.ToolUse, message: assistant });
      return stream;
    },
  );
  return events;
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
