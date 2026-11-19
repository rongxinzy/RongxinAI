import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { expect, test, vi } from 'vitest';

import { installTestMagpie } from '../../../../tests/helpers/installTestMagpie';
import { CoworkExecutionMode } from '../../../shared/cowork/constants';
import { WorkbenchApprovalMode } from '../../../shared/workbenchTask';
import { CoworkStore } from '../../coworkStore';
import { SqliteStore } from '../../sqliteStore';
import { initializeWorkbenchTaskSchema } from '../../workbenchTask/schema';
import { WorkbenchTaskService } from '../../workbenchTask/taskService';
import { runTextWorkerOperation } from '../../workbenchTask/textWorkerOperations';
import { PiRuntimeAdapter } from './piRuntimeAdapter';

vi.mock('../../workbenchTask/artifactWorkerPool', () => ({
  transformCoworkTextAsync: async (input: Parameters<typeof runTextWorkerOperation>[0]) =>
    runTextWorkerOperation(input),
}));

interface CapturedRequest {
  max_tokens?: number;
  max_completion_tokens?: number;
  store?: unknown;
  messages: Array<{ role: string; content: unknown }>;
}

test('real SDK keeps message-0 system prompt byte-identical across turns with new memory recall and applies non-OpenAI compat', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pi-kv-cache-'));
  const sessionId = 'kv-cache-session';
  const modelId = 'zhipu/glm-5.3-flash';
  const capturedRequests: CapturedRequest[] = [];
  const serverErrors: unknown[] = [];

  const server = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as CapturedRequest;
      capturedRequests.push(body);
      const turnNumber = capturedRequests.length;

      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(
        `data: ${JSON.stringify({
          id: `resp-${turnNumber}`,
          model: modelId,
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: `Turn ${turnNumber} ok.` },
              finish_reason: null,
            },
          ],
        })}\n\n`,
      );
      res.end(
        `data: ${JSON.stringify({
          id: `resp-${turnNumber}`,
          model: modelId,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: {
            prompt_tokens: 1000 * turnNumber,
            completion_tokens: 10,
            total_tokens: 1000 * turnNumber + 10,
          },
        })}\n\ndata: [DONE]\n\n`,
      );
    })().catch(error => {
      serverErrors.push(error);
      res.destroy();
    });
  });

  let store: SqliteStore | undefined;
  let gateway: ReturnType<typeof installTestMagpie> | undefined;
  const adapter = new PiRuntimeAdapter();

  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    gateway = installTestMagpie({
      gatewayUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      defaultModelId: modelId,
      acceptUnknownModels: false,
    });
    gateway.upsert(modelId, { context_window: 131072, max_output_tokens: 8192, reasoning: true });
    gateway.setImage(modelId, false);

    const mutableApp = app as unknown as Record<string, unknown>;
    mutableApp.getAppPath ??= () => process.cwd();
    await mkdir(path.join(root, 'state'));
    store = await SqliteStore.create(path.join(root, 'state'));
    const db = store.getDatabase();
    initializeWorkbenchTaskSchema(db);
    const cowork = new CoworkStore(db);
    cowork.createSession(
      'KV Cache Stability',
      root,
      '',
      CoworkExecutionMode.Local,
      [],
      'main',
      '',
      'work',
      sessionId,
    );
    adapter.setCoworkStore(cowork);
    adapter.setWorkbenchTaskService(new WorkbenchTaskService(db));
    adapter.setPiSessionStoreRoot(root);

    const buildProjectContext = vi
      .fn()
      .mockResolvedValueOnce('Workspace:\n- [memory:1] Decision Alpha')
      .mockResolvedValueOnce('Workspace:\n- [memory:1] Decision Alpha\n- [memory:2] Decision Beta');
    adapter.setProjectMemoryService({
      buildProjectContext,
      registerSession: vi.fn().mockResolvedValue(undefined),
    } as never);

    let completes = 0;
    const errors: unknown[] = [];
    adapter.on('complete', () => {
      completes += 1;
    });
    adapter.on('error', (_id, err) => errors.push(err));

    await adapter.startSession(sessionId, 'First question', {
      workspaceRoot: root,
      sessionMode: 'work',
      approvalMode: WorkbenchApprovalMode.Auto,
    });
    await vi.waitFor(() => expect(completes).toBe(1), { timeout: 15_000 });

    await adapter.continueSession(sessionId, 'Second question', {
      workspaceRoot: root,
      sessionMode: 'work',
      approvalMode: WorkbenchApprovalMode.Auto,
    });
    await vi.waitFor(() => expect(completes).toBe(2), { timeout: 15_000 });

    expect(serverErrors).toEqual([]);
    expect(errors).toEqual([]);
    expect(capturedRequests).toHaveLength(2);

    const [req1, req2] = capturedRequests;
    // System prompt at position 0 must be strictly immutable across turns to preserve KV cache.
    expect(req1.messages[0]?.role).toBe('system');
    expect(req2.messages[0]).toEqual(req1.messages[0]);

    // The entire Turn 1 prompt + memory prefix must remain verbatim at the start of Turn 2.
    expect(req2.messages.slice(0, req1.messages.length)).toEqual(req1.messages);

    // Turn 1 carries Decision Alpha in a non-system message; Turn 2 adds only Decision Beta.
    const req1Serialized = JSON.stringify(req1.messages.slice(1));
    expect(req1Serialized).toContain('Decision Alpha');
    expect(JSON.stringify(req1.messages[0])).not.toContain('Decision Alpha');

    const req2SuffixSerialized = JSON.stringify(req2.messages.slice(req1.messages.length));
    expect(req2SuffixSerialized).toContain('Decision Beta');
    expect(req2SuffixSerialized).not.toContain('Decision Alpha');

    // Non-OpenAI Magpie compat applied on the real wire payload.
    expect(req1.max_tokens).toBe(8192);
    expect(req1.max_completion_tokens).toBeUndefined();
    expect(req1.store).toBeUndefined();
  } finally {
    await adapter.stopAllSessions();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    gateway?.dispose();
    store?.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
