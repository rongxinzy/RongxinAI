import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { LlamaCppServiceConfig } from '../../shared/llamacpp';
import { LlamaCppOrchestrator } from '../../shared/llamacpp';
import { ModelCapabilityStatus, parseLlamaCppRuntimeCapabilities } from '../../shared/providers';
import { buildLlamaCppRunningModelBinding } from './llamacppAgentBinding';
import { LlamaCppClient } from './llamacppClient';
import { buildLlamaCppExecutableCandidates } from './llamacppManager';
import { resolveSiblingMmprojPath } from './llamacppModelInstallation';
import { LlamaCppRouterOrchestrator } from './llamacppRouterOrchestrator';
import {
  upsertLlamaCppRouterModelPresetSection,
  writeLlamaCppRouterPresetGlobalSection,
} from './llamacppRouterProcess';
import type { MagpieHostProvider } from '../magpie/hostProviders';
import { ManagedMagpieProviderBindings } from '../magpie/managedProviderBindings';
import { ZhiyuanManagedProviderBridge } from '../enterpriseExtension/managedProviderBridge';

/** 1×1 PNG (red pixel) for vision smoke. */
export const SMOKE_TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

type MemStore = Map<string, unknown>;

export type ProductPathSmokeContext = {
  workDir: string;
  modelsDir: string;
  presetPath: string;
  orchestrator: LlamaCppRouterOrchestrator;
  gatewayBaseUrl: string;
  routerClient: LlamaCppClient;
  executablePath: string;
};

export function resolveSmokeLlamaServerExecutable(rootDir = process.cwd()): string {
  const fromEnv = process.env.LLAMACPP_SMOKE_EXECUTABLE?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const candidates = buildLlamaCppExecutableCandidates({
    platform: process.platform,
    isPackaged: false,
    resourceRoot: path.join(rootDir, 'resources'),
    appRoot: rootDir,
    cwd: rootDir,
    userRuntimeRoot: path.join(os.homedir(), 'llamacpp-smoke'),
    envPath: process.env.LLAMACPP_PRODUCT_PATH_EXECUTABLE,
  });
  const executable = candidates.find(candidate => fs.existsSync(candidate));
  if (!executable) {
    throw new Error(
      'llama-server not found for smoke (set LLAMACPP_SMOKE_EXECUTABLE or vendor runtime)',
    );
  }
  return executable;
}

function modelIdFromFileName(fileName: string): string {
  return path.basename(fileName, path.extname(fileName));
}

