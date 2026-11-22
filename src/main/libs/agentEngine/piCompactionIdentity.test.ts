import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, type Model } from '@earendil-works/pi-ai/compat';

test.each(['manual', 'threshold'] as const)(
  'reports the newly committed %s compaction when its summary repeats',
  async reason => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'pi-compaction-identity-'));
    const model: Model<'openai-completions'> = {
      api: 'openai-completions',
      provider: 'compaction-fixture',
      id: 'identity',
      name: 'Identity',
      baseUrl: 'http://127.0.0.1:1',
      reasoning: false,
      input: ['text'],
      contextWindow: 32768,
      maxTokens: 1024,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    const assistant = (text: string) => ({
      role: 'assistant' as const,
      api: model.api,
      provider: model.provider,
      model: model.id,
      timestamp: Date.now(),
      content: [{ type: 'text' as const, text }],
      stopReason: 'stop' as const,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    });
    const manager = SessionManager.inMemory(cwd);
    const appendUser = (content: string) =>
      manager.appendMessage({ role: 'user', content, timestamp: Date.now() });
    const first = appendUser('prior turn');
    manager.appendMessage(assistant('prior response'));
    const summary = 'The same summary';
    const oldId = manager.appendCompaction(summary, first, 500);
    appendUser('historical context '.repeat(9000));
    manager.appendMessage(assistant('processed'));
    appendUser('recent turn');
    manager.appendMessage(assistant('recent response'));
    const compactions: Array<{ id: string; reason: string }> = [];
    const settings = SettingsManager.inMemory({
      compaction: { enabled: true, reserveTokens: 4096, keepRecentTokens: 64 },
    });
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
    await runtime.setRuntimeApiKey(model.provider, 'fixture-only');
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: cwd,
      settingsManager: settings,
      noContextFiles: true,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      extensionFactories: [
        api => {
          api.on('session_before_compact', event => ({
            compaction: {
              summary,
              firstKeptEntryId: event.preparation.firstKeptEntryId,
              tokensBefore: 50000,
            },
          }));
          api.on('session_compact', event => {
            compactions.push({ id: event.compactionEntry.id, reason: event.reason });
          });
        },
      ],
    });
    await resourceLoader.reload();
    const { session } = await createAgentSession({
      cwd,
      agentDir: cwd,
      model,
      modelRuntime: runtime,
      noTools: 'all',
      resourceLoader,
      sessionManager: manager,
      settingsManager: settings,
    });
    try {
      session.agent.streamFunction = () => {
        const stream = createAssistantMessageEventStream();
        stream.push({ type: 'done', reason: 'stop', message: assistant('reply') });
        stream.end();
        return stream;
      };
      if (reason === 'manual') await session.compact();
      else await session.prompt('continue');

      const entries = manager.getEntries().filter(entry => entry.type === 'compaction');
      expect(entries.length).toBeGreaterThan(1);
      expect(entries.every(entry => entry.summary === summary)).toBe(true);
      expect(entries[0].id).toBe(oldId);
      expect(compactions).toEqual(entries.slice(1).map(({ id }) => ({ id, reason })));
    } finally {
      session.dispose();
      await rm(cwd, { recursive: true, force: true });
    }
  },
);
