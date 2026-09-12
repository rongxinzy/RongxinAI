/**
 * Terminal-state regression tests for pure-text length truncation.
 *
 * The recovery steer itself is covered in piRuntimeAdapter.test.ts; this file
 * verifies the state that survives the run: the workbench Task/Run must not
 * record a disclosed truncation as a business success (existing incomplete
 * semantics: needs_review), while the session/UI stay idle and continuable,
 * and the bounded continuation leaves no steering residue on later turns.
 */

import * as fs from 'fs';
import * as os from 'os';
import path from 'path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WorkbenchRunStatus,
  WorkbenchTaskStatus,
} from '../../../shared/workbenchTask';
import type { CoworkStore } from '../../coworkStore';
import { WorkbenchTaskService as RealWorkbenchTaskService } from '../../workbenchTask/taskService';
import { initializeWorkbenchTaskSchema } from '../../workbenchTask/schema';
import { initializeProductionLoopSchema } from '../../productionLoop/schema';

const hoisted = vi.hoisted(() => {
  const mockSession = {
    prompt: vi.fn().mockResolvedValue(undefined),
    sendUserMessage: vi.fn().mockResolvedValue(undefined),
    steer: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    abortBash: vi.fn(),
    reload: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    setThinkingLevel: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
  };
  const mockCompleteSimple = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'Hello from Pi' }],
    stopReason: 'stop',
  });
  return {
    mockSession,
    mockCreateAgentSession: vi.fn().mockResolvedValue({ session: mockSession }),
    mockDefaultResourceLoader: vi.fn(function (this: { reload: () => Promise<void> }) {
      this.reload = vi.fn().mockResolvedValue(undefined);
    }),
    mockSessionManagerInMemory: vi.fn((cwd?: string) => ({ cwd })),
    mockSettingsManagerCreate: vi.fn((cwd: string, agentDir?: string) => ({
      cwd,
      agentDir,
      applyOverrides: vi.fn(),
      getShellPath: vi.fn(),
    })),
    mockSettingsManagerInMemory: vi.fn(() => ({
      applyOverrides: vi.fn(),
      getShellPath: vi.fn(),
    })),
    mockGetAgentDir: vi.fn(() => '/tmp/pi-agent'),
    mockApplyApplicationRuntimeEnv: vi.fn(),
    mockCompleteSimple,
    mockGetModel: vi.fn((provider: string, modelId: string) => ({ provider, id: modelId })),
    mockModelRuntime: {
      registerProvider: vi.fn(),
      setRuntimeApiKey: vi.fn().mockResolvedValue(undefined),
      getModel: vi.fn(),
      completeSimple: mockCompleteSimple,
    },
    mockModelRuntimeCreate: vi.fn(),
    mockRegisterPiOpenAICompatUpstream: vi.fn(
      async (providerId: string) => `http://127.0.0.1:19191/__pi_openai_compat/${providerId}/v1`,
    ),
    mockRegisterPiOpenAICompatTokenRefresher: vi.fn(),
    mockGetCommunityAuthAccessToken: vi.fn(async () => 'community-access-token'),
    mockResolveRawApiConfig: vi.fn(() => ({
      config: {
        apiKey: 'sk-test',
        baseURL: 'http://127.0.0.1:11434/v1',
        model: 'qwen-local',
        apiType: 'openai' as const,
      },
      providerMetadata: {
        providerName: 'llamacpp',
        codingPlanEnabled: false,
        supportsImage: false,
        modelName: 'qwen-local',
        capabilities: { toolCalling: 'supported' },
        contextWindow: 32768,
        contextTokens: 32768,
        maxTokens: 4096,
      },
    })),
  };
});

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: hoisted.mockCreateAgentSession,
  DefaultResourceLoader: hoisted.mockDefaultResourceLoader,
  SessionManager: {
    inMemory: hoisted.mockSessionManagerInMemory,
  },
  SettingsManager: {
    create: hoisted.mockSettingsManagerCreate,
    inMemory: hoisted.mockSettingsManagerInMemory,
  },
  getAgentDir: hoisted.mockGetAgentDir,
  ModelRuntime: {
    create: hoisted.mockModelRuntimeCreate,
  },
}));

