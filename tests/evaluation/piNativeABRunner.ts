import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { appendFileSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import {
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
} from '@earendil-works/pi-coding-agent';
import { expect, vi } from 'vitest';
import { CoworkStore } from '../../src/main/coworkStore';
import { getDefaultSystemPrompt } from '../../src/main/coworkStore/helpers';
import { composeCoworkSystemPrompt } from '../../src/main/coworkPrompt/composer';
import { buildMagpiePiModel } from '../../src/main/libs/agentEngine/piMagpiePiModel';
import {
  PiRuntimeAdapter,
  type PiRuntimeDependencies,
} from '../../src/main/libs/agentEngine/piRuntimeAdapter';
import { MAGPIE_RUNTIME_API_KEY } from '../../src/main/magpie/modelService';
import { SqliteStore } from '../../src/main/sqliteStore';
import { initializeWorkbenchTaskSchema } from '../../src/main/workbenchTask/schema';
import { WorkbenchTaskService } from '../../src/main/workbenchTask/taskService';
import { CoworkExecutionMode } from '../../src/shared/cowork/constants';
import { WorkbenchApprovalMode } from '../../src/shared/workbenchTask';
import { createTestMagpie } from '../helpers/createTestMagpie';
import {
  forwardRequest,
  type LivePiRequest,
  type LiveRequestTransform,
  type Provider,
  type RequestMetrics,
} from './piNativeABProvider';

export interface LiveFixture {
  prompt: string;
  allowTool: (tool: string, input: Record<string, unknown>) => boolean;
  workDependencies?: PiRuntimeDependencies;
  score: () => Promise<{
    actual: unknown;
    expected: unknown;
    inputsUnchanged: boolean;
    onlyExpectedFiles: boolean;
  }>;
}

export function reportEvaluationRow(
  tag: string,
  data: Record<string, unknown>,
  reportPath?: string,
): void {
  console.log(`[${tag}] ${JSON.stringify(data)}`);
  if (reportPath)
    appendFileSync(reportPath, `${JSON.stringify({ tag, ...data })}\n`, { mode: 0o600 });
}

async function runNative(
  workspace: string,
  data: string,
  config: Provider,
  gatewayUrl: string,
  fixture: LiveFixture,
): Promise<void> {
  const settings = SettingsManager.inMemory();
  const loader = new DefaultResourceLoader({
    cwd: workspace,
    agentDir: data,
    settingsManager: settings,
    noContextFiles: true,
    noSkills: true,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    extensionFactories: [
      extension => {
        extension.on('tool_call', async event =>
          fixture.allowTool(event.toolName, event.input)
            ? undefined
            : {
                block: true,
                reason: 'This evaluation only allows reading the fixture and writing its result.',
              },
        );
      },
    ],
  });
  await loader.reload();
  const { model, baseUrl, api } = buildMagpiePiModel(
    {
      id: config.model,
      display_name: config.model,
      context_window: config.contextWindow,
      max_output_tokens: config.maxTokens,
    },
    gatewayUrl,
  );
  const runtime = await ModelRuntime.create({
    authPath: path.join(data, 'auth.json'),
    modelsPath: null,
    allowModelNetwork: false,
  });
  runtime.registerProvider('magpie', { name: 'magpie', baseUrl, api, models: [model] });
  await runtime.setRuntimeApiKey('magpie', MAGPIE_RUNTIME_API_KEY);
  const { session } = await createAgentSession({
    cwd: workspace,
    model,
    modelRuntime: runtime,
    settingsManager: settings,
    resourceLoader: loader,
    sessionManager: SessionManager.create(workspace, data),
    tools: ['+grep', '+find', '+ls'],
  });
  try {
    await session.prompt(fixture.prompt);
  } finally {
    session.dispose();
  }
}

async function runWork(
  workspace: string,
  data: string,
  config: Provider,
  gatewayUrl: string,
  fixture: LiveFixture,
): Promise<void> {
  const gateway = createTestMagpie({
    gatewayUrl,
    defaultModelId: config.model,
    acceptUnknownModels: false,
  });
  gateway.upsert(config.model, {
    context_window: config.contextWindow,
    max_output_tokens: config.maxTokens,
  });
  gateway.setImage(config.model, false);
  const store = await SqliteStore.create(data);
  let runtime: PiRuntimeAdapter | undefined;
  const errors: string[] = [];
  let completions = 0;
  try {
    const db = store.getDatabase();
    initializeWorkbenchTaskSchema(db);
    const cowork = new CoworkStore(db);
    const adapter = new PiRuntimeAdapter({
      modelService: gateway.modelService,
      ...fixture.workDependencies,
      coworkStore: cowork,
      piSessionStoreRoot: data,
      workbenchTaskService: new WorkbenchTaskService(db),
    });
    runtime = adapter;
    const authorize = adapter.authorizeToolCall.bind(adapter);
    adapter.authorizeToolCall = async input =>
      fixture.allowTool(input.toolName, input.toolInput)
        ? authorize(input)
        : { allow: false, reason: 'This evaluation only allows fixture tools and paths.' };
    adapter.on('error', (_sessionId, error) => errors.push(error.kind));
    adapter.on('complete', () => {
      completions += 1;
    });
    adapter.on('permissionRequest', (_sessionId, request) => {
      adapter.respondToPermission(
        request.requestId,
        fixture.allowTool(request.toolName, request.toolInput)
          ? { behavior: 'allow' }
          : {
              behavior: 'deny',
              message: 'This evaluation only allows reading the fixture and writing its result.',
            },
      );
    });
    const systemPrompt = composeCoworkSystemPrompt({
      basePrompt: getDefaultSystemPrompt(),
      expertSnapshots: [],
      language: 'zh',
    });
    const session = cowork.createSession(
      'Paired Pi evaluation',
      workspace,
      systemPrompt,
      CoworkExecutionMode.Local,
      [],
      'main',
      '',
      'work',
    );
    await adapter.startSession(session.id, fixture.prompt, {
      workspaceRoot: workspace,
      systemPrompt,
      skillIds: [],
      confirmationMode: 'modal',
      sessionMode: 'work',
      approvalMode: WorkbenchApprovalMode.Ask,
    });
    expect(errors).toEqual([]);
    expect(completions).toBe(1);
  } finally {
    await runtime?.stopAllSessions();
    store.close();
  }
}

export async function runEvaluationArm(input: {
  arm: 'native' | 'work';
  config: Provider;
  fixture: (cwd: string) => Promise<LiveFixture> | LiveFixture;
  transform?: LiveRequestTransform;
  captureFirst?: boolean;
  captureOnly?: boolean;
  knownMemory?: readonly string[];
}) {
  const { arm, config } = input;
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'pi-native-ab-')));
  const cwd = path.join(root, 'work');
  const data = path.join(root, 'data');
  const requests: RequestMetrics[] = [];
  const conversationId = randomUUID();
  let firstRequest: LivePiRequest | undefined;
  let relayError: string | undefined;
  vi.stubEnv('PI_CODING_AGENT_DIR', path.join(data, 'pi-agent'));
  const electronApp = app as unknown as Record<string, unknown>;
  if (typeof electronApp.getAppPath !== 'function') electronApp.getAppPath = () => process.cwd();
  const server = createServer((req, res) => {
    void forwardRequest(req, res, config, requests, conversationId, {
      captureOnly: input.captureOnly,
      knownMemory: input.knownMemory,
      transform: request => {
        if (input.captureFirst && !firstRequest) firstRequest = request;
        try {
          return input.transform?.(request) ?? request;
        } catch (error) {
          relayError = error instanceof Error ? error.message : 'Fixture transform failed.';
          throw error;
        }
      },
    }).catch(() => {
      if (res.headersSent) res.destroy();
      else res.writeHead(502).end('Model request failed.');
    });
  });
  try {
    await mkdir(cwd);
    await mkdir(data);
    const fixture = await input.fixture(cwd);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const gatewayUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const started = performance.now();
    const cpuStart = process.cpuUsage();
    let executionError: string | undefined;
    try {
      await (arm === 'native' ? runNative : runWork)(cwd, data, config, gatewayUrl, fixture);
    } catch {
      executionError = `${arm} did not settle normally`;
    }
    const elapsedMs = Math.round(performance.now() - started);
    const cpu = process.cpuUsage(cpuStart);
    const score = await fixture.score();
    const usageRequests = requests.filter(
      record => record.input !== undefined && record.output !== undefined,
    );
    const summary = {
      arm,
      requestedModel: config.model,
      configuredContextWindow: config.contextWindow,
      configuredMaxOutput: config.maxTokens,
      elapsedMs,
      cpuUserMs: Math.round(cpu.user / 1000),
      cpuSystemMs: Math.round(cpu.system / 1000),
      executionError,
      relayError,
      requests: requests.length,
      compactionRequests: requests.filter(record => record.compaction).length,
      observedModels: [
        ...new Set(requests.flatMap((record): string[] => (record.model ? [record.model] : []))),
      ],
      modelResponseRequests: requests.filter(record => record.status === 200 && record.model)
        .length,
      responseStatuses: requests.map(record => record.status),
      finishReasons: requests.map(record => record.finishReason ?? null),
      errorCodes: requests.map(record => record.errorCode ?? null),
      usageRequests: usageRequests.length,
      promptTokens:
        usageRequests.length > 0
          ? usageRequests.reduce((sum, record) => sum + (record.input ?? 0), 0)
          : null,
      outputTokens:
        usageRequests.length > 0
          ? usageRequests.reduce((sum, record) => sum + (record.output ?? 0), 0)
          : null,
      cachedTokens: usageRequests.some(record => record.cacheRead !== undefined)
        ? usageRequests.reduce((sum, record) => sum + (record.cacheRead ?? 0), 0)
        : null,
      firstRequestTools: requests[0]?.tools,
      firstRequestSystemBytes: requests[0]?.systemBytes,
      firstRequestBytes: requests[0]?.requestBytes,
      firstRequestPromptTokens: requests[0]?.input,
      firstSuccessfulRequestPromptTokens: requests.find(record => record.status === 200)?.input,
      firstRequestAttribution: requests[0]?.attribution,
      ...score,
    };
    return { summary, firstRequest, cwd };
  } finally {
    vi.unstubAllEnvs();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}
