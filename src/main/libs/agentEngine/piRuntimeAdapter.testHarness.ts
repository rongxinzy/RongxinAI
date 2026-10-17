/**
 * Shared harness for the PiRuntimeAdapter test suites.
 *
 * Owns the Pi SDK module mocks, the per-file adapter lifecycle (fresh adapter,
 * test gateway, temporary workspaces), and the capability-resolution helpers
 * every suite drives the adapter through. Test files must import this module
 * BEFORE importing anything that transitively loads the mocked modules, so the
 * mocks are registered first.
 */

import * as fs from 'fs';
import * as os from 'os';
import path from 'path';

import { afterEach, beforeEach, vi } from 'vitest';
import {
  installTestMagpie,
  type TestMagpieGateway,
} from '../../../../tests/helpers/installTestMagpie';
import { ModelCapabilityStatus } from '../../../shared/providers';
import { collectWorkbenchArtifacts } from '../../workbenchTask/artifactCollector';
import {
  runTextWorkerOperation,
  type TextWorkerInput,
} from '../../workbenchTask/textWorkerOperations';

vi.mock('../../workbenchTask/artifactWorkerPool', () => ({
  collectWorkbenchArtifactsAsync: async (input: Parameters<typeof collectWorkbenchArtifacts>[0]) =>
    collectWorkbenchArtifacts(input),
  transformCoworkTextAsync: async (input: TextWorkerInput) => runTextWorkerOperation(input),
}));

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
    bindExtensions: vi.fn().mockResolvedValue(undefined),
    getContextUsage: vi.fn(),
    compact: vi.fn().mockResolvedValue({ cancelled: false }),
    subscribe: vi.fn().mockReturnValue(() => {}),
  };

  const mockSettingsManagerCreate = vi.fn((cwd: string, agentDir?: string) => ({
    cwd,
    agentDir,
    applyOverrides: vi.fn(),
    getShellPath: vi.fn(),
  }));
  const mockSettingsManagerInMemory = vi.fn(() => ({
    applyOverrides: vi.fn(),
    getShellPath: vi.fn(),
  }));
  const mockSessionManagerInMemory = vi.fn((cwd?: string) => ({ cwd }));
  const mockCompleteSimple = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'Hello from Pi' }],
    stopReason: 'stop',
  });

  return {
    mockSession,
    mockSettingsManagerCreate,
    mockSettingsManagerInMemory,
    mockSessionManagerInMemory,
    mockCreateAgentSession: vi.fn().mockResolvedValue({ session: mockSession }),
    mockDefaultResourceLoader: vi.fn(function (this: { reload: () => Promise<void> }) {
      this.reload = vi.fn().mockResolvedValue(undefined);
    }),
    mockGetAgentDir: vi.fn(() => '/tmp/pi-agent'),
    mockCreateCodemodeExtension: vi.fn(() => 'codemode-extension-factory'),
    mockCreateMcpExtension: vi.fn(() => 'mcp-extension-factory'),
    mockCreateToolSearchExtension: vi.fn(() => 'tool-search-extension-factory'),
    mockApplyApplicationRuntimeEnv: vi.fn(),
    mockCompleteSimple,
    mockGetModel: vi.fn((provider: string, modelId: string) => ({
      provider,
      id: modelId,
      baseUrl:
        provider === 'openai'
          ? 'https://api.openai.com/v1'
          : provider === 'moonshotai-cn'
            ? 'https://api.moonshot.cn/v1'
            : undefined,
    })),
    mockModelRuntime: {
      registerProvider: vi.fn(),
      setRuntimeApiKey: vi.fn().mockResolvedValue(undefined),
      getModel: vi.fn(),
      completeSimple: mockCompleteSimple,
    },
    mockModelRuntimeCreate: vi.fn(),
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
        capabilities: { toolCalling: ModelCapabilityStatus.Supported },
        contextWindow: 32768,
        contextTokens: 32768,
        maxTokens: 4096,
      },
    })),
    mockResolveRawApiConfigForModelRef: vi.fn((modelRef: string) => {
      const [providerName = 'llamacpp', modelName = modelRef] = modelRef.includes('/')
        ? modelRef.split('/')
        : ['llamacpp', modelRef];

      if (providerName === 'openai') {
        return {
          config: {
            apiKey: 'sk-openai',
            baseURL: 'https://api.openai.com/v1',
            model: modelName,
            apiType: 'openai' as const,
          },
          providerMetadata: {
            providerName: 'openai',
            codingPlanEnabled: false,
            supportsImage: true,
            modelName,
            contextWindow: 272000,
            contextTokens: 272000,
            maxTokens: 16384,
          },
        };
      }

      if (providerName === 'moonshot') {
        return {
          config: {
            apiKey: 'sk-moonshot',
            baseURL: 'http://172.18.5.179:3000/v1',
            model: modelName,
            apiType: 'openai' as const,
          },
          providerMetadata: {
            providerName: 'moonshot',
            codingPlanEnabled: false,
            supportsImage: true,
            modelName,
            contextWindow: 262144,
            contextTokens: 262144,
            maxTokens: 32768,
          },
        };
      }

      return {
        config: {
          apiKey: 'sk-test',
          baseURL: 'http://127.0.0.1:11434/v1',
          model: modelName,
          apiType: 'openai' as const,
        },
        providerMetadata: {
          providerName,
          codingPlanEnabled: false,
          supportsImage: false,
          modelName,
          capabilities: { toolCalling: ModelCapabilityStatus.Supported },
          contextWindow: 32768,
          contextTokens: 32768,
          maxTokens: 4096,
        },
      };
    }),
  };
});

