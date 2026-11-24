import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { app } from 'electron';
import { CoworkExecutionMode, CoworkSessionStatus } from '../../src/shared/cowork/constants';
import { CoworkStore } from '../../src/main/coworkStore';
import { SqliteStore } from '../../src/main/sqliteStore';
import { PiRuntimeAdapter } from '../../src/main/libs/agentEngine/piRuntimeAdapter';
import { initializeWorkbenchTaskSchema } from '../../src/main/workbenchTask/schema';
import { WorkbenchTaskService } from '../../src/main/workbenchTask/taskService';
import { createTestMagpie } from '../helpers/createTestMagpie';
import { PiAssistantStopReason } from '../../src/main/libs/agentEngine/piToolConstants';
import { t } from '../../src/main/i18n';

const mutableApp = app as unknown as Record<string, unknown>;
if (typeof mutableApp.getAppPath !== 'function') mutableApp.getAppPath = () => process.cwd();

test.each([
  ...[
    { finishReason: PiAssistantStopReason.Length, thinkingOnly: false },
    { finishReason: PiAssistantStopReason.Length, thinkingOnly: true },
    { finishReason: PiAssistantStopReason.Stop, thinkingOnly: false },
    { finishReason: PiAssistantStopReason.Stop, thinkingOnly: true },
    { finishReason: PiAssistantStopReason.Error, thinkingOnly: true },
  ].map(configuration => ({ ...configuration, prompt: 'Respond once.' })),
])(
  'real adapter terminal $finishReason thinkingOnly=$thinkingOnly input=$prompt.length',
  async ({ finishReason, thinkingOnly, prompt }) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'pi-http-terminal-'));
    const model = 'offline-terminal';
    let requests = 0;
    const upstream = createServer((req, res) => {
      req.resume();
      requests += 1;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(
        `data: ${JSON.stringify({ id: 'offline', object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: { role: 'assistant', ...(thinkingOnly ? { reasoning_content: 'Thinking without an answer.' } : { content: 'Recorded response.' }) }, finish_reason: null }] })}\n\n`,
      );
      if (finishReason === PiAssistantStopReason.Error) {
        // Clean EOF with no finish_reason is still an interrupted thinking stream.
        res.end();
        return;
      }
      res.end(
        `data: ${JSON.stringify({ id: 'offline', object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: {}, finish_reason: finishReason }], usage: { prompt_tokens: 32, completion_tokens: finishReason === PiAssistantStopReason.Length ? 4096 : 12, total_tokens: finishReason === PiAssistantStopReason.Length ? 4128 : 44 } })}\n\ndata: [DONE]\n\n`,
      );
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const gateway = createTestMagpie({
      gatewayUrl: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
      defaultModelId: model,
    });
    gateway.upsert(model, { context_window: 65536, max_output_tokens: 4096 });
    const store = await SqliteStore.create(directory);
    const db = store.getDatabase();
    initializeWorkbenchTaskSchema(db);
    const coworkStore = new CoworkStore(db);
    const adapter = new PiRuntimeAdapter({
      modelService: gateway.modelService,
      coworkStore,
      workbenchTaskService: new WorkbenchTaskService(db),
    });
    const complete = vi.fn();
    const error = vi.fn();
    adapter.on('complete', complete);
    adapter.on('error', error);
    try {
      const session = coworkStore.createSession(
        'Terminal test',
        directory,
        '',
        CoworkExecutionMode.Local,
      );
      await adapter.startSession(session.id, prompt, {
        workspaceRoot: directory,
        sessionMode: 'work',
      });
      if (finishReason === PiAssistantStopReason.Error) {
        expect(error).toHaveBeenCalledOnce();
        expect(coworkStore.getSession(session.id)!.status).toBe(CoworkSessionStatus.Error);
        expect(complete).not.toHaveBeenCalled();
        expect(coworkStore.getSession(session.id)!.status).toBe(CoworkSessionStatus.Error);
        const persistedErrors = coworkStore
          .getSession(session.id)!
          .messages.filter(message => message.metadata?.error);
        expect(persistedErrors).toHaveLength(1);
        expect(String(persistedErrors[0].metadata?.error)).toContain('finish_reason');
        expect(requests).toBeGreaterThan(0);
        expect(requests).toBeLessThanOrEqual(4);
      } else if (finishReason === PiAssistantStopReason.Length || thinkingOnly) {
        const message = t(
          finishReason === PiAssistantStopReason.Length
            ? 'coworkOutputTruncated'
            : 'taskThinkingOnly',
        );
        expect(error).toHaveBeenCalledWith(session.id, expect.objectContaining({ message }));
        expect(complete).not.toHaveBeenCalled();
        expect(
          coworkStore
            .getSession(session.id)!
            .messages.some(persisted => persisted.metadata?.error === message),
        ).toBe(true);
      } else {
        expect(error).not.toHaveBeenCalled();
        expect(complete).toHaveBeenCalledOnce();
        expect(complete).toHaveBeenCalledWith(session.id);
      }
      if (finishReason !== PiAssistantStopReason.Error) expect(requests).toBe(1);
    } finally {
      adapter.stopAllSessions();
      await store.close();
      await new Promise<void>(resolve => {
        upstream.close(() => resolve());
        upstream.closeAllConnections();
      });
      await rm(directory, { recursive: true, force: true });
    }
  },
);
