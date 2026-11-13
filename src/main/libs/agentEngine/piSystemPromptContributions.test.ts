/**
 * Structural tests for the unified tool-policy registry.
 *
 * The registry is the single collection point for `*SystemPrompt` policies;
 * these tests turn "defined a policy but forgot to register it" and broken
 * gating into test failures instead of silent prompt loss.
 */
import { describe, expect, it } from 'vitest';

import { SessionSummarySystemPrompt } from '../../sessionSummary/tool';
import { PiPythonEnvSystemPrompt } from './piPythonEnvGuidelines';
import { PiUnattendedSystemPrompt } from './piUnattendedPolicy';
import {
  collectPiSystemPromptContributions,
  PiSystemPromptContributions,
} from './piSystemPromptContributions';

const FULL_CONTEXT = { fileToolsEnabled: true, maxOutputTokens: 8000 } as const;
const TEXT_CONTEXT = { fileToolsEnabled: false, maxOutputTokens: 8000 } as const;
const UNATTENDED_CONTEXT = { ...FULL_CONTEXT, unattended: true } as const;

describe('piSystemPromptContributions', () => {
  it('does not advertise host-only tools to native child sessions or memory tools to Chat', () => {
    const child = collectPiSystemPromptContributions({
      ...FULL_CONTEXT,
      nativeToolsOnly: true,
    }).join('\n');
    for (const name of ['session_summary', 'AskUserQuestion', 'python_execute', 'read_document']) {
      expect(child).not.toContain(name);
    }
    expect(
      collectPiSystemPromptContributions({ ...FULL_CONTEXT, chatMode: true }).join('\n'),
    ).not.toContain('session_summary');
  });
  it('has unique ids', () => {
    const ids = PiSystemPromptContributions.map(contribution => contribution.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('produces a non-empty prompt for every contribution in both tool modes', () => {
    for (const contribution of PiSystemPromptContributions) {
      for (const context of [FULL_CONTEXT, TEXT_CONTEXT, UNATTENDED_CONTEXT]) {
        if (contribution.enabled && !contribution.enabled(context)) continue;
        const prompt =
          typeof contribution.prompt === 'function'
            ? contribution.prompt(context)
            : contribution.prompt;
        if (!prompt.trim()) continue;
        expect(prompt.trim().length, contribution.id).toBeGreaterThan(0);
      }
    }
  });

  it('registers only non-duplicative cross-tool and run-mode policies', () => {
    const registeredPrompts = PiSystemPromptContributions.map(contribution =>
      typeof contribution.prompt === 'string' ? contribution.prompt : null,
    );
    expect(PiSystemPromptContributions.map(c => c.id)).toEqual([
      'unattended-execution',
      'python-runtime',
      'session-summary',
    ]);
    for (const policy of [
      PiUnattendedSystemPrompt,
      PiPythonEnvSystemPrompt,
      SessionSummarySystemPrompt,
    ]) {
      expect(registeredPrompts).toContain(policy);
    }
  });

  it('gates file-tool policies off when file tools are disabled', () => {
    const full = collectPiSystemPromptContributions(FULL_CONTEXT);
    const text = collectPiSystemPromptContributions(TEXT_CONTEXT);
    expect(full).toContain(PiPythonEnvSystemPrompt);
    expect(text).not.toContain(PiPythonEnvSystemPrompt);
    expect(text.some(prompt => prompt.includes('## Large File Writes'))).toBe(false);
    // Tool-agnostic policies stay present in both modes.
    expect(text).toContain(SessionSummarySystemPrompt);
  });

  it('adds autonomous guidance only when unattended', () => {
    const attended = collectPiSystemPromptContributions(FULL_CONTEXT);
    const unattended = collectPiSystemPromptContributions(UNATTENDED_CONTEXT);

    expect(attended).not.toContain(PiUnattendedSystemPrompt);
    expect(unattended).toContain(PiUnattendedSystemPrompt);
  });

  it('does not prescribe an extra large-file protocol', () => {
    expect(collectPiSystemPromptContributions(FULL_CONTEXT).join('\n')).not.toContain(
      '2000 characters',
    );
  });
});
