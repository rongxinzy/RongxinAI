import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { expect, test, vi } from 'vitest';

import { CoworkStore } from '../../src/main/coworkStore';
import { SqliteStore } from '../../src/main/sqliteStore';
import { PiRuntimeAdapter } from '../../src/main/libs/agentEngine/piRuntimeAdapter';
import { WorkbenchTaskService } from '../../src/main/workbenchTask/taskService';
import { initializeWorkbenchTaskSchema } from '../../src/main/workbenchTask/schema';
import { CoworkExecutionMode } from '../../src/shared/cowork/constants';
import { WorkbenchApprovalMode, WorkbenchExecutionStatus } from '../../src/shared/workbenchTask';
import { installTestMagpie } from '../helpers/installTestMagpie';
import { inspectLongTaskArtifacts } from './piLongTaskAcceptance';

const mutableApp = app as unknown as Record<string, unknown>;
if (typeof mutableApp.getAppPath !== 'function') mutableApp.getAppPath = () => process.cwd();

const ObservationMode = {
  Off: 'off',
  On: 'on',
  BrokenStart: 'broken_start',
  BrokenAudit: 'broken_audit',
} as const;
type ObservationMode = (typeof ObservationMode)[keyof typeof ObservationMode];
const docId = (index: number) => `doc-${String(index).padStart(3, '0')}`;
const title = (index: number) => `章节${index}的独特机制`;

