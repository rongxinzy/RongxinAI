import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../../../../node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js';
import { getZhiyuanProductPreamble } from './piPromptOverrides';
import { ensureNativeSystemPromptSections } from './piRuntimeResourceLoader';
import type { PiBeforeAgentStartSystemPromptOptions } from './piExtensionTypes';

describe('ensureNativeSystemPromptSections - Empirical Adversarial Stress Testing', () => {
  const preamble = getZhiyuanProductPreamble();
  const testCwd = '/Users/krli/workspace/RongxinAI';

  it('handles empty selectedTools: []', () => {
    const options: PiBeforeAgentStartSystemPromptOptions = {
      cwd: testCwd,
      customPrompt: preamble,
      selectedTools: [],
      hiddenTools: [],
      toolSnippets: {},
      toolGuidelines: {},
      promptGuidelines: [],
      sections: {},
    };

    expect(() => ensureNativeSystemPromptSections(options)).not.toThrow();
    expect(options.sections.tools).toBe('(none)');
    expect(options.sections.rules).toContain('- Be concise in your responses');
    expect(options.sections.rules).toContain('- Show file paths clearly when working with files');
    expect(options.sections.rules).not.toContain('Use bash');

    // Verify buildSystemPrompt works with these options
    const rendered = buildSystemPrompt(
      options as unknown as Parameters<typeof buildSystemPrompt>[0],
    );
    expect(rendered).toContain(preamble);
    expect(rendered).toContain('<tools>\n(none)\n</tools>');
    expect(rendered).toContain('<rules>');
    expect(rendered).not.toContain('<docs>');
  });

  it('handles all tools hidden in hiddenTools', () => {
    const options: PiBeforeAgentStartSystemPromptOptions = {
      cwd: testCwd,
      customPrompt: preamble,
      selectedTools: ['bash', 'read', 'write', 'custom_tool'],
      hiddenTools: ['bash', 'read', 'write', 'custom_tool'],
      toolSnippets: {
        bash: 'Execute shell commands.',
        read: 'Read files.',
        write: 'Write files.',
        custom_tool: 'Do custom things.',
      },
      toolGuidelines: {
        bash: ['Be careful with rm -rf'],
        custom_tool: ['Custom guideline'],
      },
      promptGuidelines: ['Global rule A'],
      sections: {},
    };

    expect(() => ensureNativeSystemPromptSections(options)).not.toThrow();
    expect(options.sections.tools).toBe('(none)');
    expect(options.sections.rules).not.toContain('Execute shell commands');
    expect(options.sections.rules).not.toContain('Use bash');
    expect(options.sections.rules).not.toContain('Be careful with rm -rf');
    expect(options.sections.rules).not.toContain('Custom guideline');
    expect(options.sections.rules).toContain('- Global rule A');
    expect(options.sections.rules).toContain('- Be concise in your responses');

    const rendered = buildSystemPrompt(
      options as unknown as Parameters<typeof buildSystemPrompt>[0],
    );
    expect(rendered).toContain(preamble);
    expect(rendered).toContain('<tools>\n(none)\n</tools>');
    expect(rendered).toContain('- Global rule A');
  });

  it('handles tools with empty snippets or empty/undefined guidelines', () => {
    const options: PiBeforeAgentStartSystemPromptOptions = {
      cwd: testCwd,
      customPrompt: preamble,
      selectedTools: ['tool_empty_snippet', 'tool_no_snippet', 'tool_empty_guidelines'],
      hiddenTools: [],
      toolSnippets: {
        tool_empty_snippet: '',
        // tool_no_snippet is undefined
        tool_empty_guidelines: 'Valid snippet for guidelines tool',
      },
      toolGuidelines: {
        tool_empty_snippet: [],
        // tool_no_snippet is undefined
        tool_empty_guidelines: ['', '   ', 'Valid guideline'],
      },
      promptGuidelines: ['', '  ', 'Valid prompt rule'],
      sections: {},
    };

    expect(() => ensureNativeSystemPromptSections(options)).not.toThrow();
    // Only tool_empty_guidelines has non-empty snippet, so tools should only list it
    expect(options.sections.tools).toContain(
      '- tool_empty_guidelines: Valid snippet for guidelines tool',
    );
    expect(options.sections.tools).not.toContain('tool_empty_snippet');
    expect(options.sections.tools).not.toContain('tool_no_snippet');

    // Rules should ignore empty strings and whitespace
    expect(options.sections.rules).toContain('- Valid guideline');
    expect(options.sections.rules).toContain('- Valid prompt rule');
    expect(options.sections.rules).not.toMatch(/- \s*$/m);

    const rendered = buildSystemPrompt(
      options as unknown as Parameters<typeof buildSystemPrompt>[0],
    );
    expect(rendered).toContain(preamble);
    expect(rendered).toContain('- tool_empty_guidelines');
  });

  it('handles undefined / missing optional collections gracefully', () => {
    const options: PiBeforeAgentStartSystemPromptOptions = {
      cwd: testCwd,
      customPrompt: preamble,
      selectedTools: undefined,
      hiddenTools: undefined,
      toolSnippets: undefined,
      toolGuidelines: undefined,
      promptGuidelines: undefined,
      sections: {},
    };

    expect(() => ensureNativeSystemPromptSections(options)).not.toThrow();
    expect(options.sections.tools).toBe('(none)');
    expect(options.sections.rules).toContain('- Be concise in your responses');
    expect(options.sections.rules).toContain('- Show file paths clearly when working with files');

    const rendered = buildSystemPrompt(
      options as unknown as Parameters<typeof buildSystemPrompt>[0],
    );
    expect(rendered).toContain(preamble);
    expect(rendered).toContain('<tools>\n(none)\n</tools>');
  });

  it('does nothing when customPrompt is absent (undefined or empty)', () => {
    const optionsUndefined: PiBeforeAgentStartSystemPromptOptions = {
      cwd: testCwd,
      customPrompt: undefined,
      sections: {},
    };
    ensureNativeSystemPromptSections(optionsUndefined);
    expect(optionsUndefined.sections.tools).toBeUndefined();
    expect(optionsUndefined.sections.rules).toBeUndefined();

    const optionsEmpty: PiBeforeAgentStartSystemPromptOptions = {
      cwd: testCwd,
      customPrompt: '',
      sections: {},
    };
    ensureNativeSystemPromptSections(optionsEmpty);
    expect(optionsEmpty.sections.tools).toBeUndefined();
    expect(optionsEmpty.sections.rules).toBeUndefined();
  });

  it('does not overwrite pre-existing tools or rules sections', () => {
    const options: PiBeforeAgentStartSystemPromptOptions = {
      cwd: testCwd,
      customPrompt: preamble,
      selectedTools: ['bash'],
      toolSnippets: { bash: 'Execute bash commands' },
      sections: {
        tools: 'Pre-existing custom tools section',
        rules: 'Pre-existing custom rules section',
      },
    };

    ensureNativeSystemPromptSections(options);
    expect(options.sections.tools).toBe('Pre-existing custom tools section');
    expect(options.sections.rules).toBe('Pre-existing custom rules section');
  });

  it('handles shell tools logic (bash vs powershell vs grep/find/ls combinations)', () => {
    // 1. Bash only without grep/find/ls -> bash rule
    const optBashOnly: PiBeforeAgentStartSystemPromptOptions = {
      cwd: testCwd,
      customPrompt: preamble,
      selectedTools: ['bash'],
      sections: {},
    };
    ensureNativeSystemPromptSections(optBashOnly);
    expect(optBashOnly.sections.rules).toContain('Use bash for file operations like ls, rg, find');

    // 2. PowerShell only without grep/find/ls -> powershell rule
    const optPsOnly: PiBeforeAgentStartSystemPromptOptions = {
      cwd: testCwd,
      customPrompt: preamble,
      selectedTools: ['powershell'],
      sections: {},
    };
    ensureNativeSystemPromptSections(optPsOnly);
    expect(optPsOnly.sections.rules).toContain(
      'Use PowerShell for file operations like listing, searching, and finding files',
    );

    // 3. Both bash and powershell without grep/find/ls -> both rule
    const optBoth: PiBeforeAgentStartSystemPromptOptions = {
      cwd: testCwd,
      customPrompt: preamble,
      selectedTools: ['bash', 'powershell'],
      sections: {},
    };
    ensureNativeSystemPromptSections(optBoth);
    expect(optBoth.sections.rules).toContain(
      'Use bash or PowerShell for file operations like listing, searching, and finding files',
    );

    // 4. Bash with grep -> no file operations rule
    const optBashGrep: PiBeforeAgentStartSystemPromptOptions = {
      cwd: testCwd,
      customPrompt: preamble,
      selectedTools: ['bash', 'grep'],
      sections: {},
    };
    ensureNativeSystemPromptSections(optBashGrep);
    expect(optBashGrep.sections.rules).not.toContain('Use bash for file operations');

    // 5. Bash with find -> no file operations rule
    const optBashFind: PiBeforeAgentStartSystemPromptOptions = {
      cwd: testCwd,
      customPrompt: preamble,
      selectedTools: ['bash', 'find'],
      sections: {},
    };
    ensureNativeSystemPromptSections(optBashFind);
    expect(optBashFind.sections.rules).not.toContain('Use bash for file operations');

    // 6. Bash with ls -> no file operations rule
    const optBashLs: PiBeforeAgentStartSystemPromptOptions = {
      cwd: testCwd,
      customPrompt: preamble,
      selectedTools: ['bash', 'ls'],
      sections: {},
    };
    ensureNativeSystemPromptSections(optBashLs);
    expect(optBashLs.sections.rules).not.toContain('Use bash for file operations');
  });

  it('deduplicates identical rules across toolGuidelines and promptGuidelines', () => {
    const options: PiBeforeAgentStartSystemPromptOptions = {
      cwd: testCwd,
      customPrompt: preamble,
      selectedTools: ['toolA', 'toolB'],
      toolSnippets: { toolA: 'Snippet A', toolB: 'Snippet B' },
      toolGuidelines: {
        toolA: ['Rule 1', 'Rule 2'],
        toolB: ['Rule 2', 'Rule 3'],
      },
      promptGuidelines: ['Rule 1', 'Rule 3', 'Rule 4'],
      sections: {},
    };

    ensureNativeSystemPromptSections(options);
    const rules = options.sections.rules.split('\n');
    const rule1Count = rules.filter(r => r === '- Rule 1').length;
    const rule2Count = rules.filter(r => r === '- Rule 2').length;
    const rule3Count = rules.filter(r => r === '- Rule 3').length;
    const rule4Count = rules.filter(r => r === '- Rule 4').length;

    expect(rule1Count).toBe(1);
    expect(rule2Count).toBe(1);
    expect(rule3Count).toBe(1);
    expect(rule4Count).toBe(1);
  });

  it('handles duplicate tool names in selectedTools gracefully', () => {
    const options: PiBeforeAgentStartSystemPromptOptions = {
      cwd: testCwd,
      customPrompt: preamble,
      selectedTools: ['bash', 'bash', 'read', 'read'],
      hiddenTools: [],
      toolSnippets: { bash: 'Execute bash commands', read: 'Read files' },
      toolGuidelines: { bash: ['Rule bash'], read: ['Rule read'] },
      promptGuidelines: [],
      sections: {},
    };

    expect(() => ensureNativeSystemPromptSections(options)).not.toThrow();
    // Rules must still deduplicate cleanly
    const rules = options.sections.rules.split('\n');
    expect(rules.filter(r => r === '- Rule bash')).toHaveLength(1);
    expect(rules.filter(r => r === '- Rule read')).toHaveLength(1);
  });

  it('handles hiddenTools containing nonexistent tools without error', () => {
    const options: PiBeforeAgentStartSystemPromptOptions = {
      cwd: testCwd,
      customPrompt: preamble,
      selectedTools: ['bash'],
      hiddenTools: ['ghost_tool_1', 'ghost_tool_2'],
      toolSnippets: { bash: 'Execute bash' },
      toolGuidelines: {},
      promptGuidelines: [],
      sections: {},
    };

    expect(() => ensureNativeSystemPromptSections(options)).not.toThrow();
    expect(options.sections.tools).toContain('- bash: Execute bash');
  });

  it('handles partially pre-existing sections (only tools set, rules missing)', () => {
    const options: PiBeforeAgentStartSystemPromptOptions = {
      cwd: testCwd,
      customPrompt: preamble,
      selectedTools: ['bash'],
      toolSnippets: { bash: 'Execute bash' },
      sections: {
        tools: 'Custom tools only',
      },
    };

    ensureNativeSystemPromptSections(options);
    expect(options.sections.tools).toBe('Custom tools only');
    expect(options.sections.rules).toBeDefined();
    expect(options.sections.rules).toContain('Use bash for file operations');
  });

  it('handles partially pre-existing sections (only rules set, tools missing)', () => {
    const options: PiBeforeAgentStartSystemPromptOptions = {
      cwd: testCwd,
      customPrompt: preamble,
      selectedTools: ['read'],
      toolSnippets: { read: 'Read file contents' },
      sections: {
        rules: 'Custom rules only',
      },
    };

    ensureNativeSystemPromptSections(options);
    expect(options.sections.rules).toBe('Custom rules only');
    expect(options.sections.tools).toBeDefined();
    expect(options.sections.tools).toContain('- read: Read file contents');
  });

  it('handles unicode, CJK, and emoji in toolSnippets and toolGuidelines without crashing', () => {
    const options: PiBeforeAgentStartSystemPromptOptions = {
      cwd: testCwd,
      customPrompt: preamble,
      selectedTools: ['cjk_tool'],
      toolSnippets: { cjk_tool: '工具描述：执行特定功能 🚀 🔥 ✨' },
      toolGuidelines: {
        cjk_tool: ['操作规则：必须先确认参数 🎯', 'Unicode test: 日本語 / 한국어 / العربية'],
      },
      promptGuidelines: ['全局规则：保持专业 & 准确'],
      sections: {},
    };

    expect(() => ensureNativeSystemPromptSections(options)).not.toThrow();
    expect(options.sections.tools).toContain('- cjk_tool: 工具描述：执行特定功能 🚀 🔥 ✨');
    expect(options.sections.rules).toContain('- 操作规则：必须先确认参数 🎯');
    expect(options.sections.rules).toContain('- Unicode test: 日本語 / 한국어 / العربية');
    expect(options.sections.rules).toContain('- 全局规则：保持专业 & 准确');

    const rendered = buildSystemPrompt(
      options as unknown as Parameters<typeof buildSystemPrompt>[0],
    );
    expect(rendered).toContain('工具描述：执行特定功能 🚀 🔥 ✨');
    expect(rendered).toContain('操作规则：必须先确认参数 🎯');
  });
});
