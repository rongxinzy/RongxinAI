/**
 * PiSubagentTool unit tests.
 *
 * Verifies the subagent tool (single / parallel) using a
 * mocked Pi SDK createAgentSession.
 */

import * as fs from 'fs';
import * as os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoreSkillId } from '../../../shared/skills/constants';

const hoisted = vi.hoisted(() => ({
  mockCreateAgentSession: vi.fn(),
  mockSessionManagerInMemory: vi.fn((cwd?: string) => ({ cwd, inMemory: true })),
}));

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: hoisted.mockCreateAgentSession,
  SessionManager: {
    inMemory: hoisted.mockSessionManagerInMemory,
  },
}));

import {
  buildPiSubagentTool,
  SUBAGENT_PARALLEL_LIMIT,
  type PiSubagentToolDeps,
} from './piSubagentTool';
import { PiSubagentProfileId } from './piSubagentConstants';
import { PiMessageRole, PiSubagentEventType } from './piSubagentExecution';

// ── Mock sessions ──

interface MockSubSession {
  prompt: ReturnType<typeof vi.fn>;
  steer: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  emit(event: unknown): void;
}

const assistantEndEvent = (text: string) => ({
  type: PiSubagentEventType.MessageEnd,
  message: { role: PiMessageRole.Assistant, content: text, stopReason: 'stop' },
});

const agentSettledEvent = () => ({ type: PiSubagentEventType.AgentSettled });

const errorEvent = (errorMessage: string) => ({
  type: PiSubagentEventType.Error,
  message: { errorMessage },
});

/** Drive a successful run: final assistant message followed by agent_settled. */
function emitCompletion(session: MockSubSession, text: string): void {
  session.emit(assistantEndEvent(text));
  session.emit(agentSettledEvent());
}

