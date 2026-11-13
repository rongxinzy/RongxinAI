import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { app } from 'electron';
import { CoworkExecutionMode } from '../../src/shared/cowork/constants';
import { CoworkStore } from '../../src/main/coworkStore';
import { SqliteStore } from '../../src/main/sqliteStore';
import { PiRuntimeAdapter } from '../../src/main/libs/agentEngine/piRuntimeAdapter';
import { initializeWorkbenchTaskSchema } from '../../src/main/workbenchTask/schema';
import { WorkbenchTaskService } from '../../src/main/workbenchTask/taskService';
import { installTestMagpie } from '../helpers/installTestMagpie';
import { PiAssistantStopReason } from '../../src/main/libs/agentEngine/piToolConstants';

const mutableApp = app as unknown as Record<string, unknown>;
if (typeof mutableApp.getAppPath !== 'function') mutableApp.getAppPath = () => process.cwd();

test.each([PiAssistantStopReason.Length, PiAssistantStopReason.Stop])(
  'real adapter and HTTP provider distinguish terminal %s',
  async finishReason => {
    const directory = await mkdtemp(path.join(tmpdir(), 'pi-http-terminal-'));
    const model = 'offline-terminal';
    let requests = 0;
    const upstream = createServer((req, res) => {
      req.resume();
      requests += 1;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(
        `data: ${JSON.stringify({ id: 'offline', object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: { role: 'assistant', content: 'Recorded response.' }, finish_reason: null }] })}\n\n`,
      );
      res.end(
        `data: ${JSON.stringify({ id: 'offline', object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: {}, finish_reason: finishReason }], usage: { prompt_tokens: 32, completion_tokens: finishReason === PiAssistantStopReason.Length ? 4096 : 12, total_tokens: finishReason === PiAssistantStopReason.Length ? 4128 : 44 } })}\n\ndata: [DONE]\n\n`,
      );
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const gateway = installTestMagpie({
      gatewayUrl: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
      defaultModelId: model,
    });
    gateway.upsert(model, { context_window: 65536, max_output_tokens: 4096 });
    const store = await SqliteStore.create(directory);
    const db = store.getDatabase();
    initializeWorkbenchTaskSchema(db);
    const coworkStore = new CoworkStore(db);
    const adapter = new PiRuntimeAdapter();
    adapter.setCoworkStore(coworkStore);
    adapter.setWorkbenchTaskService(new WorkbenchTaskService(db));
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
      await adapter.startSession(session.id, 'Respond once.', {
        workspaceRoot: directory,
        sessionMode: 'work',
      });
      expect(error).not.toHaveBeenCalled();
      expect(complete).toHaveBeenCalledOnce();
      expect(complete).toHaveBeenCalledWith(session.id, {});
      expect(requests).toBe(1);
    } finally {
      // Context-usage metadata is intentionally persisted on the next timer tick.
      await new Promise(resolve => setTimeout(resolve, 0));
      adapter.stopAllSessions();
      gateway.dispose();
      await store.close();
      await new Promise<void>(resolve => {
        upstream.close(() => resolve());
        upstream.closeAllConnections();
      });
      await rm(directory, { recursive: true, force: true });
    }
  },
);
