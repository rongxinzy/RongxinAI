import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';

// Exercise the pinned SDK implementation, bypassing this app's ESM type shim
// and mocked runtime adapter. These are the modules AgentSession uses itself.
import { DefaultResourceLoader } from '../../../../node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.js';
import { SettingsManager } from '../../../../node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js';
import { buildSystemPrompt } from '../../../../node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js';
import { CHAT_IDENTITY_PROMPT, createPiPromptOverrides } from './piPromptOverrides';

const identity = '你是知远智能体（ZhiYuan Agent）。自我介绍时使用这一名称；回答简洁、准确。';
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
  // Mirror AgentSession's public ResourceLoader -> buildSystemPrompt wiring.
  return buildSystemPrompt({
    cwd,
    customPrompt: loader.getSystemPrompt(),
    appendSystemPrompt: loader.getAppendSystemPrompt().join('\n\n'),
    selectedTools: ['read'],
    toolSnippets: { read: toolSnippet },
    promptGuidelines: [toolGuideline],
    contextFiles: loader.getAgentsFiles().agentsFiles,
    skills: loader.getSkills().skills,
  });
}

function expectDefaultPrompt(prompt: string) {
  expect(prompt).toContain('You are an expert coding assistant operating inside pi');
  expect(prompt).toContain(`- read: ${toolSnippet}`);
  expect(prompt).toContain(toolGuideline);
  expect(prompt).toContain('Be concise in your responses');
}

test('append override preserves the entire default prompt and tool guidelines', async () => {
  const baseline = createLoader();
  const appended = createLoader({
    systemPromptOverride: () => undefined,
    appendSystemPromptOverride: base => [...base, identity],
  });
  await baseline.reload();
  await appended.reload();
  const prompt = renderPrompt(appended);
  expectDefaultPrompt(prompt);
  expect(appended.getSystemPrompt()).toBeUndefined();
  expect(prompt.split(identity)).toHaveLength(2);
  expect(prompt.replace(`\n\n${identity}`, '')).toBe(renderPrompt(baseline));
});

test('a nonempty system override bypasses default tool descriptions and guidelines', async () => {
  const loader = createLoader({ systemPromptOverride: () => identity });
  await loader.reload();
  const prompt = renderPrompt(loader);
  expect(prompt).toContain(identity);
  expect(prompt).toContain(existingAppend);
  expect(prompt).not.toContain('Available tools:');
  expect(prompt).not.toContain(toolSnippet);
  expect(prompt).not.toContain(toolGuideline);
});

test('reload rebuilds append contributions without accumulating identity text', async () => {
  const loader = createLoader({
    systemPromptOverride: () => undefined,
    appendSystemPromptOverride: base => [...base, identity],
  });
  await loader.reload();
  const initial = renderPrompt(loader);
  await loader.reload();
  await loader.reload();
  expect(renderPrompt(loader)).toBe(initial);
  expect(loader.getAppendSystemPrompt()).toEqual([existingAppend, identity]);
});

test('append alone cannot restore defaults replaced by a discovered SYSTEM.md', async () => {
  await writeFile(path.join(agentDir, 'SYSTEM.md'), 'Custom file prompt.');
  const inherited = createLoader({ appendSystemPromptOverride: base => [...base, identity] });
  const defaults = createLoader({
    systemPromptOverride: () => undefined,
    appendSystemPromptOverride: base => [...base, identity],
  });
  await inherited.reload();
  await defaults.reload();
  expect(inherited.getSystemPrompt()).toBe('Custom file prompt.');
  expect(renderPrompt(inherited)).not.toContain(toolGuideline);
  expectDefaultPrompt(renderPrompt(defaults));
  expect(renderPrompt(defaults)).toContain(identity);
  expect(renderPrompt(defaults)).not.toContain('Custom file prompt.');
});

test('production Chat overrides preserve defaults and update fragments on continuation reload', async () => {
  await writeFile(path.join(agentDir, 'SYSTEM.md'), 'Ambient custom prompt.');
  const state = { chatMode: true, systemPrompt: 'Selected Chat skill.' };
  const loader = createLoader(createPiPromptOverrides(state, () => [toolGuideline]));
  await loader.reload();
  expectDefaultPrompt(renderPrompt(loader));
  expect(renderPrompt(loader)).toContain(state.systemPrompt);
  expect(renderPrompt(loader)).not.toContain('Ambient custom prompt.');
  expect(renderPrompt(loader).split(CHAT_IDENTITY_PROMPT)).toHaveLength(2);

  state.systemPrompt = 'Updated Chat skill.';
  await loader.reload();
  expectDefaultPrompt(renderPrompt(loader));
  expect(renderPrompt(loader)).toContain(state.systemPrompt);
  expect(renderPrompt(loader)).not.toContain('Selected Chat skill.');
  expect(renderPrompt(loader).split(CHAT_IDENTITY_PROMPT)).toHaveLength(2);
});

test('production Work overrides retain their existing prompt behavior without Chat identity', async () => {
  await writeFile(path.join(agentDir, 'SYSTEM.md'), 'Work base.');
  const state = { chatMode: false, systemPrompt: 'Work expert.' };
  const loader = createLoader(createPiPromptOverrides(state, () => [toolGuideline]));
  await loader.reload();
  expect(loader.getSystemPrompt()).toBe('Work base.\n\nWork expert.');
  expect(loader.getAppendSystemPrompt()).toEqual([existingAppend, toolGuideline]);
  expect(renderPrompt(loader)).not.toContain(CHAT_IDENTITY_PROMPT);
});
