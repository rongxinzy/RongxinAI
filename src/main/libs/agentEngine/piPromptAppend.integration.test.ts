import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';
import { buildSystemPrompt } from '../../../../node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js';
import {
  CHAT_IDENTITY_PROMPT,
  createPiPromptOverrides,
  getZhiyuanProductPreamble,
} from './piPromptOverrides';
import { ensureNativeSystemPromptSections } from './piRuntimeResourceLoader';

const identity = getZhiyuanProductPreamble();
const toolSnippet = 'Read a file for this integration test.';
const toolGuideline = 'Preserve the test tool usage contract.';
const existingAppend = 'Existing application policy.';
let directory: string;
let cwd: string;
let agentDir: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'pi-prompt-append-'));
  cwd = path.join(directory, 'workspace');
  agentDir = path.join(directory, 'agent');
  await Promise.all([mkdir(cwd), mkdir(agentDir)]);
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function createLoader(
  overrides: {
    systemPromptOverride?: (base: string | undefined) => string | undefined;
    appendSystemPromptOverride?: (base: string[]) => string[];
  } = {},
) {
  return new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager: SettingsManager.inMemory(),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    appendSystemPrompt: [existingAppend],
    ...overrides,
  });
}

function renderPrompt(loader: DefaultResourceLoader): string {
  // Mirror AgentSession's public ResourceLoader -> BeforeAgentStart -> buildSystemPrompt wiring.
  const options = {
    cwd,
    customPrompt: loader.getSystemPrompt(),
    appendSystemPrompt: loader.getAppendSystemPrompt().join('\n\n'),
    selectedTools: ['read'],
    toolSnippets: { read: toolSnippet },
    promptGuidelines: [toolGuideline],
    contextFiles: loader.getAgentsFiles().agentsFiles,
    skills: loader.getSkills().skills,
    sections: {} as Record<string, string>,
  };
  ensureNativeSystemPromptSections(options);
  return buildSystemPrompt(options);
}

function expectZhiyuanPrompt(prompt: string) {
  expect(prompt).toContain(getZhiyuanProductPreamble());
  expect(prompt).not.toContain('You are a coding assistant running inside pi');
  expect(prompt).not.toContain('Pi documentation');
  expect(prompt).not.toContain('<docs>');
  expect(prompt).toContain('<tools>');
  expect(prompt).toContain(`- read: ${toolSnippet}`);
  expect(prompt).toContain('<rules>');
  expect(prompt).toContain(toolGuideline);
  expect(prompt).toContain('Be concise in your responses');
}

test('append override with ZhiYuan preamble preserves native tools and rules while eliminating docs and English preamble', async () => {
  const appended = createLoader({
    systemPromptOverride: () => getZhiyuanProductPreamble(),
    appendSystemPromptOverride: base => [...base, 'Extra policy.'],
  });
  await appended.reload();
  const prompt = renderPrompt(appended);
  expectZhiyuanPrompt(prompt);
  expect(prompt).toContain('Extra policy.');
  expect(prompt).toContain(existingAppend);
  expect(appended.getSystemPrompt()).toBe(getZhiyuanProductPreamble());
});

test('a nonempty system override with ensureNativeSystemPromptSections retains tools and rules', async () => {
  const loader = createLoader({ systemPromptOverride: () => identity });
  await loader.reload();
  const prompt = renderPrompt(loader);
  expect(prompt).toContain(identity);
  expect(prompt).toContain(existingAppend);
  expect(prompt).toContain('<tools>');
  expect(prompt).toContain(toolSnippet);
  expect(prompt).toContain(toolGuideline);
  expect(prompt).not.toContain('<docs>');
  expect(prompt).not.toContain('You are a coding assistant running inside pi');
});

test('reload rebuilds append contributions without accumulating identity text', async () => {
  const loader = createLoader({
    systemPromptOverride: () => getZhiyuanProductPreamble(),
    appendSystemPromptOverride: base => [...base, 'Extra policy.'],
  });
  await loader.reload();
  const initial = renderPrompt(loader);
  await loader.reload();
  await loader.reload();
  expect(renderPrompt(loader)).toBe(initial);
  expect(loader.getAppendSystemPrompt()).toEqual([existingAppend, 'Extra policy.']);
});

test('production overrides replace SYSTEM.md with Chinese product preamble while keeping tools/rules', async () => {
  await writeFile(path.join(agentDir, 'SYSTEM.md'), 'Custom file prompt.');
  const defaults = createLoader(
    createPiPromptOverrides({ chatMode: false, systemPrompt: 'Work expert.' }, () => [
      toolGuideline,
    ]),
  );
  await defaults.reload();
  expect(defaults.getSystemPrompt()).toBe(getZhiyuanProductPreamble());
  const prompt = renderPrompt(defaults);
  expectZhiyuanPrompt(prompt);
  expect(prompt).not.toContain('Custom file prompt.');
  expect(prompt).toContain('Work expert.');
});

test('production Chat overrides preserve Chinese product preamble, chat identity, and tools/rules', async () => {
  await writeFile(path.join(agentDir, 'SYSTEM.md'), 'Ambient custom prompt.');
  const state = { chatMode: true, systemPrompt: 'Selected Chat skill.' };
  const loader = createLoader(createPiPromptOverrides(state, () => [toolGuideline]));
  await loader.reload();
  expect(loader.getSystemPrompt()).toBe(getZhiyuanProductPreamble());
  expectZhiyuanPrompt(renderPrompt(loader));
  expect(renderPrompt(loader)).toContain(state.systemPrompt);
  expect(renderPrompt(loader)).not.toContain('Ambient custom prompt.');
  expect(renderPrompt(loader).split(CHAT_IDENTITY_PROMPT)).toHaveLength(2);

  state.systemPrompt = 'Updated Chat skill.';
  await loader.reload();
  expectZhiyuanPrompt(renderPrompt(loader));
  expect(renderPrompt(loader)).toContain(state.systemPrompt);
  expect(renderPrompt(loader)).not.toContain('Selected Chat skill.');
  expect(renderPrompt(loader).split(CHAT_IDENTITY_PROMPT)).toHaveLength(2);
});

test('production Work preserves native tools and appends expert instructions with Chinese product preamble', async () => {
  await writeFile(path.join(agentDir, 'SYSTEM.md'), 'Work base.');
  const state = { chatMode: false, systemPrompt: 'Work expert.' };
  const loader = createLoader(createPiPromptOverrides(state, () => [toolGuideline]));
  await loader.reload();
  expect(loader.getSystemPrompt()).toBe(getZhiyuanProductPreamble());
  expectZhiyuanPrompt(renderPrompt(loader));
  expect(renderPrompt(loader)).toContain('Work expert.');
  expect(renderPrompt(loader)).not.toContain('Work base.');
  expect(loader.getAppendSystemPrompt()).toEqual([existingAppend, toolGuideline, 'Work expert.']);
  expect(renderPrompt(loader)).not.toContain(CHAT_IDENTITY_PROMPT);
});
