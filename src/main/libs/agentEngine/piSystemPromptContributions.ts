/**
 * Unified registry for tool-usage system-prompt contributions.
 *
 * Pi drops every tool's `promptGuidelines` whenever a custom system prompt is
 * supplied, and ZhiYuan always supplies one. Each tool module exports its own
 * `*SystemPrompt` policy; this registry is the single place that collects them
 * into the session's appendSystemPromptOverride. Adding a tool policy without
 * registering it here means the model never sees it — piRuntimeAdapter and its
 * tests read exclusively from this registry.
 */
import { DeclareArtifactSystemPrompt } from '../../declareArtifact/tool';
import type { McpServerRuntimeStatus, McpToolManifestEntry } from '../mcpServerManager';
import { PiAskUserQuestionSystemPrompt } from './piAskUserQuestion';
import { createPiBashToolSystemPrompt } from './piBashToolGuidelines';
import { PiBuiltinFileToolSystemPrompt } from './piBuiltinToolGuidelines';
import { PiDocumentReaderSystemPrompt } from './piDocumentReaderTool';
import { buildPiMcpCapabilityPrompt } from './piMcpCapabilityPrompt';
import { PiUnattendedSystemPrompt } from './piUnattendedPolicy';
import { createPiLargeFileWriteSystemPrompt } from './piWriteTokenLimit';

export interface PiSystemPromptContext {
  /** Whether file tools (read/write/edit/read_document) are active. */
  fileToolsEnabled: boolean;
  /** Current per-session output token budget, used by the large-write policy. */
  maxOutputTokens: number;
  /** Runtime platform, used for platform-specific tool contracts. */
  platform?: NodeJS.Platform;
  /** Whether the current run has no foreground user interaction. */
  unattended?: boolean;
  /** Concrete MCP capabilities discovered before this session was created. */
  mcpToolManifest?: McpToolManifestEntry[];
  /** Configured MCP servers, including connection and discovery failures. */
  mcpServerStatuses?: McpServerRuntimeStatus[];
}

export interface PiSystemPromptContribution {
  /** Stable identifier, used by tests to reference a specific contribution. */
  id: string;
  /** Only included when the session has file tools enabled. */
  requiresFileTools?: boolean;
  /** Static text or a factory for context-dependent policies. */
  prompt: string | ((context: PiSystemPromptContext) => string);
  /** Optional runtime predicate for capabilities that are not always present. */
  enabled?: (context: PiSystemPromptContext) => boolean;
}

// Order matters: entries are appended to the system prompt in this sequence.
export const PiSystemPromptContributions: ReadonlyArray<PiSystemPromptContribution> = [
  {
    id: 'ask-user-question',
    enabled: context => context.unattended !== true,
    prompt: PiAskUserQuestionSystemPrompt,
  },
  {
    id: 'unattended-execution',
    enabled: context => context.unattended === true,
    prompt: PiUnattendedSystemPrompt,
  },
  {
    id: 'bash-tool',
    requiresFileTools: true,
    prompt: context => createPiBashToolSystemPrompt(context.platform),
  },
  {
    id: 'document-reader',
    requiresFileTools: true,
    prompt: PiDocumentReaderSystemPrompt,
  },
  {
    id: 'builtin-file-tools',
    requiresFileTools: true,
    prompt: PiBuiltinFileToolSystemPrompt,
  },
  {
    id: 'mcp-capability-preflight',
    requiresFileTools: true,
    enabled: context =>
      Boolean(context.mcpToolManifest?.length || context.mcpServerStatuses?.length),
    prompt: context =>
      buildPiMcpCapabilityPrompt(
        context.mcpToolManifest ?? [],
        context.mcpServerStatuses ?? [],
      )[0] ?? '',
  },
  {
    id: 'large-file-write',
    requiresFileTools: true,
    prompt: context => createPiLargeFileWriteSystemPrompt(context.maxOutputTokens),
  },
  { id: 'declare-artifact', prompt: DeclareArtifactSystemPrompt },
];

export function collectPiSystemPromptContributions(context: PiSystemPromptContext): string[] {
  return PiSystemPromptContributions.filter(
    contribution =>
      (!contribution.requiresFileTools || context.fileToolsEnabled) &&
      (!contribution.enabled || contribution.enabled(context)),
  )
    .map(contribution =>
      typeof contribution.prompt === 'function'
        ? contribution.prompt(context)
        : contribution.prompt,
    )
    .filter(prompt => prompt.trim().length > 0);
}
