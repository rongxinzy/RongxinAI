import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { Type } from 'typebox';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
// Exercise the installed SDK, without the adapter's test doubles or a live provider.
import { createAgentSession } from '../../../../node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.js';
import { ModelRuntime } from '../../../../node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.js';
import { DefaultResourceLoader } from '../../../../node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.js';
import { SessionManager } from '../../../../node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js';
import { SettingsManager } from '../../../../node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js';
import { createPiPromptOverrides } from './piPromptOverrides';
import { PiGoalModePrompt } from './piRuntimeWorkbenchContract';

test.each(['threshold', 'overflow'] as const)(
  'native SDK finishes 32 tool steps across %s compaction without harness continuation',
  async reason => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'pi-native-long-task-'));
    const runtime = await ModelRuntime.create({
      authPath: path.join(cwd, 'auth.json'),
      modelsPath: null,
      allowModelNetwork: false,
    });
    const model = {
      id: 'audit',
      name: 'Audit',
      provider: 'harness-audit',
      api: 'openai-completions' as const,
      baseUrl: 'http://unused.invalid/v1',
      reasoning: false,
      input: ['text' as const],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 16384,
      maxTokens: 1024,
    };
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
      ...createPiPromptOverrides(
        { chatMode: false, systemPrompt: 'You are the assigned specialist.' },
        () => [],
      ),
    });
    await loader.reload();
    let completed = 0;
    let summaries = 0;
    let overflowSent = false;
    const events: string[] = [];
    const compactions: string[] = [];
    const { session } = await createAgentSession({
      cwd,
      model,
      modelRuntime: runtime,
      resourceLoader: loader,
      settingsManager: settings,
      sessionManager: SessionManager.inMemory(cwd),
      tools: ['record_step'],
      customTools: [
        {
          name: 'record_step',
          label: 'Record step',
          description: 'Record the next verified step.',
          parameters: Type.Object({ step: Type.Number() }),
          execute: async (_id, input) => {
            expect(input.step).toBe(completed + 1);
            completed = input.step;
            await writeFile(path.join(cwd, `step-${completed}.txt`), `verified ${completed}`);
            return {
              content: [
                { type: 'text', text: `Completed ${completed}. ${'evidence '.repeat(2500)}` },
              ],
              details: {},
            };
          },
        },
      ],
    });
    session.subscribe(event => {
      events.push(event.type);
      if (event.type === 'compaction_end' && event.result) compactions.push(event.reason);
    });
    session.agent.streamFunction = (_model, context) => {
      const stream = createAssistantMessageEventStream();
      const summary = JSON.stringify(context).includes('context summarization assistant');
      const overflow = !summary && reason === 'overflow' && completed === 6 && !overflowSent;
      if (overflow) overflowSent = true;
      if (summary) summaries += 1;
      const message: AssistantMessage = {
        role: 'assistant',
        api: model.api,
        provider: model.provider,
        model: model.id,
        timestamp: Date.now(),
        content: summary
          ? [
              {
                type: 'text',
                text: `Verified steps 1-${completed}. Next step ${completed + 1}. Goal: 32 verified files.`,
              },
            ]
          : completed < 32 && !overflow
            ? [
                {
                  type: 'toolCall',
                  id: `step-${completed + 1}`,
                  name: 'record_step',
                  arguments: { step: completed + 1 },
                },
              ]
            : [{ type: 'text', text: overflow ? '' : 'All 32 files are verified.' }],
        stopReason: overflow ? 'error' : summary || completed === 32 ? 'stop' : 'toolUse',
        ...(overflow
          ? { errorMessage: 'context_length_exceeded: maximum context length exceeded' }
          : {}),
        usage: {
          input: summary ? 100 : Math.ceil(JSON.stringify(context).length / 4),
          output: 64,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      };
      if (overflow) stream.push({ type: 'error', reason: 'error', error: message });
      else
        stream.push({
          type: 'done',
          reason: message.stopReason === 'toolUse' ? 'toolUse' : 'stop',
          message,
        });
      return stream;
    };
    // A fixed clock proves post-compaction recovery does not depend on time
    // advancing between a summary and the next provider response.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      await session.prompt(`${PiGoalModePrompt}\nCreate and verify 32 files.`);
      expect(session.agent.state.systemPrompt).toContain(
        'You are a coding assistant running inside pi',
      );
      expect(session.agent.state.systemPrompt).toContain('You are the assigned specialist.');
      expect(completed).toBe(32);
      expect(summaries).toBeGreaterThan(1);
      expect(compactions).toContain(reason);
      expect(events.filter(event => event === 'agent_settled')).toHaveLength(1);
      expect((await readdir(cwd)).filter(name => /^step-\d+\.txt$/.test(name))).toHaveLength(32);
      expect(await readFile(path.join(cwd, 'step-32.txt'), 'utf8')).toBe('verified 32');
    } finally {
      await session.abort();
      session.dispose();
      await rm(cwd, { recursive: true, force: true });
      vi.useRealTimers();
    }
  },
);
