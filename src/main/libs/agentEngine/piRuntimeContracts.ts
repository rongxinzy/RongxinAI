/** Product-facing contract over the native Durable host. */
import type { Extension } from '@earendil-works/pi-durable';
import type { Models } from '@earendil-works/pi-ai';
import type { ModelCapabilities } from '../../../shared/providers';
import {
  buildPiBackgroundCompletionContext,
  type PiBackgroundCompletionResult,
} from './piBackgroundCompletion';
/** Minimal type for the Pi AgentSession — only the methods used by this adapter. */
export interface PiSession {
  readonly messages?: readonly unknown[];
  prompt(text: string, options?: { streamingBehavior?: 'steer' | 'followUp' }): Promise<void>;
  sendUserMessage?(
    content:
      | string
      | Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>,
    options?: { deliverAs?: 'steer' | 'followUp' },
  ): Promise<void>;
  steer(text: string): Promise<unknown>;
  followUp?(text: string): Promise<unknown>;
  clearQueue?():
    | { steering: string[]; followUp: string[] }
    | Promise<{ steering: string[]; followUp: string[] }>;
  resume?(): Promise<void>;
  close?(): Promise<void>;
  updateRuntimeOptions?(change: Record<string, unknown>): Promise<void>;
  getToolDefinition?(name: string): unknown;
  abort(): Promise<void>;
  abortBash(): void;
  dispose?(): void;
  reload(): Promise<void>;
  setModel(model: unknown): Promise<void>;
  setThinkingLevel?(level: string): unknown;
  bindExtensions?(bindings: Record<string, unknown>): Promise<void>;
  compact?(customInstructions?: string): Promise<{ cancelled?: boolean }>;
  getContextUsage?():
    | {
        tokens: number | null;
        contextWindow: number;
        percent: number | null;
      }
    | undefined;
  getSessionStats?(): unknown;
  navigateTree?(
    targetId: string,
    options?: {
      summarize?: boolean;
      customInstructions?: string;
      replaceInstructions?: boolean;
      label?: string;
    },
  ): Promise<{ editorText?: string; cancelled?: boolean; aborted?: boolean }>;
  appendContextEdit?(targetId: string, replacement: { content: unknown } | null): Promise<string>;
  subscribe(listener: (event: PiEvent) => void): () => void;
}

interface PiContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

export interface PiUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning?: number;
  totalTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

export interface PiEvent {
  displayResultText?: string;
  type: string;
  success?: boolean;
  attempt?: number;
  finalError?: string;
  reason?: string;
  aborted?: boolean;
  errorMessage?: string;
  message?: {
    id?: string;
    role: string;
    // For message_update / message_end this is the FULL accumulating snapshot
    // (blocks: {type:'text',text} / {type:'thinking',thinking}), NOT a delta.
    content: string | PiContentBlock[];
    model?: string;
    usage?: PiUsage;
    stopReason?: string;
    errorMessage?: string;
  };
  // message_update carries the fine-grained streaming delta here.
  assistantMessageEvent?: {
    type: string; // text_delta | thinking_delta | text_end | thinking_end | ...
    delta?: string;
    content?: string;
    contentIndex?: number;
    partial?: unknown;
    toolCall?: unknown;
  };
  // tool_execution_start / _update / _end fields
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  partialResult?: unknown;
  isError?: boolean;
}

// ── Dynamic imports ──

export interface PiModules {
  createAgentSession: (options?: Record<string, unknown>) => Promise<{ session: PiSession }>;
  getAgentDir: () => string;
  getModel: (provider: string, modelId: string) => unknown;
  ModelRuntime: {
    create(options?: PiModelRuntimeCreateOptions): Promise<PiModelRuntime>;
  };
  completeSimple: (
    model: unknown,
    context: ReturnType<typeof buildPiBackgroundCompletionContext>,
    options?: { apiKey?: string },
  ) => Promise<PiBackgroundCompletionResult>;
}

export interface PiResourceLoader {
  readonly extensions: readonly Extension[];
  getSystemPrompt(): string;
  getSkills(): {
    skills: Array<{ name: string; description: string; filePath: string; baseDir: string }>;
    diagnostics: unknown[];
  };
  close?(): Promise<void>;
  reload(): Promise<void>;
}

export interface PiResourceState {
  systemPrompt: string;
  skillIds: string[] | undefined;
  maxOutputTokens: number;
  fileToolsEnabled: boolean;
  unattended: boolean;
  /** Chat keeps the Pi kernel but opts out of Work resource discovery. */
  chatMode: boolean;
  /** Child sessions expose native tools, without the host's custom tools. */
  nativeToolsOnly?: boolean;
  /** Bundled preset skill dirs for the session's experts (file-sourced, live). */
  expertSkillDirs: string[];
  skillRoots: Record<string, string>;
}

export interface PiStartupLatency {
  sessionCreatedAt: number;
  agentStartedAt: number;
  firstTokenAt: number;
  sessionCreateToAgentStartMs: number;
  agentStartToFirstTokenMs: number;
  sessionCreateToFirstTokenMs: number;
}

export interface InitializingPiSession {
  abortController: AbortController;
  generation: symbol;
}

export interface PiModelRuntime {
  readonly models: Models;
  registerProvider(provider: string, config: Record<string, unknown>): void;
  setRuntimeApiKey(provider: string, apiKey: string): Promise<void>;
  getModel(provider: string, modelId: string): unknown;
  completeSimple?(
    model: unknown,
    context: ReturnType<typeof buildPiBackgroundCompletionContext>,
  ): Promise<PiBackgroundCompletionResult>;
}

interface PiModelRuntimeCreateOptions {
  allowModelNetwork?: boolean;
}

export type PiResolvedModel = {
  /** Base URL identity of the endpoint the model was resolved against. */
  endpointKey: string;
  model: Record<string, unknown>;
  modelRuntime: PiModelRuntime | null;
  maxOutputTokens: number;
  providerName: string;
  capabilities?: Partial<ModelCapabilities>;
  requestOptions?: {
    apiKey?: string;
  };
};
