/**
 * Unified registry for tool-usage system-prompt contributions.
 *
 * Both Work and Chat preserve Pi's native prompt. Host-only tools append their
 * application-specific guidance without copying native tool policies.
 * Each host tool module exports its own
 * `*SystemPrompt` policy; this registry is the single place that collects them
 * into the session's appendSystemPromptOverride. Adding a tool policy without
 * registering it here means the model never sees it — piRuntimeAdapter and its
 * tests read exclusively from this registry.
 */
import { DeclareArtifactSystemPrompt } from '../../declareArtifact/tool';
import { SessionSummarySystemPrompt } from '../../sessionSummary/tool';
import type { McpServerRuntimeStatus, McpToolManifestEntry } from '../mcpServerManager';
import { PiAskUserQuestionSystemPrompt } from './piAskUserQuestion';
import { createPiBashToolSystemPrompt } from './piBashToolGuidelines';
import { PiDocumentReaderSystemPrompt } from './piDocumentReaderTool';
import { PiOcrSystemPrompt } from './piOcrTool';
import { buildPiMcpCapabilityPrompt } from './piMcpCapabilityPrompt';
import { PiUnattendedSystemPrompt } from './piUnattendedPolicy';
import { PiPythonEnvSystemPrompt } from './piPythonEnvGuidelines';
import { PiWebSearchSystemPrompt } from './piWebSearchTool';

export interface PiSystemPromptContext {
  /** Whether the session is a direct Chat lane without Work orchestration. */
  chatMode?: boolean;
  nativeToolsOnly?: boolean;
  /** Whether file tools (read/write/edit/read_document) are active. */
  fileToolsEnabled: boolean;
  /** Resolved session output budget. */
  maxOutputTokens: number;
  /** Runtime platform, used for platform-specific tool contracts. */
  platform?: NodeJS.Platform;
  /** Whether the current run has no foreground user interaction. */
  unattended?: boolean;
  /** Concrete MCP capabilities discovered before this session was created. */
  mcpToolManifest?: McpToolManifestEntry[];
  /** Configured MCP servers, including connection and discovery failures. */
  mcpServerStatuses?: McpServerRuntimeStatus[];
  /** The pi 1.0 codemode sandbox tool is active for this work session. */
  codemodeEnabled?: boolean;
  /** pi's builtin MCP extension renders its own servers section this session. */
  mcpNativeBridge?: boolean;
}

export interface PiSystemPromptContribution {
  /** Stable identifier, used by tests to reference a specific contribution. */
  id: string;
  /** Only included when the session has file tools enabled. */
  requiresFileTools?: boolean;
  requiresHostTools?: boolean;
  /** Static text or a factory for context-dependent policies. */
  prompt: string | ((context: PiSystemPromptContext) => string);
  /** Optional runtime predicate for capabilities that are not always present. */
  enabled?: (context: PiSystemPromptContext) => boolean;
}

// Order matters: entries are appended to the system prompt in this sequence.
export const PiSystemPromptContributions: ReadonlyArray<PiSystemPromptContribution> = [
  {
    id: 'web-search',
    enabled: context => context.chatMode === true,
    prompt: PiWebSearchSystemPrompt,
  },
  {
    id: 'ask-user-question',
    requiresHostTools: true,
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
    id: 'python-runtime',
    requiresHostTools: true,
    requiresFileTools: true,
    prompt: PiPythonEnvSystemPrompt,
  },
  {
    id: 'document-reader',
    requiresHostTools: true,
    requiresFileTools: true,
    enabled: context => context.chatMode !== true,
    prompt: PiDocumentReaderSystemPrompt,
  },
  {
    id: 'ocr',
    requiresHostTools: true,
    requiresFileTools: true,
    enabled: context =>
      context.chatMode !== true && (context.platform ?? process.platform) === 'win32',
    prompt: PiOcrSystemPrompt,
  },
  {
    id: 'codemode',
    enabled: context => context.codemodeEnabled === true && context.chatMode !== true,
    prompt: [
      '## Parallel tool orchestration (codemode)',
      '',
      "- The `codemode` tool runs a JavaScript sandbox that can call this session's tools (`tools.read`, `tools.bash`, `tools.edit`, `tools.write`, plus registered workspace tools and the MCP gateway).",
      '- Prefer `codemode` when one step needs many independent tool calls: batch them inside the script with `await Promise.all(...)` instead of spending one reply per call.',
      '- Filter and reduce large outputs inside the script; return only the distilled result so the conversation stays small.',
      '- Every nested call still passes the session approval gate; a blocked call returns an error result inside the sandbox.',
      '- Keep single tool calls, user interaction, and isolated multi-turn delegation on the normal tools (`subagent` for multi-turn work).',
    ].join('\n'),
  },
  {
    id: 'mcp-capability-preflight',
    requiresHostTools: true,
    requiresFileTools: true,
    enabled: context =>
      context.mcpNativeBridge !== true &&
      Boolean(context.mcpToolManifest?.length || context.mcpServerStatuses?.length),
    prompt: context =>
      buildPiMcpCapabilityPrompt(
        context.mcpToolManifest ?? [],
        context.mcpServerStatuses ?? [],
      )[0] ?? '',
  },
  {
    id: 'declare-artifact',
    requiresHostTools: true,
    enabled: context => context.chatMode !== true,
    prompt: DeclareArtifactSystemPrompt,
  },
  {
    id: 'session-summary',
    requiresHostTools: true,
    enabled: context => context.chatMode !== true,
    prompt: SessionSummarySystemPrompt,
  },
];

export function collectPiSystemPromptContributions(context: PiSystemPromptContext): string[] {
  return PiSystemPromptContributions.filter(
    contribution =>
      (!contribution.requiresFileTools || context.fileToolsEnabled) &&
      (!contribution.requiresHostTools || context.nativeToolsOnly !== true) &&
      (!contribution.enabled || contribution.enabled(context)),
  )
    .map(contribution =>
      typeof contribution.prompt === 'function'
        ? contribution.prompt(context)
        : contribution.prompt,
    )
    .filter(prompt => prompt.trim().length > 0);
}
