import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { CHAT_IDENTITY_PROMPT } from '../src/main/libs/agentEngine/piPromptOverrides';
import { PiUnattendedSystemPrompt } from '../src/main/libs/agentEngine/piUnattendedPolicy';
import { SessionSummarySystemPrompt } from '../src/main/sessionSummary/tool';
import {
  assertNoLeakage,
  assertTopLevelPreamble,
  assertWellFormedXmlTags,
  createPromptTestDirs,
  createPromptTestLoader,
  renderPromptWithOptions,
} from './helpers/promptLeakAssertions';

describe('Milestone 1 Empirical Stress Test: Prompt Leak & XML Formatting', () => {
  let dirs: Awaited<ReturnType<typeof createPromptTestDirs>>;

  beforeEach(async () => {
    dirs = await createPromptTestDirs();
  });

  afterEach(async () => {
    await dirs.cleanup();
  });

  describe('Work Mode vs Chat Mode Permutations', () => {
    test('Work mode: contains Chinese preamble, preserves tools/rules, includes session summary, excludes chat identity', async () => {
      const loader = createPromptTestLoader(dirs.cwd, dirs.agentDir, {
        chatMode: false,
        systemPrompt: 'Work expert task.',
      });
      await loader.reload();
      const prompt = renderPromptWithOptions(dirs.cwd, loader);

      assertTopLevelPreamble(prompt);
      assertNoLeakage(prompt, 'Work mode');
      assertWellFormedXmlTags(prompt, ['tools', 'rules', 'cwd', 'addendum']);

      expect(prompt).toContain('Work expert task.');
      expect(prompt).toContain(SessionSummarySystemPrompt);
      expect(prompt).not.toContain(CHAT_IDENTITY_PROMPT);
      expect(prompt).toContain('<tools>');
      expect(prompt).toContain('- read: Read a file.');
      expect(prompt).toContain('<rules>');
      expect(prompt).toContain('- Be concise in your responses');
    });

    test('Chat mode: contains Chinese preamble, preserves tools/rules, includes chat identity, excludes session summary', async () => {
      const loader = createPromptTestLoader(dirs.cwd, dirs.agentDir, {
        chatMode: true,
        systemPrompt: 'Chat greeting.',
      });
      await loader.reload();
      const prompt = renderPromptWithOptions(dirs.cwd, loader);

      assertTopLevelPreamble(prompt);
      assertNoLeakage(prompt, 'Chat mode');
      assertWellFormedXmlTags(prompt, ['tools', 'rules', 'cwd', 'addendum']);

      expect(prompt).toContain('Chat greeting.');
      expect(prompt).toContain(CHAT_IDENTITY_PROMPT);
      expect(prompt).not.toContain(SessionSummarySystemPrompt);
    });
  });

  describe('Tools Loadout Permutations (0 Tools vs Multiple Tools)', () => {
    test('Zero tools: renders <tools>(none)</tools> with well-formed tags and no crash', async () => {
      const loader = createPromptTestLoader(dirs.cwd, dirs.agentDir, {
        chatMode: false,
        systemPrompt: '',
      });
      await loader.reload();
      const prompt = renderPromptWithOptions(dirs.cwd, loader, {
        selectedTools: [],
        toolSnippets: {},
      });

      assertTopLevelPreamble(prompt);
      assertNoLeakage(prompt, '0 tools');
      assertWellFormedXmlTags(prompt, ['tools', 'rules', 'cwd']);

      expect(prompt).toContain('<tools>\n(none)\n</tools>');
      expect(prompt).toContain('<rules>');
      expect(prompt).toContain('- Be concise in your responses');
      expect(prompt).toContain('- Show file paths clearly when working with files');
      expect(prompt).not.toContain('Use bash for file operations');
    });

    test('Single tool without snippet: visibleTools empty -> renders (none)', async () => {
      const loader = createPromptTestLoader(dirs.cwd, dirs.agentDir, {
        chatMode: false,
        systemPrompt: '',
      });
      await loader.reload();
      const prompt = renderPromptWithOptions(dirs.cwd, loader, {
        selectedTools: ['custom_secret_tool'],
        toolSnippets: {},
      });

      assertTopLevelPreamble(prompt);
      assertNoLeakage(prompt, 'Tool without snippet');
      assertWellFormedXmlTags(prompt, ['tools', 'rules', 'cwd']);
      expect(prompt).toContain('<tools>\n(none)\n</tools>');
    });

    test('Multiple tools with bash, powershell, native search (grep, find, ls)', async () => {
      const loader = createPromptTestLoader(dirs.cwd, dirs.agentDir, {
        chatMode: false,
        systemPrompt: '',
      });
      await loader.reload();
      const prompt = renderPromptWithOptions(dirs.cwd, loader, {
        selectedTools: ['bash', 'powershell', 'grep', 'find', 'ls', 'read'],
        toolSnippets: {
          bash: 'Execute bash commands',
          powershell: 'Execute powershell commands',
          grep: 'Fast text search',
          find: 'Fast file search',
          ls: 'List directory',
          read: 'Read file',
        },
      });

      assertTopLevelPreamble(prompt);
      assertNoLeakage(prompt, 'Bash + search tools');
      assertWellFormedXmlTags(prompt, ['tools', 'rules', 'cwd']);

      expect(prompt).not.toContain('Use bash or PowerShell for file operations');
      expect(prompt).not.toContain('Use bash for file operations like ls, rg, find');
      expect(prompt).toContain('- grep: Fast text search');
      expect(prompt).toContain('- find: Fast file search');
      expect(prompt).toContain('- ls: List directory');
    });

    test('Bash only without grep/find/ls emits bash fallback rule', async () => {
      const loader = createPromptTestLoader(dirs.cwd, dirs.agentDir, {
        chatMode: false,
        systemPrompt: '',
      });
      await loader.reload();
      const prompt = renderPromptWithOptions(dirs.cwd, loader, {
        selectedTools: ['bash', 'read'],
        toolSnippets: { bash: 'Execute bash', read: 'Read file' },
      });

      assertTopLevelPreamble(prompt);
      assertNoLeakage(prompt, 'Bash only fallback rule');
      assertWellFormedXmlTags(prompt, ['tools', 'rules', 'cwd']);
      expect(prompt).toContain('Use bash for file operations like ls, rg, find');
    });

    test('PowerShell only without grep/find/ls emits powershell fallback rule', async () => {
      const loader = createPromptTestLoader(dirs.cwd, dirs.agentDir, {
        chatMode: false,
        systemPrompt: '',
      });
      await loader.reload();
      const prompt = renderPromptWithOptions(dirs.cwd, loader, {
        selectedTools: ['powershell', 'read'],
        toolSnippets: { powershell: 'Execute powershell', read: 'Read file' },
      });

      assertTopLevelPreamble(prompt);
      assertNoLeakage(prompt, 'PowerShell only fallback rule');
      assertWellFormedXmlTags(prompt, ['tools', 'rules', 'cwd']);
      expect(prompt).toContain(
        'Use PowerShell for file operations like listing, searching, and finding files',
      );
    });

    test('Both bash and powershell without grep/find/ls emits combined rule', async () => {
      const loader = createPromptTestLoader(dirs.cwd, dirs.agentDir, {
        chatMode: false,
        systemPrompt: '',
      });
      await loader.reload();
      const prompt = renderPromptWithOptions(dirs.cwd, loader, {
        selectedTools: ['bash', 'powershell', 'read'],
        toolSnippets: { bash: 'Execute bash', powershell: 'Execute powershell', read: 'Read file' },
      });

      assertTopLevelPreamble(prompt);
      assertNoLeakage(prompt, 'Bash and PowerShell combined fallback rule');
      assertWellFormedXmlTags(prompt, ['tools', 'rules', 'cwd']);
      expect(prompt).toContain(
        'Use bash or PowerShell for file operations like listing, searching, and finding files',
      );
    });
  });

  describe('Hidden Tools Permutations', () => {
    test('Hidden tools do NOT appear in <tools> section', async () => {
      const loader = createPromptTestLoader(dirs.cwd, dirs.agentDir, {
        chatMode: false,
        systemPrompt: '',
      });
      await loader.reload();
      const prompt = renderPromptWithOptions(dirs.cwd, loader, {
        selectedTools: ['read', 'bash', 'write'],
        hiddenTools: ['bash'],
        toolSnippets: {
          read: 'Read file',
          bash: 'Run bash',
          write: 'Write file',
        },
      });

      assertTopLevelPreamble(prompt);
      assertNoLeakage(prompt, 'Hidden tool');
      assertWellFormedXmlTags(prompt, ['tools', 'rules', 'cwd']);

      expect(prompt).toContain('- read: Read file');
      expect(prompt).toContain('- write: Write file');
      expect(prompt).not.toContain('- bash: Run bash');
      expect(prompt).not.toContain('Use bash for file operations');
    });

    test('Hidden tool guidelines do NOT leak into <rules>', async () => {
      const loader = createPromptTestLoader(dirs.cwd, dirs.agentDir, {
        chatMode: false,
        systemPrompt: '',
      });
      await loader.reload();
      const prompt = renderPromptWithOptions(dirs.cwd, loader, {
        selectedTools: ['read', 'dangerous_tool'],
        hiddenTools: ['dangerous_tool'],
        toolSnippets: { read: 'Read file', dangerous_tool: 'Dangerous action' },
        toolGuidelines: {
          dangerous_tool: ['NEVER RUN THIS TOOL WITHOUT CLEARANCE'],
          read: ['Read files with care'],
        },
      });

      assertTopLevelPreamble(prompt);
      assertNoLeakage(prompt, 'Hidden tool guidelines');
      assertWellFormedXmlTags(prompt, ['tools', 'rules', 'cwd']);

      expect(prompt).toContain('- Read files with care');
      expect(prompt).not.toContain('NEVER RUN THIS TOOL WITHOUT CLEARANCE');
    });

    test('All tools hidden: results in <tools>(none)</tools> without leakage', async () => {
      const loader = createPromptTestLoader(dirs.cwd, dirs.agentDir, {
        chatMode: false,
        systemPrompt: '',
      });
      await loader.reload();
      const prompt = renderPromptWithOptions(dirs.cwd, loader, {
        selectedTools: ['read', 'write'],
        hiddenTools: ['read', 'write'],
        toolSnippets: { read: 'Read file', write: 'Write file' },
      });

      assertTopLevelPreamble(prompt);
      assertNoLeakage(prompt, 'All tools hidden');
      assertWellFormedXmlTags(prompt, ['tools', 'rules', 'cwd']);
      expect(prompt).toContain('<tools>\n(none)\n</tools>');
    });
  });

  describe('Unattended Mode vs Normal Mode Permutations', () => {
    test('Unattended = false: does NOT include unattended policy', async () => {
      const loader = createPromptTestLoader(dirs.cwd, dirs.agentDir, {
        chatMode: false,
        systemPrompt: '',
        unattended: false,
      });
      await loader.reload();
      const prompt = renderPromptWithOptions(dirs.cwd, loader);

      assertTopLevelPreamble(prompt);
      assertNoLeakage(prompt, 'Normal mode unattended=false');
      assertWellFormedXmlTags(prompt, ['tools', 'rules', 'cwd', 'addendum']);
      expect(prompt).not.toContain(PiUnattendedSystemPrompt);
    });

    test('Unattended = true: includes unattended policy cleanly inside <addendum>', async () => {
      const loader = createPromptTestLoader(dirs.cwd, dirs.agentDir, {
        chatMode: false,
        systemPrompt: '',
        unattended: true,
      });
      await loader.reload();
      const prompt = renderPromptWithOptions(dirs.cwd, loader);

      assertTopLevelPreamble(prompt);
      assertNoLeakage(prompt, 'Unattended mode unattended=true');
      assertWellFormedXmlTags(prompt, ['tools', 'rules', 'cwd', 'addendum']);
      expect(prompt).toContain(PiUnattendedSystemPrompt);
    });
  });
});