/** A session that immediately completes with the given output when prompted. */
function createAutoSession(output: string): MockSubSession {
  const listeners: Array<(event: unknown) => void> = [];
  const session: MockSubSession = {
    prompt: vi.fn(async () => {
      emitCompletion(session, output);
    }),
    steer: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    subscribe: vi.fn((listener: (event: unknown) => void) => {
      listeners.push(listener);
      return () => {};
    }),
    emit: (event: unknown) => {
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
  return session;
}

/** A session that stays pending until emit() drives its events. */
function createManualSession(): MockSubSession {
  const listeners: Array<(event: unknown) => void> = [];
  return {
    prompt: vi.fn(() => new Promise<void>(() => {})),
    steer: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    subscribe: vi.fn((listener: (event: unknown) => void) => {
      listeners.push(listener);
      return () => {};
    }),
    emit: (event: unknown) => {
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
}

// ── Tool harness ──

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  details: Record<string, unknown>;
}

interface SubagentTool {
  name: string;
  description: string;
  annotations?: import('@earendil-works/pi-coding-agent').ToolAnnotations;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: (update: unknown) => void,
  ): Promise<ToolResult>;
}

function buildTool(depsOverride: Partial<PiSubagentToolDeps> = {}): {
  tool: SubagentTool;
  deps: PiSubagentToolDeps;
} {
  const deps: PiSubagentToolDeps = {
    getPiAgentsDir: () => '/nonexistent-pi-agents',
    presetId: undefined,
    resolvedModel: {
      model: { provider: 'test', id: 'test-model' },
      modelRuntime: null,
      maxOutputTokens: 4096,
    },
    workspaceRoot: '/tmp/workspace',
    createPiResourceLoader: vi.fn(async () => ({})),
    ...depsOverride,
  };
  const tool = buildPiSubagentTool(deps);
  expect(tool).not.toBeNull();
  return { tool: tool as unknown as SubagentTool, deps };
}

describe('buildPiSubagentTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockCreateAgentSession.mockImplementation(async () => ({
      session: createAutoSession('subagent output'),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cancels active parallel sessions and does not launch queued work', async () => {
    const sessions: MockSubSession[] = [];
    hoisted.mockCreateAgentSession.mockImplementation(async () => {
      const session = createManualSession();
      sessions.push(session);
      return { session };
    });
    const { tool } = buildTool();
    const controller = new AbortController();
    const cancelled = new Error('parent stopped');
    const output = tool.execute(
      'parallel-cancel',
      {
        parallel: Array.from({ length: 8 }, () => ({ agent: 'scout', task: 'long task' })),
      },
      controller.signal,
    );
    const assertion = expect(output).rejects.toBe(cancelled);
    await vi.waitFor(() => expect(sessions).toHaveLength(SUBAGENT_PARALLEL_LIMIT));
    controller.abort(cancelled);
    await assertion;
    expect(hoisted.mockCreateAgentSession).toHaveBeenCalledTimes(SUBAGENT_PARALLEL_LIMIT);
    for (const session of sessions) expect(session.abort).toHaveBeenCalledOnce();
  });

  it('passes the child model and settings to native compaction without host overrides', async () => {
    const applyOverrides = vi.fn();
    const { tool } = buildTool({
      resolvedModel: {
        model: { provider: 'test', id: 'small', contextWindow: 16384 },
        modelRuntime: null,
        maxOutputTokens: 4096,
      },
      createPiResourceLoader: async () => ({ settingsManager: { applyOverrides } }),
    });
    await tool.execute('small', { agent: 'scout', task: 'inspect' });
    expect(applyOverrides).not.toHaveBeenCalled();
    expect(hoisted.mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({ contextWindow: 16384 }),
        settingsManager: { applyOverrides },
      }),
    );
  });

  // ── Parameter validation ──

  describe('parameter validation', () => {
    it('rejects a call with no mode parameters', async () => {
      const { tool } = buildTool();
      const result = await tool.execute('call-1', {});
      expect(result.content[0].text).toContain('Provide exactly one mode');
      expect(hoisted.mockCreateAgentSession).not.toHaveBeenCalled();
    });

    it('rejects mutually exclusive mode combinations', async () => {
      const { tool } = buildTool();
      const result = await tool.execute('call-1', {
        agent: 'scout',
        task: 'a',
        parallel: [{ agent: 'scout', task: 'b' }],
      });
      expect(result.content[0].text).toContain('mutually exclusive');
      expect(hoisted.mockCreateAgentSession).not.toHaveBeenCalled();
    });

    it('rejects empty agent or task in single mode', async () => {
      const { tool } = buildTool();
      const result = await tool.execute('call-1', { agent: '  ', task: '' });
      expect(result.content[0].text).toBe('Both "agent" and "task" parameters are required.');
      expect(hoisted.mockCreateAgentSession).not.toHaveBeenCalled();
    });

    it('rejects an empty parallel array', async () => {
      const { tool } = buildTool();
      const result = await tool.execute('call-1', { parallel: [] });
      expect(result.content[0].text).toContain('"parallel" must be a non-empty array');
    });
  });

  // ── Agent resolution ──

  describe('agent resolution', () => {
    it('reports an unknown agent together with the available agents', async () => {
      const { tool } = buildTool();
      const result = await tool.execute('call-1', { agent: 'nope', task: 'do something' });
      expect(result.content[0].text).toContain('Unknown agent "nope"');
      expect(result.content[0].text).toContain('researcher');
      expect(result.content[0].text).toContain('scout');
      expect(result.content[0].text).toContain('planner');
      expect(result.content[0].text).toContain('reviewer');
      expect(hoisted.mockCreateAgentSession).not.toHaveBeenCalled();
    });

    it('exposes the built-in profiles when no presetId is given', async () => {
      const { tool, deps } = buildTool();
      const result = await tool.execute('call-1', { agent: 'researcher', task: 'find docs' });
      expect(result.content[0].text).toBe('subagent output');
      expect(deps.createPiResourceLoader).toHaveBeenCalledWith(
        '/tmp/workspace',
        expect.stringContaining('research subagent'),
        4096,
      );
    });

    it('gives researcher subagents an explicit web-search capability', async () => {
      const { tool, deps } = buildTool({ webSearchSkillPath: '/tmp/web-search' });
      await tool.execute('call-1', { agent: 'researcher', task: 'find primary sources' });
      expect(deps.createPiResourceLoader).toHaveBeenCalledWith(
        '/tmp/workspace',
        expect.stringContaining(path.join('/tmp/web-search', 'scripts', 'search.mjs')),
        4096,
        [CoreSkillId.WebSearch],
      );
    });

    it('merges team member agents and lets members override same-name builtins', async () => {
      const agentsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-subagent-test-'));
      try {
        fs.writeFileSync(
          path.join(agentsDir, 'team1--researcher.md'),
          '---\ndescription: Custom team researcher\n---\nYou are the team researcher override.\n',
        );
        fs.writeFileSync(
          path.join(agentsDir, 'team1--custom-member.md'),
          '---\ndescription: Custom member\n---\nYou are a custom team member.\n',
        );

        const { tool, deps } = buildTool({
          getPiAgentsDir: () => agentsDir,
          presetId: 'team1',
        });

        // Member agent is available and its description shows in the tool listing.
        expect(tool.description).toContain('custom-member');
        expect(tool.description).toContain('Custom team researcher');

        // The member definition overrides the same-name builtin profile.
        await tool.execute('call-1', { agent: 'researcher', task: 'investigate' });
        expect(deps.createPiResourceLoader).toHaveBeenCalledWith(
          '/tmp/workspace',
          'You are the team researcher override.',
          4096,
        );

        // The custom member agent runs with its own system prompt.
        await tool.execute('call-2', { agent: 'custom-member', task: 'help out' });
        expect(deps.createPiResourceLoader).toHaveBeenCalledWith(
          '/tmp/workspace',
          'You are a custom team member.',
          4096,
        );
      } finally {
        fs.rmSync(agentsDir, { recursive: true, force: true });
      }
    });

    it('prefers live bundled member definitions over synced pi agents files', async () => {
      const agentsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-subagent-test-'));
      try {
        // Stale synced copy: would be used if the bundled source were absent.
        fs.writeFileSync(
          path.join(agentsDir, 'team1--custom-member.md'),
          '---\ndescription: Stale member\n---\nYou are the stale member definition.\n',
        );

        const { tool, deps } = buildTool({
          getPiAgentsDir: () => agentsDir,
          presetId: 'team1',
          loadBundledMembers: () => [
            {
              id: 'custom-member',
              description: 'Live member',
              systemPrompt: 'You are the live bundled member definition.',
            },
          ],
        });

        expect(tool.description).toContain('Live member');
        await tool.execute('call-1', { agent: 'custom-member', task: 'help out' });
        expect(deps.createPiResourceLoader).toHaveBeenCalledWith(
          '/tmp/workspace',
          'You are the live bundled member definition.',
          4096,
        );
      } finally {
        fs.rmSync(agentsDir, { recursive: true, force: true });
      }
    });
  });

  // ── Single mode ──

  describe('single mode', () => {
    it('runs one sub-session and returns its output', async () => {
      const { tool, deps } = buildTool();
      const result = await tool.execute('call-1', { agent: 'scout', task: 'map the code' });
      expect(result.content[0].text).toBe('subagent output');
      expect(result.details).toMatchObject({
        agentId: 'scout',
        execution: {
          terminationReason: 'settled',
          assistantTurns: 1,
          toolCalls: 0,
        },
      });
      expect(hoisted.mockCreateAgentSession).toHaveBeenCalledTimes(1);
      const options = hoisted.mockCreateAgentSession.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(options).not.toHaveProperty('customTools');
      expect(options.tools).toEqual(['read', 'grep', 'find', 'ls']);
      expect(options.model).toBe(deps.resolvedModel.model);
      expect(deps.createPiResourceLoader).toHaveBeenCalledWith(
        '/tmp/workspace',
        expect.any(String),
        4096,
      );
    });

    it('keeps the ordinary reviewer read-only', async () => {
      const { tool, deps } = buildTool();

      await tool.execute('call-1', {
        agent: PiSubagentProfileId.Reviewer,
        task: 'review the implementation',
      });

      expect(deps.createPiResourceLoader).toHaveBeenCalledWith(
        '/tmp/workspace',
        expect.stringContaining('code review subagent'),
        4096,
      );
    });

    it('surfaces a sub-session error as the tool output', async () => {
      hoisted.mockCreateAgentSession.mockImplementation(async () => {
        const session = createManualSession();
        session.prompt.mockImplementation(async () => {
          session.emit(errorEvent('model exploded'));
        });
        return { session };
      });
      const { tool } = buildTool();
      const result = await tool.execute('call-1', { agent: 'scout', task: 'x' });
      expect(result.content[0].text).toBe('Error: model exploded');
    });
  });

  // ── Parallel mode ──

  describe('parallel mode', () => {
    it('caps concurrency and queues the remaining tasks', async () => {
      const sessions: MockSubSession[] = [];
      hoisted.mockCreateAgentSession.mockImplementation(async () => {
        const session = createManualSession();
        sessions.push(session);
        return { session };
      });

      const { tool } = buildTool();
      const tasks = Array.from({ length: 6 }, (_, index) => ({
        agent: 'scout',
        task: `task ${index}`,
      }));
      const promise = tool.execute('call-1', { parallel: tasks });

      // Only SUBAGENT_PARALLEL_LIMIT sub-sessions start before any completes.
      await vi.waitFor(() => expect(sessions).toHaveLength(SUBAGENT_PARALLEL_LIMIT));
      expect(sessions).toHaveLength(SUBAGENT_PARALLEL_LIMIT);

      // Completing one run unblocks exactly one queued task.
      emitCompletion(sessions[0], 'done 0');
      await vi.waitFor(() => expect(sessions).toHaveLength(SUBAGENT_PARALLEL_LIMIT + 1));

      for (const session of sessions.slice(1)) {
        emitCompletion(session, 'done');
      }
      // The last queued task starts once another worker frees up.
      await vi.waitFor(() => expect(sessions).toHaveLength(tasks.length));
      emitCompletion(sessions[sessions.length - 1], 'done');

      const result = await promise;
      expect(result.content[0].text).toContain('6/6 subagents succeeded');
    });

    it('isolates a single failing subagent from the group', async () => {
      hoisted.mockCreateAgentSession.mockImplementation(async () => {
        const session = createManualSession();
        session.prompt.mockImplementation(async (task: string) => {
          if (task.includes('doomed')) {
            session.emit(errorEvent('boom'));
          } else {
            emitCompletion(session, `ok: ${task}`);
          }
        });
        return { session };
      });

      const { tool } = buildTool();
      const result = await tool.execute('call-1', {
        parallel: [
          { agent: 'scout', task: 'fine task' },
          { agent: 'reviewer', task: 'doomed task' },
          { agent: 'planner', task: 'another fine task' },
        ],
      });

      expect(result.content[0].text).toContain('2/3 subagents succeeded');
      expect(result.content[0].text).toContain('## scout (ok)');
      expect(result.content[0].text).toContain('## reviewer (failed)');
      expect(result.content[0].text).toContain('Error: boom');
      expect(result.content[0].text).toContain('## planner (ok)');
    });

    it('truncates oversized subagent output beyond PI_SUBAGENT_MAX_OUTPUT_CHARS', async () => {
      const oversized = 'y'.repeat(60_000);
      hoisted.mockCreateAgentSession.mockResolvedValueOnce({
        session: createAutoSession(oversized),
      });

      const { tool } = buildTool();
      const result = await tool.execute('call-1', { agent: 'scout', task: 'big task' });

      expect((result.details as { truncated?: boolean }).truncated).toBe(true);
      expect(result.content[0].text).toContain(
        '[Subagent output truncated to 30,000 characters (total: 60,000 characters)]',
      );
    });

    it('safely slices without trailing high surrogate when output is truncated', async () => {
      // 29,999 'z's + '🚀' (2 units) + 'rest'
      const boundaryText = 'z'.repeat(29_999) + '🚀rest';
      hoisted.mockCreateAgentSession.mockResolvedValueOnce({
        session: createAutoSession(boundaryText),
      });

      const { tool } = buildTool();
      const result = await tool.execute('call-1', { agent: 'scout', task: 'emoji task' });

      expect((result.details as { truncated?: boolean }).truncated).toBe(true);
      expect(result.content[0].text.startsWith('z'.repeat(29_999))).toBe(true);
      expect(result.content[0].text).toContain(
        `[Subagent output truncated to 30,000 characters (total: ${boundaryText.length.toLocaleString()} characters)]`,
      );
    });

    it('creates ephemeral in-memory sessions and disposes sub-sessions in finally', async () => {
      const subSession = createAutoSession('disposed ok');
      hoisted.mockCreateAgentSession.mockResolvedValueOnce({ session: subSession });

      const { tool } = buildTool();
      const result = await tool.execute('call-dispose', { agent: 'scout', task: 'check files' });

      expect(result.content[0].text).toContain('disposed ok');
      expect(hoisted.mockSessionManagerInMemory).toHaveBeenCalled();
      expect(hoisted.mockCreateAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionManager: expect.objectContaining({ inMemory: true }),
        }),
      );
      expect(subSession.abort).toHaveBeenCalledOnce();
      expect(subSession.dispose).toHaveBeenCalledOnce();
    });

    it('provides readOnly annotations and passes onUpdate progress events from child tools', async () => {
      let childListener: ((event: unknown) => void) | undefined;
      const childSession = {
        prompt: vi.fn(async () => {
          childListener?.({
            type: PiSubagentEventType.ToolExecutionStart,
            toolCallId: 'child-c1',
            toolName: 'read',
            args: { path: 'a.txt' },
          });
          childListener?.({
            type: PiSubagentEventType.ToolExecutionUpdate,
            toolCallId: 'child-c1',
            toolName: 'read',
            partialResult: 'reading...',
          });
          childListener?.({
            type: PiSubagentEventType.ToolExecutionEnd,
            toolCallId: 'child-c1',
            toolName: 'read',
            result: 'done',
            isError: false,
          });
          childListener?.(assistantEndEvent('finished child task'));
          childListener?.(agentSettledEvent());
        }),
        steer: vi.fn(),
        abort: vi.fn(),
        dispose: vi.fn(),
        subscribe: vi.fn((listener: (event: unknown) => void) => {
          childListener = listener;
          return () => {};
        }),
      };
      hoisted.mockCreateAgentSession.mockResolvedValueOnce({ session: childSession });

      const { tool } = buildTool();
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        openWorldHint: false,
      });

      const updates: unknown[] = [];
      const onUpdate = vi.fn((update: unknown) => updates.push(update));

      const result = await tool.execute(
        'parent-call-id',
        { agent: 'scout', task: 'scan dir' },
        undefined,
        onUpdate,
      );

      expect(result.content[0].text).toBe('finished child task');
      expect(onUpdate).toHaveBeenCalled();
      expect(
        updates.some(
          (u: any) =>
            u.details?.childToolCallId === 'child-c1' &&
            u.details?.parentToolCallId === 'parent-call-id',
        ),
      ).toBe(true);
    });
  });
});
