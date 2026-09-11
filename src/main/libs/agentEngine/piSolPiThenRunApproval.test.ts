/**
 * Real-wiring approval tests for SoL-Pi fused `then_run` commands.
 *
 * Drives the actual PiRuntimeAdapter with the conservative profile enabled and
 * a real WorkbenchTaskService (in-memory SQLite). The Pi SDK session/loader are
 * mocked only at the process boundary; the extension factories the adapter
 * hands to the resource loader are registered on a FakeExtensionApi that
 * mirrors Pi's emitToolCall semantics (first blocking handler wins), so the
 * full chain — approval gate → bash static screen → then_run guard — runs with
 * real store and real approval records.
 */

import * as fs from 'fs';
import * as os from 'os';
import path from 'path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SOLPI_PROFILE_ENV, SolPiProfile } from '../solPi/solPiProfile';
import { FakeExtensionApi } from '../solPi/solPiTestFixtures';
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

interface LoaderOptions {
  extensionFactories?: Array<(api: unknown) => void>;
}

describe('PiRuntimeAdapter fused then_run authorization wiring', () => {
  let adapter: PiRuntimeAdapter;
  let mockStore: {
    updateSession: ReturnType<typeof vi.fn>;
    updateMessage: ReturnType<typeof vi.fn>;
    addMessage: ReturnType<typeof vi.fn>;
    getSession: ReturnType<typeof vi.fn>;
    getAgent: ReturnType<typeof vi.fn>;
    listAgents: ReturnType<typeof vi.fn>;
    refreshSessionArtifacts: ReturnType<typeof vi.fn>;
  };
  let permissionRequests: Array<{
    requestId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
  }>;
  const temporaryWorkspaceRoots = new Set<string>();
  const createTemporaryWorkspace = (): string => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-thenrun-'));
    temporaryWorkspaceRoots.add(workspaceRoot);
    return workspaceRoot;
  };

  /** Register every factory the adapter passed to the resource loader. */
  const buildExtensionApi = (): FakeExtensionApi => {
    const api = new FakeExtensionApi();
    for (const call of hoisted.mockDefaultResourceLoader.mock.calls) {
      const options = (call[0] ?? {}) as LoaderOptions;
      for (const factory of options.extensionFactories ?? []) {
        factory(api as never);
      }
    }
    return api;
  };

  const fusedWriteInput = (file: string, command: string) => ({
    path: file,
    content: 'fused payload',
    then_run: { command },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockModelRuntimeCreate.mockResolvedValue(hoisted.mockModelRuntime);
    process.env[SOLPI_PROFILE_ENV] = SolPiProfile.Conservative;
    adapter = new PiRuntimeAdapter();
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
    permissionRequests = [];
    adapter.on('permissionRequest', (_sid, request) => permissionRequests.push(request));
  });

  afterEach(() => {
    delete process.env[SOLPI_PROFILE_ENV];
    for (const workspaceRoot of temporaryWorkspaceRoots) {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
    temporaryWorkspaceRoots.clear();
  });

  describe('with an active workbench run (Ask mode)', () => {
    let db: InstanceType<typeof Database>;
    let service: RealWorkbenchTaskService;

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

    it('routes the embedded command through its own bash authorization after the edit approval', async () => {
      await adapter.startSession('thenrun-session', 'Patch the file and verify', {
        sessionMode: 'work',
        workspaceRoot: createTemporaryWorkspace(),
      });
      const api = buildExtensionApi();

      const decision = api.emitToolCall({
        toolCallId: 'fused-1',
        toolName: 'write',
        input: fusedWriteInput('out.txt', 'echo fused-ran'),
      });

      // The fused write approval comes first; the then_run command has its own
      // separate bash approval (guard ordered after the approval gate).
      await vi.waitFor(() => expect(permissionRequests).toHaveLength(1));
      expect(permissionRequests[0].toolName).toBe('write');
      adapter.respondToPermission(permissionRequests[0].requestId, { behavior: 'allow' });

      await vi.waitFor(() => expect(permissionRequests).toHaveLength(2));
      expect(permissionRequests[1].toolName).toBe('bash');
      expect(permissionRequests[1].toolInput).toEqual({
        command: 'echo fused-ran',
      });
      expect(permissionRequests[1]).toMatchObject({ toolUseId: 'fused-1:then_run' });

      // A durable approval record exists for the embedded command.
      const approvalRow = db
        .prepare('SELECT tool_name, tool_call_id FROM workbench_approvals')
        .all() as Array<{ tool_name: string; tool_call_id: string }>;
      expect(approvalRow).toContainEqual({
        tool_name: 'bash',
        tool_call_id: 'fused-1:then_run',
      });

      // Denying the command blocks the whole fused call.
      adapter.respondToPermission(permissionRequests[1].requestId, {
        behavior: 'deny',
        message: 'Not on my machine.',
      });
      await expect(decision).resolves.toEqual({
        block: true,
        reason: 'Not on my machine.',
      });
    });

    it('lets an approved fused call continue', async () => {
      await adapter.startSession('thenrun-session', 'Patch the file and verify', {
        sessionMode: 'work',
        workspaceRoot: createTemporaryWorkspace(),
      });
      const api = buildExtensionApi();

      const decision = api.emitToolCall({
        toolCallId: 'fused-2',
        toolName: 'write',
        input: fusedWriteInput('out.txt', 'echo fused-ran'),
      });
      await vi.waitFor(() => expect(permissionRequests).toHaveLength(1));
      adapter.respondToPermission(permissionRequests[0].requestId, { behavior: 'allow' });
      await vi.waitFor(() => expect(permissionRequests).toHaveLength(2));
      adapter.respondToPermission(permissionRequests[1].requestId, { behavior: 'allow' });

      await expect(decision).resolves.toBeUndefined();
    });

    it('blocks the fused call before the guard when the write approval itself is denied', async () => {
      await adapter.startSession('thenrun-session', 'Patch the file and verify', {
        sessionMode: 'work',
        workspaceRoot: createTemporaryWorkspace(),
      });
      const api = buildExtensionApi();

      const decision = api.emitToolCall({
        toolCallId: 'fused-3',
        toolName: 'write',
        input: fusedWriteInput('out.txt', 'echo fused-ran'),
      });
      await vi.waitFor(() => expect(permissionRequests).toHaveLength(1));
      adapter.respondToPermission(permissionRequests[0].requestId, {
        behavior: 'deny',
        message: 'Wrong file.',
      });

      const blocked = await decision;
      expect(blocked).toEqual({ block: true, reason: 'Wrong file.' });
      // The guard never ran: no bash approval was requested for the command.
      expect(permissionRequests).toHaveLength(1);
    });

    it('resolves a pending then_run approval as denied when the user stops the session', async () => {
      await adapter.startSession('thenrun-session', 'Patch the file and verify', {
        sessionMode: 'work',
        workspaceRoot: createTemporaryWorkspace(),
      });
      const api = buildExtensionApi();

      const decision = api.emitToolCall({
        toolCallId: 'fused-4',
        toolName: 'write',
        input: fusedWriteInput('out.txt', 'echo fused-ran'),
      });
      await vi.waitFor(() => expect(permissionRequests).toHaveLength(1));
      adapter.respondToPermission(permissionRequests[0].requestId, { behavior: 'allow' });
      await vi.waitFor(() => expect(permissionRequests).toHaveLength(2));

      // User stop while the bash approval is pending: the pending authorization
      // must settle as a denial (pauseRun expires it) instead of hanging the
      // tool_call handler forever.
      adapter.stopSession('thenrun-session');
      const blocked = await decision;
      expect(blocked?.block).toBe(true);
      expect(blocked?.reason).toBeTruthy();
    });
  });

  describe('without a workbench run', () => {
    it('applies only the static bash safety screen, matching bare bash behavior', async () => {
      await adapter.startSession('thenrun-norun', 'Patch the file', {
        sessionMode: 'work',
        workspaceRoot: createTemporaryWorkspace(),
      });
      const api = buildExtensionApi();

      // No approval gate is installed without a run; a clean then_run command
      // passes the same way a bare bash call would.
      const fused = await api.emitToolCall({
        toolCallId: 'fused-5',
        toolName: 'write',
        input: fusedWriteInput('out.txt', 'echo clean'),
      });
      expect(fused).toBeUndefined();

      const bare = await api.emitToolCall({
        toolCallId: 'bare-1',
        toolName: 'bash',
        input: { command: 'echo clean' },
      });
      expect(bare).toBeUndefined();

      // A malformed then_run payload is still rejected by the guard itself.
      const malformed = await api.emitToolCall({
        toolCallId: 'fused-6',
        toolName: 'write',
        input: { path: 'out.txt', content: 'x', then_run: { command: 42 } },
      });
      expect(malformed).toEqual({
        block: true,
        reason: 'then_run.command must be a non-empty string.',
      });
    });
  });
});
