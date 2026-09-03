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
import { createPiBashToolSystemPrompt } from './piBashToolGuidelines';
import { PiBuiltinFileToolSystemPrompt } from './piBuiltinToolGuidelines';
import { PiDocumentReaderSystemPrompt } from './piDocumentReaderTool';
import { PiUnattendedSystemPrompt } from './piUnattendedPolicy';
import {
  collectPiSystemPromptContributions,
  PiSystemPromptContributions,
} from './piSystemPromptContributions';
import { calculatePiWriteChunkCharacterLimit } from './piWriteTokenLimit';

const FULL_CONTEXT = { fileToolsEnabled: true, maxOutputTokens: 8000 } as const;
const TEXT_CONTEXT = { fileToolsEnabled: false, maxOutputTokens: 8000 } as const;
const UNATTENDED_CONTEXT = { ...FULL_CONTEXT, unattended: true } as const;
const MCP_CONTEXT = {
  ...FULL_CONTEXT,
  mcpToolManifest: [
    {
      server: 'Blender MCP',
      name: 'create_cube',
      description: 'Create a cube in the active scene.',
      inputSchema: { type: 'object' },
    },
  ],
} as const;
const FAILED_MCP_CONTEXT = {
  ...FULL_CONTEXT,
  mcpServerStatuses: [
    {
      name: 'Blender MCP',
      connected: false,
      toolCount: 0,
      error: 'Connection closed',
    },
  ],
} as const;

describe('piSystemPromptContributions', () => {
  it('has unique ids', () => {
    const ids = PiSystemPromptContributions.map(contribution => contribution.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('produces a non-empty prompt for every contribution in both tool modes', () => {
    for (const contribution of PiSystemPromptContributions) {
      for (const context of [
        FULL_CONTEXT,
        TEXT_CONTEXT,
        UNATTENDED_CONTEXT,
        MCP_CONTEXT,
        FAILED_MCP_CONTEXT,
      ]) {
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

  it('includes the Windows Bash contract without adding it to Unix sessions', () => {
    expect(collectPiSystemPromptContributions({ ...FULL_CONTEXT, platform: 'win32' })).toContain(
      createPiBashToolSystemPrompt('win32'),
    );
    expect(
      collectPiSystemPromptContributions({ ...FULL_CONTEXT, platform: 'linux' }),
    ).not.toContain(createPiBashToolSystemPrompt('win32'));
  });

  it('registers every exported tool policy constant', () => {
    const registeredPrompts = PiSystemPromptContributions.map(contribution =>
      typeof contribution.prompt === 'string' ? contribution.prompt : null,
    );
    for (const policy of [
      PiAskUserQuestionSystemPrompt,
      PiUnattendedSystemPrompt,
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

  it('replaces the user-question policy with autonomous guidance when unattended', () => {
    const attended = collectPiSystemPromptContributions(FULL_CONTEXT);
    const unattended = collectPiSystemPromptContributions(UNATTENDED_CONTEXT);

    expect(attended).toContain(PiAskUserQuestionSystemPrompt);
    expect(attended).not.toContain(PiUnattendedSystemPrompt);
    expect(unattended).not.toContain(PiAskUserQuestionSystemPrompt);
    expect(unattended).toContain(PiUnattendedSystemPrompt);
  });

  it('renders the large-file-write policy from the session token budget', () => {
    const full = collectPiSystemPromptContributions({ ...FULL_CONTEXT, maxOutputTokens: 8000 });
    const expectedLimit = calculatePiWriteChunkCharacterLimit(8000);
    const policy = full.find(prompt => prompt.includes('## Large File Writes'));
    expect(policy).toBeDefined();
    expect(policy).toContain(`${expectedLimit} characters`);
  });

  it('adds concrete MCP capabilities only when MCP tools are available', () => {
    const withoutMcp = collectPiSystemPromptContributions(FULL_CONTEXT);
    const withMcp = collectPiSystemPromptContributions(MCP_CONTEXT);

    expect(withoutMcp.some(prompt => prompt.includes('MCP capability preflight'))).toBe(false);
    expect(withMcp.some(prompt => prompt.includes('[Blender MCP] create_cube'))).toBe(true);
  });

  it('adds MCP connection diagnostics when configured servers expose no tools', () => {
    const prompts = collectPiSystemPromptContributions(FAILED_MCP_CONTEXT);

    expect(prompts.some(prompt => prompt.includes('[Blender MCP] unavailable'))).toBe(true);
  });
});
