import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect } from 'vitest';
import {
  DefaultResourceLoader,
  SettingsManager,
} from '../../node_modules/@earendil-works/pi-coding-agent/dist/index.js';
import { buildSystemPrompt } from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js';
import {
  createPiPromptOverrides,
  getZhiyuanProductPreamble,
} from '../../src/main/libs/agentEngine/piPromptOverrides';
import { ensureNativeSystemPromptSections } from '../../src/main/libs/agentEngine/piRuntimeResourceLoader';
import { collectPiSystemPromptContributions } from '../../src/main/libs/agentEngine/piSystemPromptContributions';

const FORBIDDEN_FRAGMENTS = [
  'You are a coding assistant running inside pi',
  '<docs>',
  '</docs>',
  'Pi documentation',
  'docs/extensions.md',
  'examples/extensions/',
  'docs/themes.md',
  'docs/skills.md',
  'docs/prompt-templates.md',
  'docs/tui.md',
  'docs/keybindings.md',
  'docs/sdk.md',
  'docs/custom-provider.md',
  'docs/models.md',
  'docs/packages.md',
  'docs/environment-variables.md',
  'docs/mcp.md',
  'docs/codemode.md',
];

/** Verifies that none of the forbidden Pi leakage strings appear. */
export function assertNoLeakage(prompt: string, context = '') {
  for (const forbidden of FORBIDDEN_FRAGMENTS) {
    expect(
      prompt.includes(forbidden),
      `Leakage detected in prompt [${context}]: contains "${forbidden}"`,
    ).toBe(false);
  }
}

/** Verifies that the Chinese ZhiYuan preamble is cleanly rendered at top level. */
export function assertTopLevelPreamble(prompt: string) {
  const preamble = getZhiyuanProductPreamble();
  expect(prompt.startsWith(preamble)).toBe(true);
  expect(prompt).not.toContain('<preamble>');
  expect(prompt).not.toContain('</preamble>');
}

/** Validates XML tags syntax and balancing for top-level sections. */
export function assertWellFormedXmlTags(
  prompt: string,
  expectedSections: string[] = ['tools', 'rules', 'cwd'],
) {
  for (const tag of expectedSections) {
    const openTag = `<${tag}>`;
    const closeTag = `</${tag}>`;

    const openCount = (prompt.match(new RegExp(openTag, 'g')) || []).length;
    const closeCount = (prompt.match(new RegExp(closeTag, 'g')) || []).length;

    expect(
      openCount,
      `Tag <${tag}> should appear at least once (actual: ${openCount})`,
    ).toBeGreaterThanOrEqual(1);
    expect(openCount, `Mismatch in opening and closing counts for tag <${tag}>`).toBe(closeCount);

    const openIdx = prompt.indexOf(openTag);
    const closeIdx = prompt.indexOf(closeTag);
    expect(openIdx, `<${tag}> must appear before </${tag}>`).toBeLessThan(closeIdx);
  }
}

export async function createPromptTestDirs() {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'pi-leak-test-'));
  const cwd = path.join(tempDir, 'workspace');
  const agentDir = path.join(tempDir, 'agent');
  await Promise.all([mkdir(cwd), mkdir(agentDir)]);
  return {
    tempDir,
    cwd,
    agentDir,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}

export function createPromptTestLoader(
  cwd: string,
  agentDir: string,
  state: {
    chatMode: boolean;
    systemPrompt: string;
    unattended?: boolean;
    fileToolsEnabled?: boolean;
  },
) {
  const contributions = () =>
    collectPiSystemPromptContributions({
      chatMode: state.chatMode,
      fileToolsEnabled: state.fileToolsEnabled ?? true,
      maxOutputTokens: 4096,
      unattended: state.unattended ?? false,
    });

  return new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager: SettingsManager.inMemory(),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    ...createPiPromptOverrides(state, contributions),
  });
}

export function renderPromptWithOptions(
  cwd: string,
  loader: DefaultResourceLoader,
  partialOptions: {
    selectedTools?: string[];
    hiddenTools?: string[];
    toolSnippets?: Record<string, string>;
    toolGuidelines?: Record<string, string[]>;
    promptGuidelines?: string[];
    skills?: Array<{ name: string; description: string; filePath: string }>;
  } = {},
): string {
  const options = {
    cwd,
    customPrompt: loader.getSystemPrompt(),
    appendSystemPrompt: loader.getAppendSystemPrompt().join('\n\n'),
    selectedTools: partialOptions.selectedTools ?? ['read', 'bash', 'edit', 'write'],
    hiddenTools: partialOptions.hiddenTools ?? [],
    toolSnippets: partialOptions.toolSnippets ?? {
      read: 'Read a file.',
      bash: 'Execute bash commands.',
      edit: 'Edit a file.',
      write: 'Write a file.',
    },
    toolGuidelines: partialOptions.toolGuidelines ?? {},
    promptGuidelines: partialOptions.promptGuidelines ?? [],
    contextFiles: loader.getAgentsFiles().agentsFiles,
    skills: partialOptions.skills ?? [],
    sections: {} as Record<string, string>,
  };
  ensureNativeSystemPromptSections(options);
  return buildSystemPrompt(options);
}
