import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { createAgentSession } from '../../../../node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.js';
import { ModelRuntime } from '../../../../node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.js';
import { DefaultResourceLoader } from '../../../../node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.js';
import { SessionManager } from '../../../../node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js';
import { SettingsManager } from '../../../../node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js';
import { estimateContextTokens } from '../../../../node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js';

const cases = [
  { name: 'new same-millisecond usage', newUsage: true, advanceMs: 0 },
  { name: 'new later usage', newUsage: true, advanceMs: 1 },
  { name: 'retained old same-millisecond usage', newUsage: false, advanceMs: 0 },
] as const;

for (const stopReason of ['stop', 'error'] as const) {
  test.each(cases)(
    `zero-usage ${stopReason} fallback respects $name`,
    async ({ newUsage, advanceMs }) => {
      let cwd: string | undefined;
      let session: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined;
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(new Date('2026-11-11T00:00:00Z'));
        cwd = await mkdtemp(path.join(tmpdir(), 'pi-fallback-boundary-'));
        const model = {
          id: 'audit',
          name: 'Audit',
          provider: 'boundary-audit',
          api: 'openai-completions' as const,
          baseUrl: 'http://unused.invalid/v1',
          reasoning: false,
          input: ['text' as const],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 16384,
          maxTokens: 1024,
        };
        const runtime = await ModelRuntime.create({
          authPath: path.join(cwd, 'auth.json'),
          modelsPath: null,
          allowModelNetwork: false,
        });
        runtime.registerProvider(model.provider, {
          api: model.api,
          baseUrl: model.baseUrl,
          models: [model],
        });
        await runtime.setRuntimeApiKey(model.provider, 'offline-test');
        const settings = SettingsManager.inMemory();
        const loader = new DefaultResourceLoader({
          cwd,
          agentDir: cwd,
          settingsManager: settings,
          noContextFiles: true,
          noSkills: true,
          noExtensions: true,
          noPromptTemplates: true,
          noThemes: true,
        });
        await loader.reload();
        settings.applyOverrides({
          compaction: { enabled: true, reserveTokens: 4096, keepRecentTokens: 2048 },
        });
        const manager = SessionManager.inMemory(cwd);
        const message = (
          text: string,
          input: number,
          reason: 'stop' | 'error' = 'stop',
        ): AssistantMessage => ({
          role: 'assistant',
          api: model.api,
          provider: model.provider,
          model: model.id,
          timestamp: Date.now(),
          content: [{ type: 'text', text }],
          stopReason: reason,
          ...(reason === 'error' ? { errorMessage: 'Non-retryable offline fixture failure.' } : {}),
          usage: {
            input,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: input,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        });
        const firstKept = manager.appendMessage({
          role: 'user',
          content: 'Earlier work. '.repeat(1000),
          timestamp: Date.now(),
        });
        if (!newUsage) manager.appendMessage(message('Old uncompressed context usage.', 12000));
        manager.appendCompaction('Prior work was summarized.', firstKept, 15000);
        vi.setSystemTime(Date.now() + advanceMs);
        if (newUsage) manager.appendMessage(message('New compressed context usage.', 12000));
        manager.appendMessage(message('Trailing material. '.repeat(1000), 0, stopReason));
        // No context_edit entries: exercise the usage fallback rather than the
        // separate projection estimator. Both fixtures estimate above 12288;
        // only persisted order makes the retained old usage invalid.
        expect(manager.getBranch().some(entry => entry.type === 'context_edit')).toBe(false);
        const estimate = estimateContextTokens(manager.buildSessionProjection().messages);
        expect(estimate.usageTokens).toBe(12000);
        expect(estimate.trailingTokens).toBe(4750);
        expect(estimate.tokens).toBeGreaterThan(model.contextWindow - 4096);
        ({ session } = await createAgentSession({
          cwd,
          model,
          modelRuntime: runtime,
          resourceLoader: loader,
          settingsManager: settings,
          sessionManager: manager,
          tools: [],
        }));
        const compactions: string[] = [];
        session.subscribe(event => {
          if (event.type === 'compaction_end' && event.result) compactions.push(event.reason);
        });
        // The real SDK performs projection, pre-prompt checks and summarization.
        // Only provider responses are offline; this is not live-model acceptance.
        session.agent.streamFunction = () => {
          const stream = createAssistantMessageEventStream();
          stream.push({ type: 'done', reason: 'stop', message: message('Concise response.', 100) });
          return stream;
        };
        await session.prompt('Continue.');
        expect(compactions).toEqual(newUsage ? ['threshold'] : []);
      } finally {
        try {
          if (session) {
            try {
              await session.abort();
            } finally {
              session.dispose();
            }
          }
        } finally {
          try {
            if (cwd) await rm(cwd, { recursive: true, force: true });
          } finally {
            vi.useRealTimers();
          }
        }
      }
    },
  );
}
