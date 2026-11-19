import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
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
import { expect, test, vi } from 'vitest';
import { CoworkStore } from '../../src/main/coworkStore';
import { getDefaultSystemPrompt } from '../../src/main/coworkStore/helpers';
import { composeCoworkSystemPrompt } from '../../src/main/coworkPrompt/composer';
import { buildMagpiePiModel } from '../../src/main/libs/agentEngine/piMagpiePiModel';
import { PiRuntimeAdapter } from '../../src/main/libs/agentEngine/piRuntimeAdapter';
import { MAGPIE_RUNTIME_API_KEY } from '../../src/main/magpie/modelService';
import { SqliteStore } from '../../src/main/sqliteStore';
import { initializeWorkbenchTaskSchema } from '../../src/main/workbenchTask/schema';
import { WorkbenchTaskService } from '../../src/main/workbenchTask/taskService';
import { CoworkExecutionMode } from '../../src/shared/cowork/constants';
import { WorkbenchApprovalMode } from '../../src/shared/workbenchTask';
import { installTestMagpie } from '../helpers/installTestMagpie';
import { forwardRequest, provider, type Provider, type RequestMetrics } from './piNativeABProvider';

const Arm = { Native: 'native', Work: 'work' } as const;
type Arm = (typeof Arm)[keyof typeof Arm];
const inputFiles = ['input/east.csv', 'input/south.csv', 'input/west.csv'];
const outputFile = 'result.json';

const prompt = `请用 read 工具读取 input/ 目录内的 east.csv、south.csv、west.csv（可以并行读取），核对所有记录后用 write 工具生成 result.json。每个文件格式均为 id,owner,severity,loss，loss 单位为元。纳入 severity 为 P0 或 loss 大于等于 5000 的记录。result.json 必须是一个 JSON 对象，字段为 findings 和 ownerTotals。findings 是按 id 升序排列的数组，每项为 {"id":字符串,"owner":字符串,"loss":数字}。ownerTotals 是以负责人为键的对象，值为该负责人命中记录的 loss 总和。保留原数据，不要新增其他文件。完成后简短说明。`;

async function seed(root: string, variant: number, stress: boolean) {
  const rows = [
    [
      ['EA-18', '王宁', 'P0', 2100],
      ['EA-26', '胡敏', 'P2', 4999],
    ],
    [
      ['SO-27', '胡敏', 'P1', 5000],
      ['SO-39', '王宁', 'P2', 7100],
    ],
    [
      ['WE-19', '余安', 'P2', 200],
      ['WE-28', '余安', 'P0', 1400],
      ['WE-41', '胡敏', 'P3', 5700],
    ],
  ] as const;
  await mkdir(path.join(root, 'input'));
  const normalized = rows.map(group =>
    group.map(([id, owner, severity, loss]) => ({
      id,
      owner,
      severity,
      loss: loss + variant * 100,
    })),
  );
  const inputs = new Map<string, string>();
  for (const [index, file] of inputFiles.entries()) {
    const excludedRows = stress
      ? Array.from(
          { length: 350 },
          (_, row) =>
            `ZZ-${index}-${row},日常基准巡检记录此条未达到阈值仅供验证上下文分段处理编号${row},P3,100`,
        )
      : [];
    const content = [
      'id,owner,severity,loss',
      ...normalized[index].map(row => `${row.id},${row.owner},${row.severity},${row.loss}`),
      ...excludedRows,
      '',
    ].join('\n');
    inputs.set(file, content);
    await writeFile(path.join(root, file), content);
  }
  const findings = normalized
    .flat()
    .filter(row => row.severity === 'P0' || row.loss >= 5000)
    .map(({ id, owner, loss }) => ({ id, owner, loss }));
  const ownerTotals: Record<string, number> = {};
  for (const { owner, loss } of findings) ownerTotals[owner] = (ownerTotals[owner] ?? 0) + loss;
  return { inputs, expected: { findings, ownerTotals } };
}

function isFixtureTool(workspace: string, tool: string, input: Record<string, unknown>): boolean {
  if (typeof input.path !== 'string') return false;
  const relative = path
    .relative(workspace, path.resolve(workspace, input.path))
    .split(path.sep)
    .join('/');
  return (
    (tool === 'read' && inputFiles.includes(relative)) ||
    (tool === 'write' && relative === outputFile)
  );
}

async function runNative(
  workspace: string,
  data: string,
  config: Provider,
  gatewayUrl: string,
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
          isFixtureTool(workspace, event.toolName, event.input)
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
    await session.prompt(prompt);
  } finally {
    session.dispose();
  }
}

