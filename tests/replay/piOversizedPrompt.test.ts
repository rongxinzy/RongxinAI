import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { expect, test, vi } from 'vitest';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { CoworkExecutionMode } from '../../src/shared/cowork/constants';
import { CoworkStore } from '../../src/main/coworkStore';
import { SqliteStore } from '../../src/main/sqliteStore';
import { PiRuntimeAdapter } from '../../src/main/libs/agentEngine/piRuntimeAdapter';
import { piSessionDirFor } from '../../src/main/libs/agentEngine/piSessionStore';
import { createTestMagpie } from '../helpers/createTestMagpie';

test.each(['a', '中文'].flatMap(text => [false, true].map(failSummary => ({ text, failSummary }))))(
  'fresh oversized $text input preserves the prompt through native recovery, summary failure=$failSummary',
  async ({ text, failSummary }) => {
    const root = await mkdtemp(path.join(tmpdir(), 'pi-oversized-prompt-'));
    const prompt = `Keep the original instructions. ${text.repeat(300000)} END_OF_PROMPT`;
    const model = 'oversized-prompt';
    const contextWindow = 65536;
    let summaries = 0;
    let regularRequests = 0;
    const serverErrors: unknown[] = [];
    const server = createServer((req, res) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString()) as {
          messages: unknown[];
          max_tokens?: number;
          max_completion_tokens?: number;
        };
        const serialized = JSON.stringify(body.messages);
        const summary = serialized.includes('context summarization assistant');
        if (summary) summaries++;
        else regularRequests++;
        if (summaries + regularRequests > 40) throw new Error('Unexpected request loop');
        const input = Math.ceil(serialized.length / 3.5);
        const output = body.max_tokens ?? body.max_completion_tokens ?? 0;
        expect(input + output).toBeLessThanOrEqual(contextWindow);
        if (summary && failSummary) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Fixture summary unavailable' } }));
          return;
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(
          `data: ${JSON.stringify({ id: 'oversized', model, choices: [{ index: 0, delta: { role: 'assistant', content: summary ? 'Preserve the user instructions and END_OF_PROMPT.' : 'Recovered answer.' }, finish_reason: null }] })}\n\n`,
        );
        res.end(
          `data: ${JSON.stringify({ id: 'oversized', model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: input, completion_tokens: 12, total_tokens: input + 12 } })}\n\ndata: [DONE]\n\n`,
        );
      })().catch(error => {
        serverErrors.push(error);
        res.destroy();
      });
    });
    let store: SqliteStore | undefined;
    let adapter: PiRuntimeAdapter | undefined;
    try {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const gateway = createTestMagpie({
        gatewayUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        defaultModelId: model,
      });
      gateway.upsert(model, { context_window: contextWindow, max_output_tokens: contextWindow });
      (app as unknown as Record<string, unknown>).getAppPath ??= () => process.cwd();
      store = await SqliteStore.create(root);
      const cowork = new CoworkStore(store.getDatabase());
      const session = cowork.createSession('Oversized', root, '', CoworkExecutionMode.Local);
      adapter = new PiRuntimeAdapter({
        modelService: gateway.modelService,
        coworkStore: cowork,
        piSessionStoreRoot: root,
      });
      const error = vi.fn();
      const complete = vi.fn();
      adapter.on('error', error);
      adapter.on('complete', complete);
      vi.useFakeTimers({ toFake: ['Date'] });
      await adapter.startSession(session.id, prompt, { workspaceRoot: root, sessionMode: 'work' });
      expect(serverErrors).toEqual([]);
      expect(summaries).toBeGreaterThan(0);
      const historyDirectory = piSessionDirFor(
        root,
        session.id,
        cowork.getPiHistoryKey(session.id),
      );
      const histories = await SessionManager.list(root, historyDirectory);
      expect(histories).toHaveLength(1);
      const persisted = SessionManager.open(histories[0]!.path);
      expect(
        persisted
          .getBranch()
          .some(
            entry =>
              entry.type === 'message' &&
              entry.message.role === 'user' &&
              JSON.stringify(entry.message.content).includes(prompt),
          ),
      ).toBe(true);
      if (failSummary) {
        expect(error).toHaveBeenCalledOnce();
        expect(error.mock.calls[0][1].message).toContain('Fixture summary unavailable');
        expect(complete).not.toHaveBeenCalled();
        expect(regularRequests).toBe(0);
        expect(persisted.getBranch().some(entry => entry.type === 'compaction')).toBe(false);
        expect(
          cowork.getSession(session.id)!.messages.filter(message => message.metadata?.error),
        ).toHaveLength(1);
      } else {
        expect(error).not.toHaveBeenCalled();
        expect(complete).toHaveBeenCalledOnce();
        expect(regularRequests).toBe(1);
        expect(persisted.getBranch().filter(entry => entry.type === 'compaction')).toHaveLength(1);
        expect(
          cowork
            .getSession(session.id)!
            .messages.some(message => message.content === 'Recovered answer.'),
        ).toBe(true);
      }
    } finally {
      vi.useRealTimers();
      adapter?.stopAllSessions();
      await store?.close();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  },
);
