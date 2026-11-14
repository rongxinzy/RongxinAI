import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels, getCurrentSystemPrompt } from '@earendil-works/pi-ai';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import {
  createRegistry,
  defineExtension,
  defineTool,
  Harness,
  MemoryStorage,
} from '@earendil-works/pi-durable';
import { obj } from '@earendil-works/pi-schema';
import { expect } from 'vitest';
import { getZhiyuanProductPreamble } from '../../src/main/libs/agentEngine/piPromptOverrides';
import { createPiRuntimeResourceLoader } from '../../src/main/libs/agentEngine/piRuntimeResourceLoader';
import type { PiResourceState } from '../../src/main/libs/agentEngine/piRuntimeSessionState';

const FORBIDDEN = ['You are a coding assistant running inside pi', '<docs>', 'Pi documentation'];

export function assertNoLeakage(prompt: string): void {
  for (const fragment of FORBIDDEN) expect(prompt).not.toContain(fragment);
}

export function assertProductIdentity(prompt: string): void {
  expect(prompt.split(getZhiyuanProductPreamble())).toHaveLength(2);
  expect(prompt).not.toContain('<preamble>');
}

export function assertWellFormedXmlTags(prompt: string, sections: string[]): void {
  for (const name of sections) {
    const opening = `<${name}>`;
    const closing = `</${name}>`;
    expect(prompt.split(opening).length - 1).toBeGreaterThan(0);
    expect(prompt.split(opening).length).toBe(prompt.split(closing).length);
    expect(prompt.indexOf(opening)).toBeLessThan(prompt.indexOf(closing));
  }
}

/** Capture the real provider-facing prompt after native Durable preparation. */
export async function createDurablePromptFixture(options: {
  cwd: string;
  state?: Partial<PiResourceState>;
  tools?: Array<{ name: string; description: string }>;
}) {
  const state: PiResourceState = {
    systemPrompt: '',
    skillIds: [],
    maxOutputTokens: 4096,
    fileToolsEnabled: true,
    unattended: false,
    chatMode: false,
    expertSkillDirs: [],
    skillRoots: {},
    ...options.state,
  };
  const resources = await createPiRuntimeResourceLoader(
    { activeSessions: new Map(), getMcpServerManager: () => null } as never,
    options.cwd,
    state,
  );
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  for (const extension of resources.extensions) registry.install(extension);
  const tools = options.tools ?? [{ name: 'read', description: 'Read a file.' }];
  const registered = tools.map(tool =>
    defineTool({
      ...tool,
      parameters: obj({}),
      execute: async () => ({ output: [{ type: 'text' as const, text: 'read' }] }),
    }),
  );
  registry.install(
    defineExtension({
      name: 'test.prompt-tools',
      tools: registered,
    }),
  );
  const context = BACKGROUND_CONTEXT;
  const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);
  const model = faux.getModel();
  const conversation = await harness.root(context, {
    agent: {
      model: { provider: model.provider, modelId: model.id },
      instructions: resources.getSystemPrompt(),
      modelTools: registered,
    },
  });
  return {
    state,
    resources,
    async capture() {
      let prompt = '';
      faux.setResponses([
        request => {
          prompt = getCurrentSystemPrompt(request.messages) ?? '';
          return fauxAssistantMessage('Hello');
        },
      ]);
      await resources.reload();
      for (const extension of resources.extensions) registry.install(extension);
      await conversation.configure({ instructions: resources.getSystemPrompt() }, context);
      const submission = await conversation.submit({ type: 'input', content: 'Hello' }, context);
      expect((await submission.wait(context)).status).toBe('done');
      return prompt;
    },
    async close() {
      await harness.close(context);
      await resources.close?.();
    },
  };
}