export async function createProductPathSmokeContext(input: {
  rootDir: string;
  executablePath: string;
  textModelPath: string;
  visionModelPath?: string;
  visionMmprojPath?: string;
}): Promise<ProductPathSmokeContext> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-product-smoke-'));
  const modelsDir = path.join(workDir, 'models');
  const userDataPath = path.join(workDir, 'userdata');
  const presetPath = path.join(userDataPath, 'models-preset.ini');
  fs.mkdirSync(modelsDir, { recursive: true });
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(presetPath, 'version = 1\n\n', 'utf8');

  const textFileName = path.basename(input.textModelPath);
  const textDest = path.join(modelsDir, textFileName);
  fs.copyFileSync(input.textModelPath, textDest);
  const textModelId = modelIdFromFileName(textFileName);
  upsertLlamaCppRouterModelPresetSection({
    presetPath,
    modelName: textModelId,
    modelPath: textDest,
    options: { ctxSize: 512, gpuLayers: 0 },
  });

  if (input.visionModelPath) {
    const visionSubdir = path.join(modelsDir, 'vision-collocated');
    fs.mkdirSync(visionSubdir, { recursive: true });
    const visionFileName = path.basename(input.visionModelPath);
    const visionDest = path.join(visionSubdir, visionFileName);
    fs.copyFileSync(input.visionModelPath, visionDest);
    if (input.visionMmprojPath) {
      const mmprojFileName = path.basename(input.visionMmprojPath);
      fs.copyFileSync(input.visionMmprojPath, path.join(visionSubdir, mmprojFileName));
    }
    const visionModelId = modelIdFromFileName(visionFileName);
    const mmprojPath = resolveSiblingMmprojPath(visionDest);
    if (!mmprojPath) {
      throw new Error(
        'vision smoke requires co-located mmproj; copy visionMmproj fixture next to the LLM GGUF',
      );
    }
    upsertLlamaCppRouterModelPresetSection({
      presetPath,
      modelName: visionModelId,
      modelPath: visionDest,
      options: { ctxSize: 2048, gpuLayers: 0 },
    });
  }

  const store: MemStore = new Map();
  const serviceConfig: LlamaCppServiceConfig = {
    port: '0',
    modelsMax: '1',
    orchestrator: LlamaCppOrchestrator.Router,
    timeout: '600',
    ctxSize: 2048,
  };
  writeLlamaCppRouterPresetGlobalSection({ presetPath, config: serviceConfig });

  const orchestrator = new LlamaCppRouterOrchestrator({
    userDataPath,
    getStore: () => ({
      get: <T>(key: string) => store.get(key) as T | undefined,
      set: <T>(key: string, value: T) => {
        store.set(key, value);
      },
      delete: (key: string) => {
        store.delete(key);
      },
    }),
    getServiceConfig: () => serviceConfig,
    getModelsDir: () => modelsDir,
    getPresetPath: () => presetPath,
    resolveExecutable: async () => input.executablePath,
  });

  await orchestrator.status();
  const gatewayBaseUrl = orchestrator.gatewayBaseUrl();
  if (!gatewayBaseUrl) throw new Error('gateway did not start');
  const daemonStatus = await orchestrator.reconnect();
  const routerPort = daemonStatus?.modelProcesses?.[0]?.port;
  if (!routerPort) throw new Error('router control status missing port');
  const routerClient = new LlamaCppClient(`http://127.0.0.1:${routerPort}`, {
    loadTimeoutMs: 600_000,
  });

  return {
    workDir,
    modelsDir,
    presetPath,
    orchestrator,
    gatewayBaseUrl,
    routerClient,
    executablePath: input.executablePath,
  };
}

export async function refreshSmokeRouterClient(context: ProductPathSmokeContext): Promise<void> {
  const daemonStatus = await context.orchestrator.reconnect();
  const routerPort = daemonStatus?.modelProcesses?.[0]?.port;
  if (!routerPort) throw new Error('router control status missing port after refresh');
  context.routerClient = new LlamaCppClient(`http://127.0.0.1:${routerPort}`, {
    loadTimeoutMs: 600_000,
  });
  const gatewayBaseUrl = context.orchestrator.gatewayBaseUrl();
  if (!gatewayBaseUrl) throw new Error('gateway missing after refresh');
  context.gatewayBaseUrl = gatewayBaseUrl;
}

export async function destroyProductPathSmokeContext(
  context: ProductPathSmokeContext,
): Promise<void> {
  await context.orchestrator.shutdownForQuit().catch(() => undefined);
  fs.rmSync(context.workDir, { recursive: true, force: true });
}

