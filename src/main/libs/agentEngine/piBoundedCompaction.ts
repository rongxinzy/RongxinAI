/**
 * Bounded compaction, session-history normalization, and proportional budget
 * safeguards implemented inside RongxinAI on top of unpatched Pi 1.5.2.
 */

import {
  contentText,
  isContextOverflow,
  normalizeContext,
  retryAssistantCall,
  uuidv7,
  type AssistantMessage,
  type Model,
  type RetryPolicy,
  type TextContent,
  type TranscriptContext,
  type Usage,
} from '@earendil-works/pi-ai';
import type {
  CompactionSettings,
  SessionBeforeCompactEvent,
  SessionEntry,
  SessionProjection,
} from '@earendil-works/pi-coding-agent';
import { clampMagpieMaxTokensToContext } from './piMagpieApiGuard';

type CompactionPreparation = SessionBeforeCompactEvent['preparation'];

function calculateUsageTokens(usage: Usage): number {
  return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

const DEFAULT_RESERVE_TOKENS = 16_384;
const DEFAULT_KEEP_RECENT_TOKENS = 20_000;
const ESTIMATED_IMAGE_CHARS = 4800;

export const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`;

const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

const UPDATE_SUMMARIZATION_INSTRUCTIONS = `Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
- If something is no longer relevant, you may remove it

Use this EXACT format:

## Goal
[Preserve existing goals, add new ones if the task expanded]

## Constraints & Preferences
- [Preserve existing, add new ones discovered]

## Progress
### Done
- [x] [Include previously done items AND newly completed items]

### In Progress
- [ ] [Current work - update based on progress]

### Blocked
- [Current blockers - remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Next Steps
1. [Update based on current state]

## Critical Context
- [Preserve important context, add new if needed]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

const UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

${UPDATE_SUMMARIZATION_INSTRUCTIONS}`;

const TURN_PREFIX_SUMMARIZATION_PROMPT = `The messages above are earlier context from an ongoing conversation. Later messages are stored separately and do not need to be reconstructed.

Create a concise checkpoint of the user's request and the progress shown above. This checkpoint will be placed before the later messages so the conversation can continue with the necessary context.

## Original Request
[What did the user ask for?]

## Progress So Far
- [Key decisions and work completed in these messages]

## Context Needed to Continue
- [Information from these messages needed to understand the later work]

Only summarize information explicitly present above. Do not infer or recreate later messages.`;

type SessionManagerLike = {
  fileEntries?: Array<SessionEntry | { type: string }>;
  byId?: Map<string, SessionEntry>;
  getBranch?: () => SessionEntry[];
  buildSessionProjection?: () => SessionProjection;
  appendMessage?: (message: unknown) => string;
};

type SettingsManagerLike = {
  settings?: {
    compaction?: {
      reserveTokens?: number;
      keepRecentTokens?: number;
      modelOverrides?: Record<string, { reserveTokens?: number; keepRecentTokens?: number }>;
    };
  };
  getCompactionSettings?: (model?: {
    provider?: string;
    id?: string;
    contextWindow?: number;
  }) => CompactionSettings;
};

const guardedSessionManagers = new WeakSet<object>();
const guardedSettingsManagers = new WeakSet<object>();

function normalizeSessionMessageObject(message: Record<string, unknown>): boolean {
  const role = message.role;
  if (role === 'assistant' && !Array.isArray(message.content)) {
    message.content =
      typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : [];
    return true;
  }
  if ((role === 'user' || role === 'toolResult') && message.content == null) {
    message.content = [];
    return true;
  }
  if (role === 'system' && message.content == null) {
    message.content = '';
    return true;
  }
  return false;
}

/**
 * Installs three runtime safeguards on a Pi SessionManager instance without
 * modifying persisted JSONL bytes on disk:
 * 1. Normalizes legacy string/null assistant content in memory so JSONL resume
 *    never throws `msg.content.some is not a function`.
 * 2. Zeroes stale pre-compaction assistant usage in `buildSessionProjection()`
 *    so token clamping cannot reuse old usage after compaction or context edits.
 * 3. Ensures post-compaction assistant timestamps strictly exceed the latest
 *    compaction entry timestamp even within the same millisecond.
 */
export function installPiSessionManagerGuards(manager: unknown): void {
  if (!manager || typeof manager !== 'object' || guardedSessionManagers.has(manager)) {
    return;
  }
  const typed = manager as SessionManagerLike;
  if (
    typeof typed.buildSessionProjection !== 'function' &&
    typeof typed.appendMessage !== 'function' &&
    !Array.isArray(typed.fileEntries)
  ) {
    return;
  }
  guardedSessionManagers.add(manager);

  if (Array.isArray(typed.fileEntries)) {
    for (const entry of typed.fileEntries) {
      if (entry && entry.type === 'message' && 'message' in entry && entry.message) {
        normalizeSessionMessageObject(entry.message as unknown as Record<string, unknown>);
      }
    }
  }
  if (typed.byId instanceof Map) {
    for (const entry of typed.byId.values()) {
      if (entry && entry.type === 'message' && entry.message) {
        normalizeSessionMessageObject(entry.message as unknown as Record<string, unknown>);
      }
    }
  }

  if (typeof typed.buildSessionProjection === 'function') {
    const origBuildProjection = typed.buildSessionProjection;
    typed.buildSessionProjection = function guardedBuildSessionProjection(): SessionProjection {
      const projection = origBuildProjection.call(this);
      const path = typeof typed.getBranch === 'function' ? typed.getBranch.call(this) : [];
      const boundary = path.findLastIndex(
        (entry: SessionEntry) => entry.type === 'context_edit' || entry.type === 'compaction',
      );
      const freshSourceIds = new Set<string>(
        boundary >= 0 ? path.slice(boundary + 1).map((entry: SessionEntry) => entry.id) : [],
      );
      let modified = false;
      for (const projected of projection.entries) {
        const isStaleAssistant =
          boundary >= 0 &&
          !freshSourceIds.has(projected.sourceEntry.id) &&
          projected.sourceEntry.type === 'message' &&
          projected.sourceEntry.message.role === 'assistant';
        for (let i = 0; i < projected.messages.length; i++) {
          const message = projected.messages[i] as unknown as Record<string, unknown>;
          if (normalizeSessionMessageObject(message)) {
            modified = true;
          }
          if (isStaleAssistant && message.role === 'assistant' && message.usage) {
            const usage = message.usage as Record<string, unknown>;
            projected.messages[i] = {
              ...(message as Record<string, unknown>),
              usage: {
                ...usage,
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
              },
            } as unknown as (typeof projected.messages)[number];
            modified = true;
          }
        }
      }
      if (modified) {
        projection.messages = projection.entries.flatMap(
          (entry: SessionProjection['entries'][number]) => entry.messages,
        );
      }
      return projection;
    };
  }

  if (typeof typed.appendMessage === 'function') {
    const origAppendMessage = typed.appendMessage;
    typed.appendMessage = function guardedAppendMessage(message: unknown): string {
      if (message && typeof message === 'object') {
        const msg = message as Record<string, unknown>;
        normalizeSessionMessageObject(msg);
        if (
          msg.role === 'assistant' &&
          typeof msg.timestamp === 'number' &&
          typeof typed.getBranch === 'function'
        ) {
          const branch = typed.getBranch.call(this);
          for (let i = branch.length - 1; i >= 0; i--) {
            const entry = branch[i];
            if (entry.type === 'compaction') {
              const compactionMs = new Date(entry.timestamp).getTime();
              if (Number.isFinite(compactionMs) && msg.timestamp <= compactionMs) {
                msg.timestamp = compactionMs + 1;
              }
              break;
            }
          }
        }
      }
      return origAppendMessage.call(this, message);
    };
  }
}

export function computePiCompactionDefaults(contextWindow?: number): {
  reserveTokens: number;
  keepRecentTokens: number;
} {
  if (typeof contextWindow !== 'number' || contextWindow <= 0) {
    return {
      reserveTokens: DEFAULT_RESERVE_TOKENS,
      keepRecentTokens: DEFAULT_KEEP_RECENT_TOKENS,
    };
  }
  return {
    reserveTokens: Math.min(DEFAULT_RESERVE_TOKENS, Math.max(1, Math.floor(contextWindow * 0.25))),
    keepRecentTokens: Math.min(
      DEFAULT_KEEP_RECENT_TOKENS,
      Math.max(1, Math.floor(contextWindow * 0.5)),
    ),
  };
}

function estimateTextChars(text: string): { div4Chars: number; weightedTokens: number } {
  let nonAscii = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) nonAscii++;
  }
  const ascii = text.length - nonAscii;
  return {
    div4Chars: text.length,
    weightedTokens: Math.ceil(ascii / 4 + nonAscii * 1.25),
  };
}

function estimateMessageTokenMetrics(message: unknown): {
  div4Tokens: number;
  weightedTokens: number;
} {
  if (!message || typeof message !== 'object') return { div4Tokens: 0, weightedTokens: 0 };
  const msg = message as {
    role?: unknown;
    content?: unknown;
    details?: unknown;
    summary?: unknown;
    customType?: unknown;
  };
  let chars = 0;
  let weighted = 0;
  const addText = (text: string) => {
    const metrics = estimateTextChars(text);
    chars += metrics.div4Chars;
    weighted += metrics.weightedTokens;
  };
  if (typeof msg.content === 'string') {
    addText(msg.content);
  } else if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as {
        type?: unknown;
        text?: unknown;
        thinking?: unknown;
        name?: unknown;
        arguments?: unknown;
      };
      if (b.type === 'text' && typeof b.text === 'string') addText(b.text);
      else if (b.type === 'thinking' && typeof b.thinking === 'string') addText(b.thinking);
      else if (b.type === 'toolCall') {
        const serialized = `${String(b.name ?? '')}${JSON.stringify(b.arguments ?? {})}`;
        addText(serialized);
      } else if (b.type === 'image') {
        chars += ESTIMATED_IMAGE_CHARS;
        weighted += Math.ceil(ESTIMATED_IMAGE_CHARS / 4);
      }
    }
  } else if (typeof msg.summary === 'string') {
    addText(msg.summary);
  }
  return {
    div4Tokens: Math.ceil(chars / 4),
    weightedTokens: weighted,
  };
}

function getLastValidUsageTokens(
  messages: readonly unknown[],
): { tokens: number; index: number } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Partial<AssistantMessage> | undefined;
    if (
      msg &&
      msg.role === 'assistant' &&
      msg.stopReason !== 'aborted' &&
      msg.stopReason !== 'error' &&
      msg.usage
    ) {
      const tokens = calculateUsageTokens(msg.usage);
      if (tokens > 0) return { tokens, index: i };
    }
  }
  return null;
}

function estimateProjectedDiv4Tokens(projection: SessionProjection): number {
  const usageInfo = getLastValidUsageTokens(projection.messages);
  if (usageInfo) {
    let trailing = 0;
    for (let i = usageInfo.index + 1; i < projection.messages.length; i++) {
      trailing += estimateMessageTokenMetrics(projection.messages[i]).div4Tokens;
    }
    return usageInfo.tokens + trailing;
  }
  let total = 0;
  for (const message of projection.messages) {
    total += estimateMessageTokenMetrics(message).div4Tokens;
  }
  return total;
}

/**
 * Scales default compaction budgets (`reserveTokens` and `keepRecentTokens`) to
 * the model's context window and calibrates `keepRecentTokens` against real
 * provider usage / non-ASCII token density so cut-point selection works on both
 * small windows and CJK-heavy sessions.
 */
export function installPiCompactionSettingsGuard(
  settingsManager: unknown,
  getSessionManager?: () => unknown,
): void {
  if (
    !settingsManager ||
    typeof settingsManager !== 'object' ||
    guardedSettingsManagers.has(settingsManager)
  ) {
    return;
  }
  const typed = settingsManager as SettingsManagerLike;
  if (typeof typed.getCompactionSettings !== 'function') return;
  guardedSettingsManagers.add(settingsManager);

  const origGetCompactionSettings = typed.getCompactionSettings;
  typed.getCompactionSettings = function guardedGetCompactionSettings(model) {
    const raw = origGetCompactionSettings.call(this, model);
    const compactionConfig = typed.settings?.compaction;
    const modelKey = model?.provider && model?.id ? `${model.provider}/${model.id}` : undefined;
    const modelOverride = modelKey ? compactionConfig?.modelOverrides?.[modelKey] : undefined;
    const defaults = computePiCompactionDefaults(model?.contextWindow);

    const hasExplicitReserve =
      modelOverride?.reserveTokens !== undefined || compactionConfig?.reserveTokens !== undefined;
    const hasExplicitKeepRecent =
      modelOverride?.keepRecentTokens !== undefined ||
      compactionConfig?.keepRecentTokens !== undefined;

    const reserveTokens = hasExplicitReserve ? raw.reserveTokens : defaults.reserveTokens;
    let keepRecentTokens = hasExplicitKeepRecent ? raw.keepRecentTokens : defaults.keepRecentTokens;

    const sessionManager = getSessionManager?.() as SessionManagerLike | undefined;
    const contextWindow = model?.contextWindow;
    if (
      !hasExplicitKeepRecent &&
      sessionManager &&
      typeof sessionManager.buildSessionProjection === 'function' &&
      typeof sessionManager.getBranch === 'function' &&
      typeof contextWindow === 'number' &&
      contextWindow > 0
    ) {
      const projection = sessionManager.buildSessionProjection();
      const nonSystemMessages = projection.messages.filter(
        message => (message as { role?: unknown }).role !== 'system',
      );
      let estimatedNonSystemDiv4 = 0;
      let weightedNonSystem = 0;
      for (const message of nonSystemMessages) {
        const metrics = estimateMessageTokenMetrics(message);
        estimatedNonSystemDiv4 += metrics.div4Tokens;
        weightedNonSystem += metrics.weightedTokens;
      }
      const totalProjectionDiv4 = estimateProjectedDiv4Tokens(projection);
      let branchPressureTokens = 0;
      const branch = sessionManager.getBranch();
      for (let i = branch.length - 1; i >= 0; i--) {
        const entry = branch[i];
        if (entry.type === 'compaction') break;
        if (entry.type !== 'message' || entry.message.role !== 'assistant') continue;
        const assistant = entry.message as AssistantMessage;
        const usageTokens = assistant.usage ? calculateUsageTokens(assistant.usage) : 0;
        const explicitOverflow =
          assistant.stopReason === 'error' && isContextOverflow(assistant, contextWindow);
        if (usageTokens > 0 || explicitOverflow || assistant.stopReason === 'length') {
          branchPressureTokens = Math.max(usageTokens, explicitOverflow ? contextWindow : 0);
          break;
        }
      }
      const effectivePressure = Math.max(
        totalProjectionDiv4,
        weightedNonSystem,
        branchPressureTokens,
      );
      if (estimatedNonSystemDiv4 > 0 && effectivePressure > estimatedNonSystemDiv4) {
        const tokenScale = effectivePressure / estimatedNonSystemDiv4;
        keepRecentTokens = Math.max(1, Math.floor(keepRecentTokens / tokenScale));
      }
      if (
        (effectivePressure > contextWindow - reserveTokens || branchPressureTokens > 0) &&
        estimatedNonSystemDiv4 > 0 &&
        estimatedNonSystemDiv4 <= keepRecentTokens
      ) {
        // Never let keepRecentTokens suppress a required compaction when history is small in chars/4.
        keepRecentTokens = 0;
      }
    }

    return {
      enabled: raw.enabled,
      reserveTokens,
      keepRecentTokens,
    };
  };
}

function combineUsageTotals(first: Usage, second: Usage): Usage {
  return {
    input: first.input + second.input,
    output: first.output + second.output,
    cacheRead: first.cacheRead + second.cacheRead,
    cacheWrite: first.cacheWrite + second.cacheWrite,
    ...(first.reasoning !== undefined || second.reasoning !== undefined
      ? { reasoning: (first.reasoning ?? 0) + (second.reasoning ?? 0) }
      : {}),
    totalTokens: first.totalTokens + second.totalTokens,
    cost: {
      input: first.cost.input + second.cost.input,
      output: first.cost.output + second.cost.output,
      cacheRead: first.cost.cacheRead + second.cost.cacheRead,
      cacheWrite: first.cost.cacheWrite + second.cost.cacheWrite,
      total: first.cost.total + second.cost.total,
    },
  };
}

function getSummarizationFailure(response: AssistantMessage, label: string): string | undefined {
  if (response.stopReason === 'error') {
    return `${label} failed: ${response.errorMessage || 'Unknown error'}`;
  }
  if (response.stopReason === 'length') {
    return `${label} failed: generation hit the token cap and the summary is incomplete`;
  }
  return undefined;
}

function buildSummarizationContext(promptText: string): TranscriptContext {
  return normalizeContext({
    systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: promptText }],
        timestamp: Date.now(),
      },
    ],
  });
}

function formatFileOperationsFromPreparation(fileOps: CompactionPreparation['fileOps']): {
  readFiles: string[];
  modifiedFiles: string[];
  formatted: string;
} {
  const edited = fileOps?.edited ?? new Set<string>();
  const written = fileOps?.written ?? new Set<string>();
  const read = fileOps?.read ?? new Set<string>();
  const modified = new Set<string>([...edited, ...written]);
  const readFiles = [...read].filter(file => !modified.has(file)).sort();
  const modifiedFiles = [...modified].sort();
  const sections: string[] = [];
  if (readFiles.length > 0) sections.push(`<read-files>\n${readFiles.join('\n')}\n</read-files>`);
  if (modifiedFiles.length > 0) {
    sections.push(`<modified-files>\n${modifiedFiles.join('\n')}\n</modified-files>`);
  }
  return {
    readFiles,
    modifiedFiles,
    formatted: sections.length > 0 ? `\n\n${sections.join('\n\n')}` : '',
  };
}

/**
 * Recursively splits oversized summarization source text at line/word/surrogate-safe
 * boundaries so checkpoint generation always stays inside the model window, and
 * rejects truncated (`stopReason === 'length'`) or unreduced summaries atomically.
 */
export async function completeBoundedSummary(
  model: Model<any>,
  source: string,
  buildContext: (text: string) => TranscriptContext,
  complete: (context: TranscriptContext) => Promise<AssistantMessage>,
  signal?: AbortSignal,
  label = 'Summarization',
): Promise<AssistantMessage> {
  let usage: Usage | undefined;
  const summarize = async (text: string, part = false): Promise<AssistantMessage> => {
    signal?.throwIfAborted();
    const prefix = part
      ? 'This is a contiguous excerpt or ordered partial summaries. It may start or end inside a message. Summarize only the information present.\n\n'
      : '';
    const context = buildContext(`${prefix}${text}`);
    let available: number;
    try {
      available = clampMagpieMaxTokensToContext(
        model,
        buildContext(prefix),
        Number.MAX_SAFE_INTEGER,
      );
    } catch {
      throw new Error('Summary instructions leave no room for source text in the model context');
    }
    let fits = true;
    try {
      const minimumOutput = Math.min(model.maxTokens, 4096, Math.max(1, Math.floor(available / 2)));
      fits = clampMagpieMaxTokensToContext(model, context, model.maxTokens) >= minimumOutput;
    } catch {
      fits = false;
    }
    if (fits) {
      const response = await complete(context);
      usage = usage ? combineUsageTotals(usage, response.usage) : response.usage;
      signal?.throwIfAborted();
      if (!isContextOverflow(response)) {
        const failure = getSummarizationFailure(response, label);
        if (failure) throw new Error(failure);
        if (response.content.some(block => block.type === 'toolCall')) {
          throw new Error(`${label} attempted to call a tool`);
        }
        if (response.stopReason !== 'stop') {
          throw new Error(`${label} failed: ${response.stopReason}`);
        }
        if (!contentText(response.content as TextContent[]).trim()) {
          throw new Error(`${label} returned an empty summary`);
        }
        return response;
      }
    }
    let middle = Math.floor(text.length / 2);
    let boundary = text.lastIndexOf('\n', middle - 1);
    if (boundary < Math.floor(middle / 2)) boundary = text.lastIndexOf(' ', middle - 1);
    if (boundary >= Math.floor(middle / 2)) middle = boundary + 1;
    const before = text.charCodeAt(middle - 1);
    const after = text.charCodeAt(middle);
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) {
      middle--;
    }
    if (middle <= 0 || middle >= text.length) {
      throw new Error('Summary instructions leave no room for source text in the model context');
    }
    const left = await summarize(text.slice(0, middle), true);
    const right = await summarize(text.slice(middle), true);
    const merged = `<earlier-summary>\n${contentText(left.content as TextContent[])}\n</earlier-summary>\n<later-summary>\n${contentText(right.content as TextContent[])}\n</later-summary>`;
    if (merged.length >= text.length) {
      throw new Error('Summarization did not reduce the oversized history');
    }
    return summarize(merged, true);
  };
  const result = await summarize(source);
  return { ...result, usage: usage ?? result.usage };
}

export async function runBoundedCompaction(params: {
  preparation: CompactionPreparation;
  model: Model<any>;
  streamFn: (
    model: Model<any>,
    context: TranscriptContext,
    options?: Record<string, unknown>,
  ) => Promise<{ result(): Promise<AssistantMessage> }> | { result(): Promise<AssistantMessage> };
  customInstructions?: string;
  signal?: AbortSignal;
  thinkingLevel?: string;
  retry?: RetryPolicy;
}): Promise<{
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  usage: Usage;
  details: { readFiles: string[]; modifiedFiles: string[] };
}> {
  const { preparation, model, streamFn, customInstructions, signal, thinkingLevel, retry } = params;
  const {
    firstKeptEntryId,
    messagesToSummarize,
    turnPrefixMessages,
    isSplitTurn,
    tokensBefore,
    previousSummary,
    fileOps,
  } = preparation;
  if (!firstKeptEntryId) {
    throw new Error('First kept entry has no UUID - session may need migration');
  }
  const { convertToLlm, serializeConversation } = await import('@earendil-works/pi-coding-agent');
  const complete = (context: TranscriptContext) => {
    const options: Record<string, unknown> = {
      signal,
      cacheRetention: 'none',
      sessionId: uuidv7(),
      ...(model.reasoning && thinkingLevel && thinkingLevel !== 'off'
        ? { reasoning: thinkingLevel }
        : {}),
    };
    const produce = async () => (await streamFn(model, context, options)).result();
    return retryAssistantCall(produce, retry, signal);
  };

  const summarizeMessages = async (
    messages: typeof messagesToSummarize,
    instructionsPrompt: string,
    includePreviousSummary: boolean,
    label: string,
    wrapPrefix: (source: string) => string,
  ): Promise<{ text: string; usage: Usage }> => {
    const serialized = serializeConversation(convertToLlm(messages));
    let source = `${wrapPrefix(serialized)}`;
    if (includePreviousSummary && previousSummary) {
      source += `<previous-summary>\n${previousSummary}\n</previous-summary>`;
    }
    const response = await completeBoundedSummary(
      model,
      source.trimEnd(),
      text => buildSummarizationContext(`${text}\n\n${instructionsPrompt}`),
      complete,
      signal,
      label,
    );
    return { text: contentText(response.content as TextContent[]), usage: response.usage };
  };

  let basePrompt = previousSummary ? UPDATE_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT;
  if (customInstructions) {
    basePrompt = `${basePrompt}\n\nAdditional focus: ${customInstructions}`;
  }

  let summary: string;
  let usage: Usage;
  if (isSplitTurn && turnPrefixMessages.length > 0) {
    let historyText = previousSummary ?? 'No prior history.';
    let historyUsage: Usage | undefined;
    if (messagesToSummarize.length > 0) {
      const historyResult = await summarizeMessages(
        messagesToSummarize,
        basePrompt,
        Boolean(previousSummary),
        'Summarization',
        serialized => `<conversation>\n${serialized}\n</conversation>\n\n`,
      );
      historyText = historyResult.text;
      historyUsage = historyResult.usage;
    }
    let turnInstructions = TURN_PREFIX_SUMMARIZATION_PROMPT;
    if (customInstructions) {
      turnInstructions = `${turnInstructions}\n\nAdditional focus: ${customInstructions}`;
    }
    const turnResult = await summarizeMessages(
      turnPrefixMessages,
      turnInstructions,
      false,
      'Turn prefix summarization',
      serialized => `# Conversation\n${serialized}`,
    );
    summary = `${historyText}\n\n---\n\n**Turn Context (split turn):**\n\n${turnResult.text}`;
    usage = historyUsage ? combineUsageTotals(historyUsage, turnResult.usage) : turnResult.usage;
  } else {
    const historyResult = await summarizeMessages(
      messagesToSummarize,
      basePrompt,
      Boolean(previousSummary),
      'Summarization',
      serialized => `<conversation>\n${serialized}\n</conversation>\n\n`,
    );
    summary = historyResult.text;
    usage = historyResult.usage;
  }

  const fileSections = formatFileOperationsFromPreparation(fileOps);
  summary += fileSections.formatted;
  return {
    summary,
    firstKeptEntryId,
    tokensBefore,
    usage,
    details: {
      readFiles: fileSections.readFiles,
      modifiedFiles: fileSections.modifiedFiles,
    },
  };
}