vi.mock('@earendil-works/pi-ai/compat', () => ({
  getModel: hoisted.mockGetModel,
  completeSimple: hoisted.mockCompleteSimple,
}));

vi.mock('../claudeSettings', () => ({
  resolveRawApiConfig: hoisted.mockResolveRawApiConfig,
  resolveRawApiConfigForModelRef: hoisted.mockResolveRawApiConfig,
}));

vi.mock('./piOpenAICompatProxy', () => ({
  registerPiOpenAICompatTokenRefresher: hoisted.mockRegisterPiOpenAICompatTokenRefresher,
  registerPiOpenAICompatUpstream: hoisted.mockRegisterPiOpenAICompatUpstream,
}));

vi.mock('../../communityAuthSession', () => ({
  getModelPoolAccessToken: hoisted.mockGetCommunityAuthAccessToken,
}));

vi.mock('../coworkUtil', async importOriginal => {
  const actual = await importOriginal<typeof import('../coworkUtil')>();
  return {
    ...actual,
    applyApplicationRuntimeEnv: hoisted.mockApplyApplicationRuntimeEnv,
    resolveGitBashPathForPi: vi.fn(() => undefined),
  };
});

import { PiRuntimeAdapter } from './piRuntimeAdapter';

describe('PiRuntimeAdapter truncated answer terminal state', () => {
  let adapter: PiRuntimeAdapter;
  let listener: ((event: unknown) => void) | null = null;
  let mockStore: {
    updateSession: ReturnType<typeof vi.fn>;
    updateMessage: ReturnType<typeof vi.fn>;
    addMessage: ReturnType<typeof vi.fn>;
    getSession: ReturnType<typeof vi.fn>;
    getAgent: ReturnType<typeof vi.fn>;
    listAgents: ReturnType<typeof vi.fn>;
    refreshSessionArtifacts: ReturnType<typeof vi.fn>;
  };
  let completes: string[];
  const temporaryWorkspaceRoots = new Set<string>();
  const createTemporaryWorkspace = (): string => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-truncation-'));
    temporaryWorkspaceRoots.add(workspaceRoot);
    return workspaceRoot;
  };

  const truncatedAnswer = (text: string) => {
    listener!({ type: 'turn_start' });
    listener!({
      type: 'message_update',
      message: { role: 'assistant', content: [{ type: 'text', text }] },
    });
    listener!({
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'length' },
    });
    listener!({ type: 'turn_end' });
  };

  const completeAnswer = (text: string) => {
    listener!({ type: 'turn_start' });
    listener!({
      type: 'message_update',
      message: { role: 'assistant', content: [{ type: 'text', text }] },
    });
    listener!({
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' },
    });
    listener!({ type: 'turn_end' });
  };

  const systemMessages = () =>
    mockStore.addMessage.mock.calls.filter(
      ([, message]) => (message as { type: string }).type === 'system',
    );

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockModelRuntimeCreate.mockResolvedValue(hoisted.mockModelRuntime);
    adapter = new PiRuntimeAdapter();
    listener = null;
    hoisted.mockSession.steer.mockReset();
    hoisted.mockSession.steer.mockResolvedValue(undefined);
    hoisted.mockSession.subscribe.mockImplementation((cb: (event: unknown) => void) => {
      listener = cb;
      return () => {};
    });
    mockStore = {
      updateSession: vi.fn(),
      updateMessage: vi.fn(
        (_sessionId: string, messageId: string, patch: Record<string, unknown>) => ({
          id: messageId,
          ...patch,
        }),
      ),
      addMessage: vi.fn((_sessionId: string, message: Record<string, unknown>) => ({
        ...message,
        id: (message.id as string) ?? 'stored-id',
      })),
      getSession: vi.fn(() => undefined),
      getAgent: vi.fn(() => undefined),
      listAgents: vi.fn(() => []),
      refreshSessionArtifacts: vi.fn(),
    };
    adapter.setCoworkStore(mockStore as unknown as CoworkStore);
    completes = [];
    adapter.on('complete', sessionId => completes.push(sessionId));
  });

  afterEach(() => {
    for (const workspaceRoot of temporaryWorkspaceRoots) {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
    temporaryWorkspaceRoots.clear();
  });

  describe('recovery budget mechanics', () => {
    it('queues at most one continuation when the steer promise rejects asynchronously', async () => {
      hoisted.mockSession.steer.mockImplementation(
        () => Promise.reject(new Error('steer pipe broken')),
      );
      await adapter.startSession('test', 'Hi');

      // First truncated answer: the steer is queued, then rejects async — the
      // rollback restores the budget for the same run.
      truncatedAnswer('First truncated attempt ');
      await Promise.resolve();
      await Promise.resolve();
      // Second truncated message in the same run queues again (budget rolled
      // back); the third hits the exhausted budget.
      hoisted.mockSession.steer.mockResolvedValue(undefined);
      truncatedAnswer('Second truncated attempt ');
      truncatedAnswer('Third truncated attempt ');
      listener!({ type: 'agent_end' });

      expect(hoisted.mockSession.steer).toHaveBeenCalledTimes(2);
      expect(systemMessages()).toHaveLength(1);
      expect(completes).toEqual(['test']);
    });

    it('leaves no steering residue for the next user turn after a disclosed truncation', async () => {
      await adapter.startSession('test', 'Hi');

      truncatedAnswer('Truncated terminal answer');
      listener!({ type: 'agent_end' });
      expect(systemMessages()).toHaveLength(1);

      // The user continues the same (non-aborted) session. The old turn's
      // continuation budget must not leak into the new turn: a complete answer
      // needs no steer at all.
      hoisted.mockSession.steer.mockClear();
      hoisted.mockSession.prompt.mockClear();
      await adapter.continueSession('test', 'Please continue from where it stopped');
      expect(hoisted.mockSession.prompt).toHaveBeenCalledTimes(1);
      expect(hoisted.mockSession.prompt).toHaveBeenCalledWith(
        'Please continue from where it stopped',
      );

      completeAnswer('The completed remainder');
      listener!({ type: 'agent_end' });

      expect(hoisted.mockSession.steer).not.toHaveBeenCalled();
      expect(systemMessages()).toHaveLength(1);
      expect(completes).toEqual(['test', 'test']);
    });
  });

  describe('workbench terminal state (real service)', () => {
    let db: InstanceType<typeof Database>;
    let service: RealWorkbenchTaskService;

    const currentRun = () => {
      const detail = service.getCurrent('work-session')!;
      expect(detail).not.toBeNull();
      // Completed/failed tasks clear activeRunId, so fall back to the latest run.
      return (
        detail.runs.find(candidate => candidate.id === detail.task.activeRunId) ??
        detail.runs[detail.runs.length - 1] ??
        null
      );
    };

    beforeEach(() => {
      db = new Database(':memory:');
      initializeWorkbenchTaskSchema(db);
      initializeProductionLoopSchema(db);
      service = new RealWorkbenchTaskService(db);
      adapter.setWorkbenchTaskService(service);
    });

    afterEach(() => {
      db.close();
    });

    it('marks a budget-exhausted truncation as needs_review, never succeeded, while the session goes idle', async () => {
      await adapter.startSession('work-session', 'Write the long report', {
        sessionMode: 'work',
        workspaceRoot: createTemporaryWorkspace(),
      });

      truncatedAnswer('First truncated attempt ');
      truncatedAnswer('Second truncated attempt');
      listener!({ type: 'agent_end' });

      // UI stays continuable: idle session + complete event.
      expect(completes).toEqual(['work-session']);
      expect(mockStore.updateSession).toHaveBeenCalledWith('work-session', { status: 'idle' });

      // The truncation disclosure was persisted before completion.
      const disclosure = mockStore.addMessage.mock.calls
        .map(([, message]) => message as Record<string, unknown>)
        .find(message => message.metadata?.answerTruncated === true);
      expect(disclosure).toBeDefined();

      // Business state: the run must NOT be recorded as a success.
      const detail = service.getCurrent('work-session')!;
      expect(detail.task.status).toBe(WorkbenchTaskStatus.NeedsReview);
      const run = currentRun()!;
      expect(run.status).toBe(WorkbenchRunStatus.NeedsReview);
      expect(run.verificationResult?.outcome).toBe('failed');
      expect(
        run.verificationResult?.checks.some(
          (check: { name: string; status: string }) =>
            check.name === 'stream_closed_cleanly' && check.status === 'failed',
        ),
      ).toBe(true);
    });

    it('completes a recovered truncation as a normal success', async () => {
      await adapter.startSession('work-session', 'Write the long report', {
        sessionMode: 'work',
        workspaceRoot: createTemporaryWorkspace(),
      });

      truncatedAnswer('Long answer part one ');
      completeAnswer('Long answer part two');
      listener!({ type: 'agent_end' });

      const detail = service.getCurrent('work-session')!;
      expect(detail.task.status).toBe(WorkbenchTaskStatus.Completed);
      expect(currentRun()!.status).toBe(WorkbenchRunStatus.Succeeded);
      expect(
        mockStore.addMessage.mock.calls.some(
          ([, message]) => (message as { metadata?: Record<string, unknown> }).metadata
            ?.answerTruncated === true,
        ),
      ).toBe(false);
      expect(completes).toEqual(['work-session']);
    });

    it('does not flag an unclean stream for a plain successful answer', async () => {
      await adapter.startSession('work-session', 'Write the report', {
        sessionMode: 'work',
        workspaceRoot: createTemporaryWorkspace(),
      });

      completeAnswer('Full answer');
      listener!({ type: 'agent_end' });

      const detail = service.getCurrent('work-session')!;
      expect(detail.task.status).toBe(WorkbenchTaskStatus.Completed);
      expect(currentRun()!.status).toBe(WorkbenchRunStatus.Succeeded);
    });

    it('discloses a terminal truncation even when a queued follow-up drains at agent_end', async () => {
      await adapter.startSession('work-session', 'Write the long report', {
        sessionMode: 'work',
        workspaceRoot: createTemporaryWorkspace(),
      });

      // First truncated answer queues the (bounded) continuation steer; the
      // second exhausts the budget, so the final answer stays truncated.
      truncatedAnswer('First truncated attempt ');
      const queued = adapter.enqueuePendingMessage('work-session', 'Then summarize it');
      expect(queued.success).toBe(true);
      truncatedAnswer('Second truncated attempt');

      listener!({ type: 'agent_end' });

      // The disclosure is persisted synchronously on the agent_end path even
      // though the queued follow-up continues the turn.
      const disclosureIndex = mockStore.addMessage.mock.calls.findIndex(
        ([, message]) =>
          (message as { metadata?: { answerTruncated?: boolean } }).metadata?.answerTruncated ===
          true,
      );
      expect(disclosureIndex).toBeGreaterThanOrEqual(0);

      // The queued follow-up is flushed and takes over the turn, so the run
      // settles later by its own outcome (no complete event yet).
      await vi.waitFor(() => {
        expect(hoisted.mockSession.prompt).toHaveBeenCalledWith('Then summarize it', {
          streamingBehavior: 'followUp',
        });
      });
      expect(completes).toEqual([]);

      // The disclosure landed before the follow-up prompt went out.
      const followUpPromptIndex = hoisted.mockSession.prompt.mock.calls.findIndex(
        ([text]) => text === 'Then summarize it',
      );
      expect(
        mockStore.addMessage.mock.invocationCallOrder[disclosureIndex],
      ).toBeLessThan(hoisted.mockSession.prompt.mock.invocationCallOrder[followUpPromptIndex]);

      // The follow-up turn then settles the session exactly once, by its own
      // (clean) outcome.
      completeAnswer('The summary');
      listener!({ type: 'agent_end' });
      expect(completes).toEqual(['work-session']);
      const detail = service.getCurrent('work-session')!;
      expect(detail.task.status).toBe(WorkbenchTaskStatus.Completed);
      expect(currentRun()!.status).toBe(WorkbenchRunStatus.Succeeded);
    });

    it('settles a deferred truncation when the drain leaves no running turn (queued-control shape)', async () => {
      await adapter.startSession('work-session', 'Write the long report', {
        sessionMode: 'work',
        workspaceRoot: createTemporaryWorkspace(),
      });

      // Post-merge shape of the follow-up drain (see #760): the agent_end
      // drain branch ran — disclosure persisted, settlement deferred — and
      // the queue then drained WITHOUT starting another turn (queued control
      // actions never call prompt()). Without the deferred settlement the
      // turn would hang Running forever and never emit complete. Reproduce
      // the drain branch's deferred state directly on a fresh, never-settled
      // run so the assertions below can only be satisfied by the deferred
      // settlement itself.
      const internals = adapter as unknown as {
        activeSessions: Map<
          string,
          {
            deferredTurnSettlement: { truncated: boolean } | null;
            isRunning: boolean;
          }
        >;
        flushFollowUpQueue: (sessionId: string, active: unknown) => Promise<void>;
      };
      const active = internals.activeSessions.get('work-session')!;
      truncatedAnswer('Truncated with a drained control-action queue');
      active.isRunning = false;
      active.deferredTurnSettlement = { truncated: true };
      expect(completes).toEqual([]);

      await internals.flushFollowUpQueue('work-session', active);

      // The deferred settlement fired: complete event, idle session, and the
      // run lands on needs_review with the stream check failed.
      expect(completes).toEqual(['work-session']);
      expect(mockStore.updateSession).toHaveBeenCalledWith('work-session', { status: 'idle' });
      const detail = service.getCurrent('work-session')!;
      expect(detail.task.status).toBe(WorkbenchTaskStatus.NeedsReview);
      const run = currentRun()!;
      expect(run.status).toBe(WorkbenchRunStatus.NeedsReview);
      expect(
        run.verificationResult?.checks.some(
          (check: { name: string; status: string }) =>
            check.name === 'stream_closed_cleanly' && check.status === 'failed',
        ),
      ).toBe(true);
    });
  });

  describe('chat contract terminal state (real service)', () => {
    let db: InstanceType<typeof Database>;
    let service: RealWorkbenchTaskService;

    const currentRun = () => {
      const detail = service.getCurrent('chat-session')!;
      expect(detail).not.toBeNull();
      return (
        detail.runs.find(candidate => candidate.id === detail.task.activeRunId) ??
        detail.runs[detail.runs.length - 1] ??
        null
      );
    };

    beforeEach(() => {
      db = new Database(':memory:');
      initializeWorkbenchTaskSchema(db);
      initializeProductionLoopSchema(db);
      service = new RealWorkbenchTaskService(db);
      adapter.setWorkbenchTaskService(service);
    });

    afterEach(() => {
      db.close();
    });

    it('settles a disclosed Chat truncation as needs_review with stream_closed_cleanly failed', async () => {
      await adapter.startSession('chat-session', 'Tell me the long story', {
        sessionMode: 'chat',
      });

      truncatedAnswer('First truncated attempt ');
      truncatedAnswer('Second truncated attempt');
      listener!({ type: 'agent_end' });

      // The chat baseline includes stream_closed_cleanly, so a disclosed
      // truncation must never settle the Chat run as succeeded.
      const detail = service.getCurrent('chat-session')!;
      expect(detail.task.contract.kind).toBe('chat');
      expect(detail.task.status).toBe(WorkbenchTaskStatus.NeedsReview);
      expect(currentRun()!.status).toBe(WorkbenchRunStatus.NeedsReview);
      expect(currentRun()!.verificationResult?.outcome).toBe('failed');
      expect(
        currentRun()!.verificationResult?.checks.some(
          (check: { name: string; status: string }) =>
            check.name === 'stream_closed_cleanly' && check.status === 'failed',
        ),
      ).toBe(true);

      // The session itself stays idle and continuable, with the disclosure
      // persisted for the user.
      expect(mockStore.updateSession).toHaveBeenCalledWith('chat-session', { status: 'idle' });
      expect(completes).toEqual(['chat-session']);
      expect(
        mockStore.addMessage.mock.calls.some(
          ([, message]) =>
            (message as { metadata?: Record<string, unknown> }).metadata?.answerTruncated === true,
        ),
      ).toBe(true);
    });
  });
});
