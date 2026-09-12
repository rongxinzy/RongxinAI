/**
 * Adapter-level SoL-Pi wiring test (positive coverage, previously absent).
 *
 * With the conservative profile enabled and buildSolPiRuntime mocked at the
 * module boundary, this pins the adapter's contract with the integration
 * layer: the wrapped session manager reaches createAgentSession's options,
 * the extension factories are appended to the resource loader (after the
 * approval gate), authorizeThenRun is routed, and an assembly failure degrades
 * to running without SoL-Pi instead of failing the session.
 */
import * as fs from 'fs';
import * as os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SOLPI_PROFILE_ENV, SolPiProfile } from '../solPi/solPiProfile';
import type { CoworkStore } from '../../coworkStore';

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
    bindExtensions: vi.fn().mockResolvedValue(undefined),
  };
  const mockCompleteSimple = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'Hello from Pi' }],
    stopReason: 'stop',
  });
  const markerSessionManager = { getSessionDir: () => '/marker/solpi', getSessionId: () => 'marker' };
  const markerFactory = (): void => undefined;
  return {
    mockSession,
    markerSessionManager,
    markerFactory,
    mockBuildSolPiRuntime: vi.fn(),
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

vi.mock('../solPi/solPiIntegration', () => ({
  buildSolPiRuntime: hoisted.mockBuildSolPiRuntime,
}));

import { PiRuntimeAdapter } from './piRuntimeAdapter';

describe('PiRuntimeAdapter SoL-Pi wiring', () => {
  let adapter: PiRuntimeAdapter;
  let mockStore: Record<string, ReturnType<typeof vi.fn>>;
  const temporaryWorkspaceRoots = new Set<string>();

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
  });

  afterEach(() => {
    delete process.env[SOLPI_PROFILE_ENV];
    for (const workspaceRoot of temporaryWorkspaceRoots) {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
    temporaryWorkspaceRoots.clear();
  });

  const createTemporaryWorkspace = (): string => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-solpi-wiring-'));
    temporaryWorkspaceRoots.add(workspaceRoot);
    return workspaceRoot;
  };

  it('threads the wrapped session manager and extension factories into the Pi session', async () => {
    hoisted.mockBuildSolPiRuntime.mockResolvedValue({
      extensionFactories: [hoisted.markerFactory],
      sessionManager: hoisted.markerSessionManager,
      storageDir: '/marker/solpi',
    });

    await adapter.startSession('wiring-session', 'Do the work', {
      sessionMode: 'work',
      workspaceRoot: createTemporaryWorkspace(),
    });

    // The integration layer received the session identity and the then_run
    // authorizer under the conservative profile.
    expect(hoisted.mockBuildSolPiRuntime).toHaveBeenCalledTimes(1);
    const buildOptions = hoisted.mockBuildSolPiRuntime.mock.calls[0][0] as Record<string, unknown>;
    expect(buildOptions.sessionId).toBe('wiring-session');
    expect(buildOptions.cwd).toBeTruthy();
    expect(typeof buildOptions.userDataPath).toBe('string');
    expect(typeof buildOptions.authorizeThenRun).toBe('function');
    expect(buildOptions.profile).toBe(SolPiProfile.Conservative);

    // The wrapped manager replaced the plain in-memory manager in the
    // createAgentSession options.
    expect(hoisted.mockCreateAgentSession).toHaveBeenCalledTimes(1);
    const sessionOptions = hoisted.mockCreateAgentSession.mock.calls[0][0] as {
      sessionManager?: unknown;
    };
    expect(sessionOptions.sessionManager).toBe(hoisted.markerSessionManager);

    // The extension factories were appended to the resource loader (its
    // options carry the additional factory list, after the approval gate).
    const loaderFactories = hoisted.mockDefaultResourceLoader.mock.calls
      .map(call => ((call[0] as { extensionFactories?: unknown[] } | undefined)?.extensionFactories ?? []))
      .flat();
    expect(loaderFactories).toContain(hoisted.markerFactory);

    // The session bound the extensions (SoL-Pi registration path).
    expect(hoisted.mockSession.bindExtensions).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'print' }),
    );
  });

  it('degrades to running without SoL-Pi when assembly fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    hoisted.mockBuildSolPiRuntime.mockRejectedValue(new Error('vendor entry missing'));

    await adapter.startSession('wiring-session', 'Do the work', {
      sessionMode: 'work',
      workspaceRoot: createTemporaryWorkspace(),
    });

    // The plain in-memory manager stayed in place and the session started.
    expect(hoisted.mockCreateAgentSession).toHaveBeenCalledTimes(1);
    const sessionOptions = hoisted.mockCreateAgentSession.mock.calls[0][0] as {
      sessionManager?: unknown;
    };
    expect(sessionOptions.sessionManager).toBe(
      hoisted.mockSessionManagerInMemory.mock.results[0].value,
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('continuing without it'),
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });
});
