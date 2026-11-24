import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { app } from 'electron';
import { LlamaCppModelProcessManager } from '../src/main/libs/llamacppModelProcessManager';
import { buildLlamaCppRunningModelBinding } from '../src/main/libs/llamacppAgentBinding';
import { PiRuntimeAdapter } from '../src/main/libs/agentEngine/piRuntimeAdapter';
import { SqliteStore } from '../src/main/sqliteStore';
import { CoworkStore } from '../src/main/coworkStore';
import { CoworkExecutionMode } from '../src/shared/cowork/constants';
import { createTestMagpie } from './helpers/createTestMagpie';
import { t } from '../src/main/i18n';

test.skipIf(!process.env.ZHIYUAN_TEST_LLAMA_SERVER || !process.env.ZHIYUAN_TEST_GGUF)(
  'real installed small model uses native output budget and reports terminal truncation',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zy-local-output-'));
    const manager = new LlamaCppModelProcessManager({
      getExecutablePath: async () => process.env.ZHIYUAN_TEST_LLAMA_SERVER!,
      getServiceConfig: () => ({
        ctxSize: '8192',
        parallel: '1',
        threads: '4',
        gpuLayers: '0',
        jinja: 'on',
      }),
      startupTimeoutMs: () => 60000,
    });
    const output: string[] = [];
    manager.on('output', event => output.push(event.text));
    let adapter: PiRuntimeAdapter | undefined;
    let store: SqliteStore | undefined;
    try {
      const running = await manager.ensureRunning({
        model: 'small-local',
        modelPath: process.env.ZHIYUAN_TEST_GGUF!,
      });
      expect(running.runtimeContextLength).toBe(8192);
      expect(manager.list()[0]?.runtimeContextLength).toBe(8192);
      const binding = buildLlamaCppRunningModelBinding({
        name: 'small-local',
        runtime_context_length: running.runtimeContextLength,
      })!;
      expect(binding.maxTokens).toBe(8192);
      const gateway = createTestMagpie({ gatewayUrl: running.baseUrl, defaultModelId: binding.id });
      gateway.upsert(binding.id, {
        context_window: binding.contextWindow,
        max_output_tokens: binding.maxTokens,
      });
      gateway.setImage(binding.id, false);
      const mutableApp = app as unknown as Record<string, unknown>;
      mutableApp.getAppPath ??= () => process.cwd();
      store = await SqliteStore.create(root);
      const cowork = new CoworkStore(store.getDatabase());
      adapter = new PiRuntimeAdapter({
        modelService: gateway.modelService,
        coworkStore: cowork,
        piSessionStoreRoot: root,
      });
      const errors: unknown[] = [];
      let complete = 0;
      adapter.on('error', (_id, error) => errors.push(error));
      adapter.on('complete', () => complete++);
      const requests: number[] = [];
      const usageReads: Promise<number>[] = [];
      let forceLength = false;
      const originalFetch = globalThis.fetch;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
        if (String(url).includes('/chat/completions') && init?.body) {
          const body = JSON.parse(String(init.body));
          requests.push(body.max_tokens ?? body.max_completion_tokens);
          // Exercise the >4K terminal boundary regardless of the small model's instruction following.
          if (forceLength) init = { ...init, body: JSON.stringify({ ...body, ignore_eos: true }) };
        }
        const response = await originalFetch(url, init);
        if (String(url).includes('/chat/completions') && response.ok) {
          usageReads.push(
            response
              .clone()
              .text()
              .then(text => {
                const usages = text
                  .split('\n')
                  .filter(line => line.startsWith('data: {'))
                  .map(line => JSON.parse(line.slice(6)))
                  .filter(frame => frame.usage);
                return usages.at(-1)?.usage?.completion_tokens ?? 0;
              }),
          );
        }
        return response;
      });
      const session = cowork.createSession(
        'Local output audit',
        root,
        '',
        CoworkExecutionMode.Local,
        [],
        'main',
        '',
        'chat',
      );
      await adapter.startSession(session.id, 'What is 2 + 3? Give only the number.', {
        workspaceRoot: root,
        sessionMode: 'chat',
      });
      expect(errors).toEqual([]);
      expect(complete).toBe(1);
      const firstMessages = cowork.getSession(session.id)!.messages;
      const answer = firstMessages
        .filter(message => message.type === 'assistant' && !message.metadata?.isThinking)
        .map(message => message.content)
        .join('\n');
      expect(answer).toContain('5');
      expect(requests[0]).toBeGreaterThan(4096);
      console.log(
        'LIVE_NORMAL',
        JSON.stringify({
          runtimeContext: running.runtimeContextLength,
          maxTokens: binding.maxTokens,
          requestMaxTokens: requests[0],
          answer,
        }),
      );
      const capped = buildLlamaCppRunningModelBinding(
        { name: binding.id, runtime_context_length: running.runtimeContextLength },
        { [binding.id]: { maxTokens: 16 } },
      )!;
      gateway.upsert(binding.id, { max_output_tokens: capped.maxTokens });
      const truncated = cowork.createSession(
        'Local truncation audit',
        root,
        '',
        CoworkExecutionMode.Local,
        [],
        'main',
        '',
        'chat',
      );
      await adapter.startSession(
        truncated.id,
        'List the integers from 1 to 2000, one per line. Continue until 2000.',
        { workspaceRoot: root, sessionMode: 'chat' },
      );
      expect(complete).toBe(1);
      expect(errors).toEqual([expect.objectContaining({ message: t('coworkOutputTruncated') })]);
      expect(requests.at(-1)).toBe(16);
      expect(
        cowork
          .getSession(truncated.id)!
          .messages.some(message => message.metadata?.error === t('coworkOutputTruncated')),
      ).toBe(true);
      console.log(
        'LIVE_TRUNCATED',
        JSON.stringify({
          requestMaxTokens: requests.at(-1),
          errors,
          complete,
          messages: cowork.getSession(truncated.id)!.messages.map(message => ({
            type: message.type,
            content: message.content,
            thinking: message.metadata?.isThinking,
          })),
        }),
      );
      gateway.upsert(binding.id, { max_output_tokens: 4500 });
      forceLength = true;
      const long = cowork.createSession(
        'Long local output audit',
        root,
        '',
        CoworkExecutionMode.Local,
        [],
        'main',
        '',
        'chat',
      );
      await adapter.startSession(
        long.id,
        'List all integers from 1 to 3000, one number per line. Do not skip any number or use ellipses. Keep counting until you reach 3000.',
        { workspaceRoot: root, sessionMode: 'chat' },
      );
      const usage = await Promise.all(usageReads);
      expect(requests.at(-1)).toBe(4500);
      expect(usage.at(-1)).toBe(4500);
      expect(complete).toBe(1);
      expect(errors).toHaveLength(2);
      expect(errors.at(-1)).toMatchObject({ message: t('coworkOutputTruncated') });
      console.log(
        'LIVE_LONG_OUTPUT',
        JSON.stringify({
          requests,
          completionTokens: usage,
          errors: errors.length,
          successfulCompletions: complete,
        }),
      );
    } catch (error) {
      console.error('LIVE_SERVER_TAIL', output.join('').slice(-5000));
      throw error;
    } finally {
      vi.restoreAllMocks();
      await adapter?.stopAllSessions();
      store?.close();
      await manager.stopAll();
      await rm(root, { recursive: true, force: true });
    }
  },
  240000,
);