/**
 * Triggers bounded pre-flight compaction before sending a prompt when an
 * existing resumed history already exceeds the model's compaction threshold.
 */
export async function compactPiSessionIfOversizedBeforePrompt(params: {
  session: { compact?: (customInstructions?: string) => Promise<unknown> };
  sessionManager: unknown;
  settingsManager?: { getCompactionSettings?: (model?: unknown) => CompactionSettings } | null;
  model: Record<string, unknown>;
  promptText: string;
  active: { lastCompactionError?: Error };
}): Promise<void> {
  const { session, sessionManager, settingsManager, model, promptText, active } = params;
  const typedManager = sessionManager as SessionManagerLike | undefined;
  const contextWindow = model?.contextWindow;
  if (
    !typedManager ||
    typeof typedManager.buildSessionProjection !== 'function' ||
    typeof typedManager.getBranch !== 'function' ||
    typeof session.compact !== 'function' ||
    typeof contextWindow !== 'number' ||
    contextWindow <= 0
  ) {
    return;
  }
  const settings = settingsManager?.getCompactionSettings?.(model);
  if (settings?.enabled === false) return;
  const branch = typedManager.getBranch();
  if (branch.length === 0 || branch[branch.length - 1]?.type === 'compaction') {
    return;
  }
  const projection = typedManager.buildSessionProjection();
  const projectedTokens =
    estimateProjectedDiv4Tokens(projection) + Math.ceil(promptText.length / 4);
  const reserveTokens =
    settings?.reserveTokens ?? computePiCompactionDefaults(contextWindow).reserveTokens;
  if (projectedTokens <= contextWindow - reserveTokens) {
    return;
  }
  active.lastCompactionError = undefined;
  try {
    await session.compact();
  } catch (error) {
    const realError = active.lastCompactionError;
    active.lastCompactionError = undefined;
    throw realError ?? error;
  }
  if (active.lastCompactionError) {
    const realError = active.lastCompactionError;
    active.lastCompactionError = undefined;
    throw realError;
  }
}