async function runScenario(
  workspace: string,
  count: number,
  stopAfter: number,
  mode: ObservationMode,
  retryFirstRequest = false,
) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pi-observation-db-'));
  const requests: Record<string, unknown>[] = [];
  const permissions: string[] = [];
  const events: string[] = [];
  const summaries: string[] = [];
  let step = 0;
  const actions: Array<{ name: string; args: Record<string, unknown> }> = [];
  for (let index = 1; index <= stopAfter; index += 1) {
    actions.push({ name: 'read', args: { path: `data/${docId(index)}.txt` } });
    summaries.push(`## ${docId(index)} ${title(index)}\n该章节描述机制与工程建议。\n`);
    actions.push({ name: 'write', args: { path: 'summaries.md', content: summaries.join('\n') } });
  }
  if (stopAfter === count) {
    actions.push({
      name: 'write',
      args: {
        path: 'index.csv',
        content: [
          '文档编号,章节名,主题分类,一句话要点',
          ...Array.from(
            { length: count },
            (_, i) => `${docId(i + 1)},${title(i + 1)},机制,工程建议`,
          ),
        ].join('\n'),
      },
    });
    actions.push({
      name: 'write',
      args: { path: 'report.md', content: '综合技术分析与工程取舍建议。'.repeat(150) },
    });
  }
  const model = 'offline-observation';
  const upstream = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    requests.push(JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>);
    if (retryFirstRequest && requests.length === 1) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'The provider is temporarily unavailable.' } }));
      return;
    }
    const action = actions[step++];
    const delta = action
      ? {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: `call-${step}`,
              type: 'function',
              function: {
                name: action.name,
                arguments: JSON.stringify(action.args),
              },
            },
          ],
        }
      : {
          role: 'assistant',
          content:
            stopAfter === count
              ? '产物已生成。'
              : '已读取 doc-021 并追加摘要。继续处理下一个文档。',
        };
    const chunk = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(
      chunk({
        id: `response-${step}`,
        object: 'chat.completion.chunk',
        model,
        choices: [{ index: 0, delta, finish_reason: null }],
      }),
    );
    res.end(
      chunk({
        id: `response-${step}`,
        object: 'chat.completion.chunk',
        model,
        choices: [{ index: 0, delta: {}, finish_reason: action ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 1024, completion_tokens: 64, total_tokens: 1088 },
      }) + 'data: [DONE]\n\n',
    );
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const gateway = installTestMagpie({
    gatewayUrl: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
    defaultModelId: model,
  });
  gateway.upsert(model, { context_window: 65536, max_output_tokens: 8192 });
  const store = await SqliteStore.create(directory);
  const db = store.getDatabase();
  initializeWorkbenchTaskSchema(db);
  const cowork = new CoworkStore(db);
  const workbench = new WorkbenchTaskService(db);
  const adapter = new PiRuntimeAdapter();
  adapter.setCoworkStore(cowork);
  if (mode !== ObservationMode.Off) adapter.setWorkbenchTaskService(workbench);
  if (mode === ObservationMode.BrokenStart || mode === ObservationMode.BrokenAudit) {
    const methods =
      mode === ObservationMode.BrokenStart
        ? (['beginRun'] as const)
        : ([
            'updateRunContext',
            'recordToolCallObserved',
            'recordToolApprovalDecision',
            'recordToolResult',
            'settleObservedRun',
            'cancelRun',
          ] as const);
    for (const method of methods) {
      vi.spyOn(workbench, method).mockImplementation(() => {
        throw new Error('audit unavailable');
      });
    }
  }
  const session = cowork.createSession(
    'Observation test',
    workspace,
    '',
    CoworkExecutionMode.Local,
    [],
    'main',
    '',
    'work',
    'observation-session',
  );
  adapter.on('permissionRequest', (_sessionId, request) => {
    permissions.push(request.toolName);
    adapter.respondToPermission(request.requestId, { behavior: 'allow' });
  });
  adapter.on('complete', (...args) => {
    expect(args).toEqual([session.id]);
    events.push('complete');
  });
  adapter.on('error', (_sessionId, error) => events.push(`error:${error.kind}`));
  adapter.on('retryNotice', () => events.push('retry'));
  try {
    await adapter.startSession(
      session.id,
      `依次读取 ${count} 篇文档并写入摘要、四列 CSV 和中文报告。`,
      {
        workspaceRoot: workspace,
        sessionMode: 'work',
        approvalMode: WorkbenchApprovalMode.Ask,
      },
    );
    if (!retryFirstRequest) expect(events).toEqual(['complete']);
    expect(events.filter(event => event === 'complete')).toHaveLength(1);
    expect(events.some(event => event.startsWith('error:'))).toBe(false);
    expect(requests).toHaveLength(actions.length + (retryFirstRequest ? 2 : 1));
    const detail = mode === ObservationMode.On ? workbench.getCurrent(session.id) : null;
    if (detail) {
      expect(detail.task.status).toBe(WorkbenchExecutionStatus.Settled);
      expect(detail.runs[0].status).toBe(WorkbenchExecutionStatus.Settled);
      expect(detail.runs[0]).not.toHaveProperty('verificationResult');
    }
    const errors = inspectLongTaskArtifacts(workspace, count);
    if (stopAfter === count) expect(errors).toEqual([]);
    else
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('summaries.md'),
          expect.stringContaining('index.csv'),
          expect.stringContaining('report.md'),
        ]),
      );
    const assistant = cowork
      .getSession(session.id)!
      .messages.filter(message => message.type === 'assistant')
      .at(-1)!;
    expect(assistant.metadata?.usage).toBeDefined();
    expect(assistant.metadata?.contextUsage).toBeDefined();
    return { requests, permissions, events };
  } finally {
    adapter.stopAllSessions();
    const readMessage = vi.spyOn(cowork, 'getMessage');
    readMessage.mockClear();
    store.close();
    // Deliberately yield only after close: no workaround timer tick is permitted.
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(readMessage).not.toHaveBeenCalled();
    gateway.dispose();
    await new Promise<void>(resolve => {
      upstream.close(() => resolve());
      upstream.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
  }
}

test(
  'partial 21/32-document stop is unchanged with audit on, off or broken',
  { timeout: 60_000 },
  async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'pi-observation-work-'));
    try {
      await mkdir(path.join(workspace, 'data'));
      for (let i = 1; i <= 32; i += 1)
        await writeFile(
          path.join(workspace, 'data', `${docId(i)}.txt`),
          `# ${title(i)}\n原始资料${i}。`,
        );
      const results = [];
      for (const mode of Object.values(ObservationMode)) {
        await rm(path.join(workspace, 'summaries.md'), { force: true });
        results.push(await runScenario(workspace, 32, 21, mode));
      }
      expect(results[1]).toEqual(results[0]);
      expect(results[2]).toEqual(results[0]);
      expect(results[3]).toEqual(results[0]);
      expect(
        (await readFile(path.join(workspace, 'summaries.md'), 'utf8')).match(/^## /gm),
      ).toHaveLength(21);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  },
);

test.each([32, 48])(
  'checks real artifacts for a complete %i-document run',
  { timeout: 60_000 },
  async count => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'pi-observation-complete-'));
    try {
      await mkdir(path.join(workspace, 'data'));
      for (let i = 1; i <= count; i += 1)
        await writeFile(
          path.join(workspace, 'data', `${docId(i)}.txt`),
          `# ${title(i)}\n原始资料${i}。`,
        );
      await runScenario(workspace, count, count, ObservationMode.On);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  },
);

test(
  'provider retry stays native when audit recording is disabled, enabled or failing',
  { timeout: 60_000 },
  async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'pi-observation-retry-'));
    try {
      await mkdir(path.join(workspace, 'data'));
      await writeFile(path.join(workspace, 'data', 'doc-001.txt'), `# ${title(1)}\n原始资料。`);
      const results = [];
      for (const mode of [ObservationMode.Off, ObservationMode.On, ObservationMode.BrokenAudit]) {
        for (const file of ['summaries.md', 'index.csv', 'report.md'])
          await rm(path.join(workspace, file), { force: true });
        results.push(await runScenario(workspace, 1, 1, mode, true));
      }
      expect(results[1]).toEqual(results[0]);
      expect(results[2]).toEqual(results[0]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  },
);
