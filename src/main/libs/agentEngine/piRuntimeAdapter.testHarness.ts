/** Application boundary doubles; native Durable execution has separate integration tests. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { ToolTask, type ToolHooks } from '@earendil-works/pi-durable';
import { afterEach, beforeEach, vi } from 'vitest';
import {
  installTestMagpie,
  type TestMagpieGateway,
} from '../../../../tests/helpers/installTestMagpie';
import { ModelCapabilityStatus } from '../../../shared/providers';
import {
  runTextWorkerOperation,
  type TextWorkerInput,
} from '../../workbenchTask/textWorkerOperations';

vi.mock('../../workbenchTask/artifactWorkerPool', () => ({
  transformCoworkTextAsync: async (input: TextWorkerInput) => runTextWorkerOperation(input),
}));

const doubles = vi.hoisted(() => {
  const session = {
    prompt: vi.fn().mockResolvedValue(undefined),
    sendUserMessage: vi.fn().mockResolvedValue(undefined),
    steer: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    abortBash: vi.fn(),
    dispose: vi.fn(),
    clearQueue: vi.fn(() => ({ steering: [], followUp: [] })),
    reload: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    setThinkingLevel: vi.fn().mockResolvedValue(undefined),
    getContextUsage: vi.fn(),
    compact: vi.fn().mockResolvedValue({ cancelled: false }),
    subscribe: vi.fn().mockReturnValue(() => {}),
    getSessionStats: vi.fn().mockReturnValue({
      sessionId: 'test-session',
      userMessages: 2,
      assistantMessages: 2,
      toolCalls: 1,
      toolResults: 1,
      totalMessages: 6,
      tokens: { input: 1200, output: 450, cacheRead: 300, cacheWrite: 100, total: 2050 },
      cost: 0.015,
      contextUsage: { percent: 12.5 },
    }),
    navigateTree: vi.fn().mockResolvedValue({ editorText: 'rewound text', cancelled: false }),
    appendContextEdit: vi.fn().mockResolvedValue('edit-entry-uuid-1'),
  };
  const completeSimple = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'Hello from Pi' }],
    stopReason: 'stop',
  });
  return {
    session,
    createSession: vi.fn().mockResolvedValue({ session }),
    createResources: vi.fn(),
    createCatalog: vi.fn(),
    catalog: {
      registerProvider: vi.fn(),
      setRuntimeApiKey: vi.fn().mockResolvedValue(undefined),
      getModel: vi.fn(),
      completeSimple,
    },
    completeSimple,
    getModel: vi.fn(),
    applyRuntimeEnv: vi.fn(),
  };
});

vi.mock('./durableSession.mjs', () => ({ createDurableSession: doubles.createSession }));
vi.mock('./durableModelCatalog.mjs', () => ({
  DurableModelCatalog: { create: doubles.createCatalog },
}));
vi.mock('./piRuntimeResourceLoader', async importOriginal => {
  const actual = await importOriginal<typeof import('./piRuntimeResourceLoader')>();
  doubles.createResources.mockImplementation(actual.createPiRuntimeResourceLoader);
  return { ...actual, createPiRuntimeResourceLoader: doubles.createResources };
});
vi.mock('@earendil-works/pi-ai/compat', () => ({
  getModel: doubles.getModel,
  completeSimple: doubles.completeSimple,
}));
vi.mock('../coworkUtil', async importOriginal => ({
  ...(await importOriginal<typeof import('../coworkUtil')>()),
  applyApplicationRuntimeEnv: doubles.applyRuntimeEnv,
}));

import { PiRuntimeAdapter } from './piRuntimeAdapter';
import { clearImageInputObservations } from './piImageInputFallback';
import type { PiResourceLoader, PiResourceState } from './piRuntimeSessionState';

export const mockSession = doubles.session;
export const mockCreateAgentSession = doubles.createSession;
export const mockCreateResources = doubles.createResources;
export const mockModelRuntime = doubles.catalog;
export const mockApplyApplicationRuntimeEnv = doubles.applyRuntimeEnv;
export const mockCompleteSimple = doubles.completeSimple;
export let adapter: PiRuntimeAdapter;
let gateway: TestMagpieGateway;
let disposeGateway: (() => void) | undefined;
const temporaryRoots = new Set<string>();

export function createTemporaryWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'durable-adapter-'));
  temporaryRoots.add(root);
  return root;
}

export const createTemporaryPiSessionRoot = createTemporaryWorkspace;

export function setupPiRuntimeAdapterSuite(): void {
  beforeEach(() => {
    vi.clearAllMocks();
    clearImageInputObservations();
    doubles.createCatalog.mockResolvedValue(doubles.catalog);
    doubles.createSession.mockResolvedValue({ session: doubles.session });
    disposeGateway?.();
    gateway = installTestMagpie();
    disposeGateway = () => gateway.dispose();
    adapter = new PiRuntimeAdapter();
    adapter.setPiSessionStoreRoot(createTemporaryPiSessionRoot());
  });
  afterEach(async () => {
    for (const result of mockCreateResources.mock.results) {
      const resources = await Promise.resolve(result.value).catch(() => null);
      await resources?.close?.();
    }
    for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true });
    temporaryRoots.clear();
    disposeGateway?.();
    disposeGateway = undefined;
  });
}

export async function createdResources(index = 0): Promise<PiResourceLoader> {
  const result = mockCreateResources.mock.results.at(index);
  if (!result || result.type !== 'return') throw new Error('Resources were not created.');
  return await result.value;
}

export function createdResourceState(index = 0): PiResourceState {
  return mockCreateResources.mock.calls.at(index)![2] as PiResourceState;
}

export async function renderResourceSections(index = 0): Promise<Record<string, string>> {
  const resources = await createdResources(index);
  const sections: Record<string, string> = {};
  for (const extension of resources.extensions) {
    for (const section of extension.sections ?? []) {
      if (section.key !== 'plan_mode') continue;
      const value = await section.render({} as never, BACKGROUND_CONTEXT);
      if (value !== undefined) sections[section.key] = value;
    }
  }
  return sections;
}

export async function invokeBeforeTool(
  input: {
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
  },
  index = 0,
): Promise<{ block?: string } | undefined> {
  const resources = await createdResources(index);
  for (const extension of resources.extensions) {
    for (const registration of extension.hooks ?? []) {
      if (registration.task !== ToolTask.definition.name) continue;
      const hooks = registration.handlers as Partial<ToolHooks>;
      const decision = await hooks.beforeTool?.(
        {
          type: 'toolCall',
          id: input.toolCallId,
          name: input.toolName,
          arguments: input.input,
        },
        {} as never,
        BACKGROUND_CONTEXT,
      );
      if (decision?.block) return decision;
    }
  }
  return undefined;
}

export function applyTestResolution(resolution: {
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
}): void {
  const id = resolution.config?.model || gateway.defaultModelId;
  gateway.upsert(id, {
    ...(resolution.providerMetadata?.contextWindow
      ? { context_window: resolution.providerMetadata.contextWindow }
      : {}),
    ...(resolution.providerMetadata?.maxTokens
      ? { max_output_tokens: resolution.providerMetadata.maxTokens }
      : {}),
  });
  const image = resolution.providerMetadata?.capabilities?.imageInput;
  gateway.setImage(
    id,
    image === ModelCapabilityStatus.Supported
      ? true
      : image === ModelCapabilityStatus.Unsupported
        ? false
        : 'unknown',
  );
  gateway.defaultModelId = id;
}

export function stubRawApiConfig(
  resolution: Parameters<typeof applyTestResolution>[0],
): () => void {
  const previous = gateway.defaultModelId;
  applyTestResolution(resolution);
  return () => {
    gateway.defaultModelId = previous;
  };
}

export function activePiModel(target: PiRuntimeAdapter, sessionId: string) {
  return target.activeSessions.get(sessionId)?.model;
}

export const UNKNOWN_MODEL_RESOLUTION = {
  config: { model: 'kimi-k2.6' },
  providerMetadata: { capabilities: { imageInput: ModelCapabilityStatus.Unknown } },
};
export const TEXT_ONLY_MODEL_RESOLUTION = {
  config: { model: 'kimi-k2.6' },
  providerMetadata: { capabilities: { imageInput: ModelCapabilityStatus.Unsupported } },
};
export const VISION_MODEL_RESOLUTION = {
  config: { model: 'kimi-k2.6' },
  providerMetadata: { capabilities: { imageInput: ModelCapabilityStatus.Supported } },
};
export const VISION_400 =
  '400: {"message":"this server was started without the vision encoder (run setup again and choose \'vision\'), so it cannot read images"}';