async function runWork(
  workspace: string,
  data: string,
  config: Provider,
  gatewayUrl: string,
): Promise<void> {
  const gateway = installTestMagpie({
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
  const adapter = new PiRuntimeAdapter();
  const errors: string[] = [];
  let completions = 0;
  try {
    const db = store.getDatabase();
    initializeWorkbenchTaskSchema(db);
    const cowork = new CoworkStore(db);
    adapter.setCoworkStore(cowork);
    adapter.setPiSessionStoreRoot(data);
    adapter.setWorkbenchTaskService(new WorkbenchTaskService(db));
    adapter.on('error', (_sessionId, error) => errors.push(error.kind));
    adapter.on('complete', () => {
      completions += 1;
    });
    adapter.on('permissionRequest', (_sessionId, request) => {
      adapter.respondToPermission(
        request.requestId,
        isFixtureTool(workspace, request.toolName, request.toolInput)
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
    await adapter.startSession(session.id, prompt, {
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
    await adapter.stopAllSessions();
    store.close();
    gateway.dispose();
  }
}

// Opt in to network and possible provider charges. Use PI_AB_USE_ZHIYUAN_FREE=1,
// PI_AB_USE_ZHIYUAN_INTRANET=1, or PI_AB_BASE_URL/PI_AB_MODEL/optional PI_AB_API_KEY.
// PI_AB_STRESS=1 runs one pair with 1,050 additional records that should be excluded.
// PI_AB=1 bunx --no-install vitest run tests/evaluation/piNativeAB.test.ts
test.skipIf(process.env.PI_AB !== '1')(
  'compares bare Pi and Work with the same live model and independent artifact scoring',
  { timeout: 600000 },
  async () => {
    const electronApp = app as unknown as Record<string, unknown>;
    if (typeof electronApp.getAppPath !== 'function') electronApp.getAppPath = () => process.cwd();
    const config = await provider();
    const stress = process.env.PI_AB_STRESS === '1';
    const summaries = [];
    const order = [[Arm.Native, Arm.Work]];
    if (!stress) order.push([Arm.Work, Arm.Native]);
    for (const [variant, arms] of order.entries()) {
      for (const arm of arms) {
        const root = await realpath(await mkdtemp(path.join(tmpdir(), 'pi-native-ab-')));
        const cwd = path.join(root, 'work');
        const data = path.join(root, 'data');
        const requests: RequestMetrics[] = [];
        const conversationId = randomUUID();
        vi.stubEnv('PI_CODING_AGENT_DIR', path.join(data, 'pi-agent'));
        const server = createServer((req, res) => {
          void forwardRequest(req, res, config, requests, conversationId).catch(() => {
            if (res.headersSent) res.destroy();
            else res.writeHead(502).end('Model request failed.');
          });
        });
        try {
          await mkdir(cwd);
          await mkdir(data);
          const { expected, inputs } = await seed(cwd, variant, stress);
          server.listen(0, '127.0.0.1');
          await once(server, 'listening');
          const gatewayUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
          const started = performance.now();
          let executionError: string | undefined;
          try {
            await (arm === Arm.Native ? runNative : runWork)(cwd, data, config, gatewayUrl);
          } catch {
            executionError = `${arm} did not settle normally`;
          }
          const elapsedMs = Math.round(performance.now() - started);
          const actual = await readFile(path.join(cwd, outputFile), 'utf8')
            .then(text => JSON.parse(text) as unknown)
            .catch((): null => null);
          const usageRequests = requests.filter(
            record => record.input !== undefined && record.output !== undefined,
          );
          const files = (await readdir(cwd, { recursive: true }))
            .map(file => file.split(path.sep).join('/'))
            .sort();
          const expectedFiles = ['input', ...inputFiles, outputFile].sort();
          const inputsUnchanged = (
            await Promise.all(
              [...inputs].map(async ([file, content]) =>
                readFile(path.join(cwd, file), 'utf8').then(
                  actual => actual === content,
                  () => false,
                ),
              ),
            )
          ).every(Boolean);
          const summary = {
            arm,
            variant,
            requestedModel: config.model,
            stress,
            configuredContextWindow: config.contextWindow,
            configuredMaxOutput: config.maxTokens,
            elapsedMs,
            executionError,
            requests: requests.length,
            compactionRequests: requests.filter(record => record.compaction).length,
            observedModels: [
              ...new Set(
                requests.flatMap((record): string[] => (record.model ? [record.model] : [])),
              ),
            ],
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
            inputsUnchanged,
            onlyExpectedFiles: files.join('\n') === expectedFiles.join('\n'),
            actual,
            expected,
          };
          console.log(`[PiNativeAB] ${JSON.stringify(summary)}`);
          summaries.push(summary);
        } finally {
          vi.unstubAllEnvs();
          server.closeAllConnections();
          await new Promise<void>(resolve => server.close(() => resolve()));
          await rm(root, { recursive: true, force: true });
        }
      }
    }
    expect(new Set(summaries.flatMap(summary => summary.observedModels)).size).toBe(1);
    for (const summary of summaries) {
      expect(summary.executionError).toBeUndefined();
      expect(summary.requests).toBeGreaterThan(0);
      expect(summary.actual).toEqual(summary.expected);
      expect(summary.inputsUnchanged).toBe(true);
      expect(summary.onlyExpectedFiles).toBe(true);
    }
  },
);