export async function gatewayChatCompletion(input: {
  gatewayBaseUrl: string;
  model: string;
  stream: boolean;
  maxTokens?: number;
  messages: unknown[];
  signal?: AbortSignal;
}): Promise<Response> {
  return await fetch(`${input.gatewayBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: input.model,
      stream: input.stream,
      max_tokens: input.maxTokens ?? 16,
      messages: input.messages,
    }),
    signal: input.signal,
  });
}

export async function readStreamingAssistantText(
  response: Response,
  signal?: AbortSignal,
): Promise<string> {
  if (!response.body) throw new Error('stream response missing body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (true) {
    if (signal?.aborted) {
      await reader.cancel();
      throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    }
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        text += json.choices?.[0]?.delta?.content ?? '';
      } catch {
        // ignore parse errors on partial lines
      }
    }
  }
  return text;
}

export async function assertGatewayTextSmoke(input: {
  gatewayBaseUrl: string;
  modelId: string;
}): Promise<void> {
  const streamResponse = await gatewayChatCompletion({
    gatewayBaseUrl: input.gatewayBaseUrl,
    model: input.modelId,
    stream: true,
    maxTokens: 24,
    messages: [{ role: 'user', content: 'Reply with one short English word only.' }],
  });
  if (!streamResponse.ok) {
    const body = await streamResponse.text().catch(() => '');
    throw new Error(`gateway stream failed: HTTP ${streamResponse.status} ${body}`);
  }
  const streamText = await readStreamingAssistantText(streamResponse);
  if (!streamText.trim()) {
    throw new Error('gateway stream returned empty assistant content');
  }

  const cancelController = new AbortController();
  const cancelResponse = await gatewayChatCompletion({
    gatewayBaseUrl: input.gatewayBaseUrl,
    model: input.modelId,
    stream: true,
    maxTokens: 32,
    messages: [{ role: 'user', content: 'Count: 1 2 3' }],
    signal: cancelController.signal,
  });
  if (!cancelResponse.ok) {
    throw new Error(`second gateway stream failed: HTTP ${cancelResponse.status}`);
  }
  setTimeout(() => cancelController.abort(), 50);
  await readStreamingAssistantText(cancelResponse, cancelController.signal).catch(error => {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    throw error;
  });

  const followUp = await gatewayChatCompletion({
    gatewayBaseUrl: input.gatewayBaseUrl,
    model: input.modelId,
    stream: false,
    maxTokens: 8,
    messages: [{ role: 'user', content: 'Say hi.' }],
  });
  if (!followUp.ok) {
    throw new Error(`post-cancel gateway request failed: HTTP ${followUp.status}`);
  }
  const payload = (await followUp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content?.trim() ?? '';
  if (!content) throw new Error('post-cancel non-stream completion was empty');
}

export async function assertVisionCapabilityChain(input: {
  gatewayBaseUrl: string;
  routerClient: LlamaCppClient;
  visionModelId: string;
}): Promise<{ magpieHasImageInput: boolean; propsVision: boolean }> {
  const warmup = await gatewayChatCompletion({
    gatewayBaseUrl: input.gatewayBaseUrl,
    model: input.visionModelId,
    stream: false,
    maxTokens: 4,
    messages: [{ role: 'user', content: 'hi' }],
  });
  if (!warmup.ok) {
    const body = await warmup.text().catch(() => '');
    throw new Error(`vision model warm load failed: HTTP ${warmup.status} ${body}`);
  }

  const props = await input.routerClient.showModel(input.visionModelId);
  const capabilities = parseLlamaCppRuntimeCapabilities(props);
  const propsVision = capabilities.imageInput === ModelCapabilityStatus.Supported;
  if (!propsVision) {
    throw new Error(
      `vision model /props did not report image capability: ${JSON.stringify(props).slice(0, 400)}`,
    );
  }

  const running = buildLlamaCppRunningModelBinding(
    { name: input.visionModelId, runtime_context_length: 2048 },
    { capabilities },
  );
  if (!running) throw new Error('failed to build running model binding');
  const binding = { ...running, supportsImage: true, capabilities };
  let magpieModels: Array<{ input?: readonly string[] }> = [];
  const sink = {
    syncHostProviders: async (providers: readonly MagpieHostProvider[]) => {
      magpieModels = providers.flatMap(provider => provider.models ?? []);
    },
  };
  const bindings = new ManagedMagpieProviderBindings(new ZhiyuanManagedProviderBridge(), sink);
  bindings.setGpuSnapshot(input.gatewayBaseUrl, [binding]);
  await bindings.synchronize();
  const magpieHasImageInput = magpieModels.some(model => model.input?.includes('image'));
  if (!magpieHasImageInput) {
    throw new Error('Magpie local GPU model did not expose image input after /props vision=true');
  }

  const imageResponse = await gatewayChatCompletion({
    gatewayBaseUrl: input.gatewayBaseUrl,
    model: input.visionModelId,
    stream: false,
    maxTokens: 16,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What color is this image? One word.' },
          {
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${SMOKE_TINY_PNG_BASE64}` },
          },
        ],
      },
    ],
  });
  if (!imageResponse.ok) {
    const body = await imageResponse.text().catch(() => '');
    throw new Error(`vision image chat failed: HTTP ${imageResponse.status} ${body}`);
  }
  const visionPayload = (await imageResponse.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  if (!visionPayload.choices?.[0]?.message?.content?.trim()) {
    throw new Error('vision image chat returned empty assistant content');
  }

  return { magpieHasImageInput, propsVision };
}
