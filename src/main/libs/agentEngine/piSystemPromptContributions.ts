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
import { SessionSummarySystemPrompt } from '../../sessionSummary/tool';
import { PiUnattendedSystemPrompt } from './piUnattendedPolicy';
import { PiPythonEnvSystemPrompt } from './piPythonEnvGuidelines';

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
    id: 'unattended-execution',
    enabled: context => context.unattended === true,
    prompt: PiUnattendedSystemPrompt,
  },
  {
    id: 'python-runtime',
    requiresHostTools: true,
    requiresFileTools: true,
    prompt: PiPythonEnvSystemPrompt,
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