// ── Mocks ──

export const mockSession = hoisted.mockSession;
export const mockCreateAgentSession = hoisted.mockCreateAgentSession;
export const mockDefaultResourceLoader = hoisted.mockDefaultResourceLoader;
export const mockSettingsManagerCreate = hoisted.mockSettingsManagerCreate;
export const mockSettingsManagerInMemory = hoisted.mockSettingsManagerInMemory;
export const mockSessionManagerInMemory = hoisted.mockSessionManagerInMemory;
export const mockGetModel = hoisted.mockGetModel;
export const mockModelRuntime = hoisted.mockModelRuntime;
const mockModelRuntimeCreate = hoisted.mockModelRuntimeCreate;
export const mockCreateMcpExtension = hoisted.mockCreateMcpExtension;
export const mockApplyApplicationRuntimeEnv = hoisted.mockApplyApplicationRuntimeEnv;
export const mockCompleteSimple = hoisted.mockCompleteSimple;

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
  createCodemodeExtension: hoisted.mockCreateCodemodeExtension,
  createToolSearchExtension: hoisted.mockCreateToolSearchExtension,
  createMcpExtension: hoisted.mockCreateMcpExtension,
}));

vi.mock('@earendil-works/pi-ai/compat', () => ({
  getModel: hoisted.mockGetModel,
  completeSimple: hoisted.mockCompleteSimple,
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
import { clearImageInputObservations } from './piImageInputFallback';

/**
 * The adapter under test for the current spec.
 *
 * Reassigned by `setupPiRuntimeAdapterSuite`'s `beforeEach`, so specs must only
 * read it inside test bodies, never at module scope.
 */
export let adapter: PiRuntimeAdapter;

/**
 * The gateway double backing model resolution for the current spec.
 *
 * Reassigned by `setupPiRuntimeAdapterSuite`'s `beforeEach`; same scoping rule
 * as `adapter`.
 */
let testMagpie: TestMagpieGateway;

let disposeMagpie: (() => void) | undefined;

const temporaryWorkspaceRoots = new Set<string>();

/** Create a real temporary workspace, removed by the suite's `afterEach`. */
export const createTemporaryWorkspace = (): string => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-runtime-'));
  temporaryWorkspaceRoots.add(workspaceRoot);
  return workspaceRoot;
};

/**
 * Register the shared adapter lifecycle: fresh mocks, gateway, and adapter per
 * spec, plus workspace cleanup afterwards. Call once at the top of each
 * `describe('PiRuntimeAdapter')` body.
 */
export const setupPiRuntimeAdapterSuite = (): void => {
  beforeEach(() => {
    mockApplyApplicationRuntimeEnv.mockClear();
    vi.clearAllMocks();
    // Runtime image observations are process-wide state; reset per test so cases
    // cannot leak a suppression into the next one.
    clearImageInputObservations();
    mockModelRuntimeCreate.mockResolvedValue(mockModelRuntime);
    disposeMagpie?.();
    testMagpie = installTestMagpie();
    disposeMagpie = () => testMagpie.dispose();
    adapter = new PiRuntimeAdapter();
  });

  afterEach(() => {
    for (const workspaceRoot of temporaryWorkspaceRoots) {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
    temporaryWorkspaceRoots.clear();
    disposeMagpie?.();
    disposeMagpie = undefined;
  });
};

/**
 * Pin the resolution every capability read sees, and return a restore function.
 *
 * Capability reads happen at several points (model resolution, send gates,
 * capability sync), so counting `mockReturnValueOnce` values would make these
 * cases depend on call order.
 */
export const applyTestResolution = (resolution: {
  config?: { model?: string; apiKey?: string; baseURL?: string; apiType?: string };
  providerMetadata?: {
    providerName?: string;
    codingPlanEnabled?: boolean;
    supportsImage?: boolean;
    modelName?: string;
    contextWindow?: number;
    contextTokens?: number;
    maxTokens?: number;
    capabilities?: { imageInput?: ModelCapabilityStatus; toolCalling?: ModelCapabilityStatus };
  };
}): void => {
  const id = resolution.config?.model || testMagpie.defaultModelId;
  testMagpie.upsert(id, {
    ...(resolution.providerMetadata?.contextWindow
      ? { context_window: resolution.providerMetadata.contextWindow }
      : {}),
    ...(resolution.providerMetadata?.maxTokens
      ? { max_output_tokens: resolution.providerMetadata.maxTokens }
      : {}),
  });
  const image = resolution.providerMetadata?.capabilities?.imageInput;
  if (image === ModelCapabilityStatus.Supported) testMagpie.setImage(id, true);
  else if (image === ModelCapabilityStatus.Unsupported) testMagpie.setImage(id, false);
  else testMagpie.setImage(id, 'unknown');
  testMagpie.defaultModelId = id;
};

export const stubRawApiConfig = (resolution: {
  config?: { model?: string };
  providerMetadata?: {
    contextWindow?: number;
    maxTokens?: number;
    capabilities?: { imageInput?: ModelCapabilityStatus };
  };
}): (() => void) => {
  const previousDefault = testMagpie.defaultModelId;
  applyTestResolution(resolution);
  return () => {
    testMagpie.defaultModelId = previousDefault;
  };
};

/**
 * Pi model of a live session, for capability assertions.
 *
 * A model that cannot read images must not advertise image input: Pi then
 * downgrades every image block (attachments, `read` results, history) to a text
 * placeholder, so no image can re-enter a rejected request.
 */
export const activePiModel = (
  target: PiRuntimeAdapter,
  sessionId: string,
): Record<string, unknown> | undefined => {
  const sessions = (
    target as unknown as { activeSessions: Map<string, { model: Record<string, unknown> }> }
  ).activeSessions;
  return sessions.get(sessionId)?.model;
};

/** A configuration whose image input is unknown, for capability-change cases. */
export const UNKNOWN_MODEL_RESOLUTION = {
  config: {
    apiKey: 'sk-unknown',
    baseURL: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2.6',
    apiType: 'openai' as const,
  },
  providerMetadata: {
    providerName: 'moonshot',
    codingPlanEnabled: false,
    supportsImage: false,
    capabilities: { imageInput: ModelCapabilityStatus.Unknown },
  },
};

/** A configuration the user explicitly marked as text-only. */
export const TEXT_ONLY_MODEL_RESOLUTION = {
  config: {
    apiKey: 'sk-text',
    baseURL: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2.6',
    apiType: 'openai' as const,
  },
  providerMetadata: {
    providerName: 'moonshot',
    codingPlanEnabled: false,
    supportsImage: false,
    capabilities: { imageInput: ModelCapabilityStatus.Unsupported },
  },
};

/** The gateway's rejection of a request whose payload carried an image. */
export const VISION_400 =
  '400: {"message":"this server was started without the vision encoder (run setup again and choose \'vision\'), so it cannot read images"}';

/** A vision-capable provider resolution, reused by the session-sync cases. */
export const VISION_MODEL_RESOLUTION = {
  config: {
    apiKey: 'sk-vision',
    baseURL: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2.6',
    apiType: 'openai' as const,
  },
  providerMetadata: {
    providerName: 'moonshot',
    codingPlanEnabled: false,
    supportsImage: true,
    capabilities: { imageInput: ModelCapabilityStatus.Supported },
  },
};
