/**
 * Structural tests for the unified tool-policy registry.
 *
 * The registry is the single collection point for `*SystemPrompt` policies;
 * these tests turn "defined a policy but forgot to register it" and broken
 * gating into test failures instead of silent prompt loss.
 */
import { describe, expect, it } from 'vitest';

import { DeclareArtifactSystemPrompt } from '../../declareArtifact/tool';
import { PiAskUserQuestionSystemPrompt } from './piAskUserQuestion';
import { PiBuiltinFileToolSystemPrompt } from './piBuiltinToolGuidelines';
import { PiDocumentReaderSystemPrompt } from './piDocumentReaderTool';
import {
  collectPiSystemPromptContributions,
  PiSystemPromptContributions,
} from './piSystemPromptContributions';
import { calculatePiWriteChunkCharacterLimit } from './piWriteTokenLimit';

const FULL_CONTEXT = { fileToolsEnabled: true, maxOutputTokens: 8000 } as const;
const TEXT_CONTEXT = { fileToolsEnabled: false, maxOutputTokens: 8000 } as const;

describe('piSystemPromptContributions', () => {
  it('has unique ids', () => {
    const ids = PiSystemPromptContributions.map(contribution => contribution.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('produces a non-empty prompt for every contribution in both tool modes', () => {
    for (const contribution of PiSystemPromptContributions) {
      for (const context of [FULL_CONTEXT, TEXT_CONTEXT]) {
        const prompt =
          typeof contribution.prompt === 'function'
            ? contribution.prompt(context)
            : contribution.prompt;
        expect(prompt.trim().length, contribution.id).toBeGreaterThan(0);
      }
    }
  });

  it('registers every exported tool policy constant', () => {
    const registeredPrompts = PiSystemPromptContributions.map(contribution =>
      typeof contribution.prompt === 'string' ? contribution.prompt : null,
    );
    for (const policy of [
      PiAskUserQuestionSystemPrompt,
      PiDocumentReaderSystemPrompt,
      PiBuiltinFileToolSystemPrompt,
      DeclareArtifactSystemPrompt,
    ]) {
      expect(registeredPrompts).toContain(policy);
    }
  });

  it('gates file-tool policies off when file tools are disabled', () => {
    const full = collectPiSystemPromptContributions(FULL_CONTEXT);
    const text = collectPiSystemPromptContributions(TEXT_CONTEXT);
    expect(full).toContain(PiDocumentReaderSystemPrompt);
    expect(full).toContain(PiBuiltinFileToolSystemPrompt);
    expect(text).not.toContain(PiDocumentReaderSystemPrompt);
    expect(text).not.toContain(PiBuiltinFileToolSystemPrompt);
    expect(text.some(prompt => prompt.includes('## Large File Writes'))).toBe(false);
    // Tool-agnostic policies stay present in both modes.
    expect(text).toContain(PiAskUserQuestionSystemPrompt);
    expect(text).toContain(DeclareArtifactSystemPrompt);
  });

  it('renders the large-file-write policy from the session token budget', () => {
    const full = collectPiSystemPromptContributions({ ...FULL_CONTEXT, maxOutputTokens: 8000 });
    const expectedLimit = calculatePiWriteChunkCharacterLimit(8000);
    const policy = full.find(prompt => prompt.includes('## Large File Writes'));
    expect(policy).toBeDefined();
    expect(policy).toContain(`${expectedLimit} characters`);
  });
});
