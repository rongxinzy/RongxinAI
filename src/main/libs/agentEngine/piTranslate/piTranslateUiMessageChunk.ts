/**
 * Cowork streaming — translator entry (Pi session events → UIMessageChunk).
 *
 * Flow: Pi delta → **this file** → coalescer → sequencer/ring buffer → IPC → LiveTextStore → StreamingMarkdownResponse.
 * This layer only maps Pi 1.3.x events to incremental `UIMessageChunk` values; it does not merge, throttle, or IPC.
 *
 * Invariants: wire carries increments only; merge once (coalescer) and throttle once (renderer rAF + plain tail).
 * Snapshots (`ContentPatch` / uiStreamSnapshot) are only for non-append, truncation, or recovery — not routine tokens.
 *
 * History: 200 ms full-text messageUpdate emit (1915c318), worker prefix diff, PR #1115 full-snapshot IPC (O(N²) bytes).
 *
 * **禁止**发送端先拼全文再算增量；**禁止**第二层发送端节流；**禁止**用 IPC 全文快照作常规更新。
 *
 * Source: vercel/ai @ai-sdk/harness-pi@1.0.156 — packages/harness-pi/src/pi-translate.ts (Apache-2.0).
 * Adapted: output mapped to `UIMessageChunk` from `ai`; finish-step/compaction omitted from Cowork IPC.
 * Architecture: docs/architecture/streaming.md
 */
import { randomBytes } from 'node:crypto';
import type { UIMessageChunk } from 'ai';
import { secureJsonParse } from '@ai-sdk/provider-utils';
import {
  extractAssistantText,
  getPiTerminalError,
  type PiSessionEvent,
  type PiUsage,
} from './piEvents';
import { serializeToolOutput } from './piTranslateUtils';

type DynamicToolKind = 'mcp' | 'extension';
type ToolKind = 'host' | 'builtin' | DynamicToolKind;

/**
 * Translator state shared across all events of a single turn. Reset at the
 * start of every `doPromptTurn`. Callers update the same instance and read it to
 * decide when a turn has settled into a steady state (e.g. for gap-filling).
 */
export interface PiTranslatorState {
  /**
   * True once a `turn_start` or assistant `message_start` event has been
   * observed. Suppresses spurious deltas that arrive before the turn opens.
   */
  promptStarted: boolean;
  /** Accumulated assistant text from `text_delta` events. */
  streamedAssistantText: string;
  /** Stream-part id for the active text block; synthesized on first delta. */
  currentTextId: string | undefined;
  /**
   * Stream-part id for the active reasoning block; synthesized lazily on
   * first `thinking_delta`.
   */
  currentReasoningId: string | undefined;
  /** Whether a `reasoning-start` event has already been emitted. */
  reasoningStarted: boolean;
  /** Tool-call id → tool name (used to fill in `toolName` on results). */
  observedToolNames: Map<string, string>;
  /**
   * Content-block index → tool-call id for tool inputs that are still
   * streaming. Pi addresses `toolcall_*` events by `contentIndex`, while the
   * harness stream parts are keyed by the tool call id, so the id is resolved
   * once at `toolcall_start` and reused for the deltas that follow.
   */
  streamingToolInputIds: Map<number, string>;
  /** Tool ids requested by the current assistant message but not yet completed. */
  pendingStepToolCallIds: Set<string>;
  /**
   * Id of the first tool call the current assistant message streamed. Pi
   * always starts that call first, so its input streams live. Inputs of later
   * calls are buffered until Pi starts them: in sequential batches a call
   * that has not started yet must not surface before the turn pauses.
   */
  firstStreamedToolCallId: string | undefined;
  /** Tool-call id -> buffered `tool-input-*` parts for not-yet-started calls. */
  bufferedToolInputParts: Map<string, UIMessageChunk[]>;
  /**
   * Tool calls already covered by an early `finish-step` of the current step
   * (see `takePiEarlyFinishStep`).
   */
  earlyFinishStepToolCallIds: Set<string>;
  /** Whether the current assistant message has opened a visible step. */
  stepOpen: boolean;
  stepUsage: PiUsage | undefined;
  /** Pi's session stats do not track reasoning. */
  turnReasoningTokens: number | undefined;
  /**
   * Pi retries a failed request itself (rate limits, overloads, a context
   * overflow after compaction), and the failed attempt still reports
   * `stopReason: 'error'`.
   */
  lastAssistantError: string | undefined;
  /**
   * Tool-call id → the exact output value the host submitted for a
   * user-registered (host-executed) tool. Pi only echoes the tool result back
   * as serialized text (the tool handler stringifies the output before handing
   * it to the runtime so the model can read it), which would otherwise reach
   * consumers as a string and lose the original object structure. Keeping the
   * submitted value here lets the result projection surface the original object
   * — matching the other adapters — while the model still receives the text.
   * Populated by the session's `submitToolResult`; consumed (and cleared) when
   * the matching `tool_result`/`tool_execution_end` event is translated.
   */
  hostToolResults: Map<string, unknown>;
  dynamicToolCalls: Map<string, DynamicToolKind>;
  /**
   * Names of tools that Pi executes natively (read/write/edit/bash/grep/
   * find/ls). `tool-call` events for these get `providerExecuted: true`
   * so the harness host doesn't try to dispatch them. User-registered
   * tools are not in this set.
   */
  readonly builtinToolNames: ReadonlySet<string>;
  readonly hostToolNames: ReadonlySet<string>;
  /**
   * Map of native tool name → common name. `find` → `glob`, etc. Pi emits
   * native names on its events; the wire `toolName` is the common name when
   * one exists.
   */
  readonly nativeToCommonNameMap: ReadonlyMap<string, string>;
}

export interface PiTranslatorStateOptions {
  readonly builtinToolNames?: ReadonlyArray<string>;
  readonly hostToolNames?: ReadonlyArray<string>;
  readonly nativeToCommon?: ReadonlyMap<string, string> | Record<string, string>;
}

export function createPiTranslatorState(options: PiTranslatorStateOptions = {}): PiTranslatorState {
  const map =
    options.nativeToCommon instanceof Map
      ? options.nativeToCommon
      : new Map(Object.entries(options.nativeToCommon ?? {}));
  return {
    promptStarted: false,
    streamedAssistantText: '',
    currentTextId: undefined,
    currentReasoningId: undefined,
    reasoningStarted: false,
    observedToolNames: new Map(),
    streamingToolInputIds: new Map(),
    pendingStepToolCallIds: new Set(),
    firstStreamedToolCallId: undefined,
    bufferedToolInputParts: new Map(),
    earlyFinishStepToolCallIds: new Set(),
    stepOpen: false,
    stepUsage: undefined,
    turnReasoningTokens: undefined,
    lastAssistantError: undefined,
    hostToolResults: new Map(),
    dynamicToolCalls: new Map(),
    builtinToolNames: new Set(options.builtinToolNames),
    hostToolNames: new Set(options.hostToolNames),
    nativeToCommonNameMap: map,
  };
}

function newId(): string {
  return randomBytes(8).toString('hex');
}

/**
 * Pi's `tool_execution_end` event payload (`result`) is a Pi `AgentToolResult`
 * envelope `{ content: (TextContent | ImageContent)[], details, terminate? }`.
 * The `tool_result` event uses a flat shape with `content` and `details` at
 * the top level. Text-only results without details retain the string projection,
 * including empty text. Preserve envelopes carrying details or non-text content.
 */
function unwrapPiToolResult(event: PiSessionEvent): never {
  const candidates: unknown[] = [];
  const result = event.result as unknown;
  if (result && typeof result === 'object') {
    const inner = (result as { content?: unknown }).content;
    if (Array.isArray(inner)) {
      const envelope = result as { content: unknown[]; details?: unknown };
      if (
        envelope.details != null ||
        inner.length === 0 ||
        Object.keys(envelope).some(key => key !== 'content' && key !== 'details') ||
        inner.some(
          part => !part || typeof part !== 'object' || !('type' in part) || part.type !== 'text',
        )
      ) {
        if (envelope.details === undefined) {
          const { details: _details, ...preserved } = envelope;
          return preserved as never;
        }
        return envelope as never;
      }
      candidates.push(inner);
    }
  }
  if (Array.isArray(event.content)) {
    if (
      event.details != null ||
      event.content.length === 0 ||
      event.content.some(
        part => !part || typeof part !== 'object' || !('type' in part) || part.type !== 'text',
      )
    ) {
      return {
        content: event.content,
        ...(event.details === undefined ? {} : { details: event.details }),
      } as never;
    }
    candidates.push(event.content);
  }

  for (const content of candidates) {
    if (!Array.isArray(content)) continue;
    const textParts = content.filter(
      (p): p is { type: 'text'; text: string } =>
        !!p &&
        typeof p === 'object' &&
        (p as { type?: unknown }).type === 'text' &&
        typeof (p as { text?: unknown }).text === 'string',
    );
    if (textParts.length > 0) {
      return textParts.map(p => p.text).join('') as never;
    }
  }

  if (typeof event.result === 'string') return event.result as never;
  if (typeof event.content === 'string') return event.content as never;
  return (event.result ?? event.content ?? null) as never;
}

function parseMcpToolResult(result: unknown): unknown {
  const text = typeof result === 'string' ? result : mcpResultText(result);
  if (text === undefined) return result;
  try {
    return secureJsonParse(text);
  } catch {
    return text;
  }
}

function mcpResultText(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) return undefined;
  const texts: string[] = [];
  for (const part of content) {
    if (
      !part ||
      typeof part !== 'object' ||
      (part as { type?: unknown }).type !== 'text' ||
      typeof (part as { text?: unknown }).text !== 'string'
    ) {
      return undefined;
    }
    texts.push((part as { text: string }).text);
  }
  return texts.join('');
}

function resolveToolName(
  state: PiTranslatorState,
  nativeName: string,
): { wire: string; native: string } {
  const common = state.nativeToCommonNameMap.get(nativeName);
  return { wire: common ?? nativeName, native: nativeName };
}

/**
 * How a tool call is dispatched, from the native tool name. Pi runs its
 * builtin, MCP and extension tools itself; only host tools are handed back to
 * the harness host. Pi's native MCP names every server tool
 * `mcp__<server>__<tool>`. `tool-input-start` reports the same flags as the
 * `tool-call` that follows it so a consumer does not have to wait for the call
 * to know who will execute it.
 */
function resolveToolKind(state: PiTranslatorState, nativeName: string): ToolKind {
  if (state.hostToolNames.has(nativeName)) return 'host';
  if (state.builtinToolNames.has(nativeName)) return 'builtin';
  return nativeName.startsWith('mcp__') ? 'mcp' : 'extension';
}

function isDynamicToolKind(kind: ToolKind): kind is DynamicToolKind {
  return kind === 'mcp' || kind === 'extension';
}

/**
 * The `{ id, name }` of the tool call a `toolcall_*` event refers to, read out
 * of the partial assistant message it carries. Returns undefined when the
 * block is missing or not a tool call yet, in which case the input is left
 * unstreamed — the complete `tool-call` still arrives at `tool_execution_start`.
 */
function readStreamingToolCall(
  event: PiSessionEvent,
): { contentIndex: number; id: string; name: string } | undefined {
  const update = event.assistantMessageEvent;
  const contentIndex = update?.contentIndex;
  if (typeof contentIndex !== 'number') return undefined;
  const block = update?.partial?.content?.[contentIndex];
  if (!block || typeof block !== 'object') return undefined;
  const record = block as Record<string, unknown>;
  if (record.type !== 'toolCall') return undefined;
  const { id, name } = record;
  if (typeof id !== 'string' || id.length === 0) return undefined;
  if (typeof name !== 'string' || name.length === 0) return undefined;
  return { contentIndex, id, name };
}

function toHarnessUsage(usage: PiUsage): Extract<UIMessageChunk, { type: 'finish-step' }>['usage'] {
  return {
    inputTokens: {
      total: usage.input + usage.cacheRead + usage.cacheWrite,
      noCache: usage.input,
      cacheRead: usage.cacheRead,
      cacheWrite: usage.cacheWrite,
    },
    outputTokens: {
      total: usage.output,
      text: usage.reasoning === undefined ? undefined : usage.output - usage.reasoning,
      reasoning: usage.reasoning,
    },
  };
}

const ZERO_PI_USAGE: PiUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
};

function createInferredFinishStep(): UIMessageChunk[] {
  return [];
}

function finishStep(_state: PiTranslatorState): UIMessageChunk[] {
  return [];
}

/**
 * Emit an early `finish-step` when Pi cannot make progress on the current
 * tool batch without host input, while keeping the step open: the regular
 * `finish-step` follows once every call of the batch has settled.
 *
 * In a parallel batch Pi waits on every unsettled call, so all of them must
 * be waiting on host input. In a sequential batch Pi waits on the first
 * unsettled call only; later calls have not started yet. A call that was
 * already covered by an earlier early `finish-step` of the same step does
 * not trigger another one, so a waiting set that only shrinks (results
 * arriving one by one) never produces an extra step boundary.
 */
function takePiEarlyFinishStep(): UIMessageChunk[] {
  return [];
}

type ToolInputStreamChunk = Extract<
  UIMessageChunk,
  { type: 'tool-input-start' | 'tool-input-delta' }
>;

const toolInputCallId = (part: ToolInputStreamChunk): string => part.toolCallId;

function bufferToolInputPart(
  state: PiTranslatorState,
  part: ToolInputStreamChunk,
): UIMessageChunk[] {
  const toolCallId = toolInputCallId(part);
  if (toolCallId === state.firstStreamedToolCallId) return [part];
  const buffered = state.bufferedToolInputParts.get(toolCallId) ?? [];
  buffered.push(part);
  state.bufferedToolInputParts.set(toolCallId, buffered);
  return [];
}

function extractPiToolCallIds(message: PiSessionEvent['message']): string[] {
  if (!message || message.role !== 'assistant') return [];
  if (!Array.isArray(message.content)) return [];
  return message.content.flatMap(part => {
    if (!part || typeof part !== 'object') return [];
    const block = part as Record<string, unknown>;
    if (block.type !== 'toolCall') return [];
    const id = block.id ?? block.toolCallId;
    return typeof id === 'string' && id.length > 0 ? [id] : [];
  });
}

/**
 * Translate a single Pi `session.subscribe` event into zero or more
 * `UIMessageChunk`s, updating the translator state in place. Returns
 * an empty array for events that produce no output (e.g. events emitted
 * before `turn_start`).
 *
 * The translator does NOT emit `stream-start`/`finish` — those are
 * lifecycle signals owned by the session layer.
 */
export function translatePiSessionEventToUiChunks(
  event: PiSessionEvent,
  state: PiTranslatorState,
): UIMessageChunk[] {
  switch (event.type) {
    case 'turn_start':
    case 'message_start': {
      if (event.type === 'message_start' && event.message?.role !== 'assistant') {
        return [];
      }
      state.promptStarted = true;
      if (event.type === 'message_start') {
        state.stepOpen = true;
        state.pendingStepToolCallIds.clear();
        state.earlyFinishStepToolCallIds.clear();
        state.stepUsage = undefined;
        state.firstStreamedToolCallId = undefined;
        state.bufferedToolInputParts.clear();
      }
      state.streamedAssistantText = '';
      state.currentTextId = undefined;
      state.currentReasoningId = undefined;
      state.reasoningStarted = false;
      // Content-block indices restart with every assistant message.
      state.streamingToolInputIds.clear();
      return [];
    }

    case 'message_update': {
      if (!state.promptStarted) return [];
      const update = event.assistantMessageEvent;
      if (!update) return [];
      if (update.type === 'text_delta' && typeof update.delta === 'string') {
        const parts: UIMessageChunk[] = [];
        // If reasoning was active, close it before opening the text block so
        // consumers can reset block-scoped formatting (ANSI colors, etc.)
        // between sections.
        if (state.reasoningStarted && state.currentReasoningId) {
          parts.push({
            type: 'reasoning-end',
            id: state.currentReasoningId,
          });
          state.reasoningStarted = false;
          state.currentReasoningId = undefined;
        }
        if (!state.currentTextId) {
          state.currentTextId = newId();
          parts.push({ type: 'text-start', id: state.currentTextId });
        }
        state.streamedAssistantText += update.delta;
        parts.push({
          type: 'text-delta',
          id: state.currentTextId,
          delta: update.delta,
        });
        return parts;
      }
      if (update.type === 'thinking_delta' && typeof update.delta === 'string') {
        const parts: UIMessageChunk[] = [];
        // Symmetric to the text branch: close any open text block before
        // starting a fresh reasoning block.
        if (state.currentTextId) {
          parts.push({ type: 'text-end', id: state.currentTextId });
          state.currentTextId = undefined;
        }
        if (!state.currentReasoningId) {
          state.currentReasoningId = newId();
        }
        if (!state.reasoningStarted) {
          state.reasoningStarted = true;
          parts.push({ type: 'reasoning-start', id: state.currentReasoningId });
        }
        parts.push({
          type: 'reasoning-delta',
          id: state.currentReasoningId,
          delta: update.delta,
        });
        return parts;
      }
      // Tool inputs stream as raw JSON text, the same way text and reasoning
      // stream. Surfacing them lets a consumer show what the model is writing
      // before the call is complete, instead of waiting for the whole input to
      // land at `tool_execution_start`.
      if (update.type === 'toolcall_start') {
        const call = readStreamingToolCall(event);
        if (!call) return [];
        const { wire, native } = resolveToolName(state, call.name);
        const kind = resolveToolKind(state, native);
        state.streamingToolInputIds.set(call.contentIndex, call.id);
        state.firstStreamedToolCallId ??= call.id;
        return bufferToolInputPart(state, {
          type: 'tool-input-start',
          toolCallId: call.id,
          toolName: wire,
          ...(kind !== 'host' ? { providerExecuted: true } : {}),
          ...(isDynamicToolKind(kind) ? { dynamic: true } : {}),
        });
      }
      if (update.type === 'toolcall_delta' || update.type === 'toolcall_end') {
        const contentIndex = update.contentIndex;
        if (typeof contentIndex !== 'number') return [];
        const id = state.streamingToolInputIds.get(contentIndex);
        // Without a start there is no id to attach the input to. Dropping it
        // is safe: the complete input still arrives with the `tool-call`.
        if (id === undefined) return [];
        if (update.type === 'toolcall_end') {
          state.streamingToolInputIds.delete(contentIndex);
          return [];
        }
        if (typeof update.delta !== 'string') return [];
        return bufferToolInputPart(state, {
          type: 'tool-input-delta',
          toolCallId: id,
          inputTextDelta: update.delta,
        });
      }
      return [];
    }

    case 'message_end':
    case 'turn_end': {
      if (!state.promptStarted) return [];
      const parts: UIMessageChunk[] = [];
      const fullText = extractAssistantText(event.message);
      if (
        state.currentTextId &&
        fullText.startsWith(state.streamedAssistantText) &&
        fullText.length > state.streamedAssistantText.length
      ) {
        const missing = fullText.slice(state.streamedAssistantText.length);
        state.streamedAssistantText = fullText;
        parts.push({
          type: 'text-delta',
          id: state.currentTextId,
          delta: missing,
        });
      }
      if (state.currentTextId) {
        parts.push({ type: 'text-end', id: state.currentTextId });
        state.currentTextId = undefined;
      }
      if (state.reasoningStarted && state.currentReasoningId) {
        parts.push({ type: 'reasoning-end', id: state.currentReasoningId });
        state.reasoningStarted = false;
        state.currentReasoningId = undefined;
      }
      if (event.type === 'message_end') {
        if (event.message?.role === 'assistant') {
          state.lastAssistantError = getPiTerminalError(event);
        }
        const usage = event.message?.role === 'assistant' ? event.message.usage : undefined;
        if (usage) {
          state.stepUsage = usage;
          if (usage.reasoning !== undefined) {
            state.turnReasoningTokens = (state.turnReasoningTokens ?? 0) + usage.reasoning;
          }
        }
        const toolCallIds = extractPiToolCallIds(event.message);
        for (const toolCallId of toolCallIds) {
          state.pendingStepToolCallIds.add(toolCallId);
        }
      } else {
        state.pendingStepToolCallIds.clear();
        if (!getPiTerminalError(event)) {
          parts.push(...finishStep(state));
        }
      }
      return parts;
    }

    case 'tool_execution_start': {
      if (!event.toolCallId || !event.toolName) return [];
      const { wire, native } = resolveToolName(state, event.toolName);
      state.observedToolNames.set(event.toolCallId, wire);
      const kind = resolveToolKind(state, native);
      if (isDynamicToolKind(kind)) {
        state.dynamicToolCalls.set(event.toolCallId, kind);
      }
      const input = serializeToolOutput(event.args ?? event.input ?? {});
      const bufferedInput = state.bufferedToolInputParts.get(event.toolCallId) ?? [];
      state.bufferedToolInputParts.delete(event.toolCallId);
      return [
        ...bufferedInput,
        {
          type: 'tool-input-available',
          toolCallId: event.toolCallId,
          toolName: wire,
          input,
          ...(kind !== 'host' ? { providerExecuted: true } : {}),
          ...(isDynamicToolKind(kind) ? { dynamic: true } : {}),
        },
      ];
    }

    case 'tool_execution_end':
    case 'tool_result': {
      if (!event.toolCallId) return [];
      const recordedName = state.observedToolNames.get(event.toolCallId);
      const nativeName = event.toolName;
      const wire =
        recordedName ?? (nativeName ? resolveToolName(state, nativeName).wire : undefined);
      if (!wire) return [];
      const nativeForKind = nativeName ?? wire;
      const kind = resolveToolKind(state, nativeForKind);
      const dynamicKind = state.dynamicToolCalls.get(event.toolCallId);
      state.dynamicToolCalls.delete(event.toolCallId);
      /*
       * Prefer the exact value the host submitted for user-registered tools
       * (see `hostToolResults`). Built-in tools, whose results Pi produces and
       * reports as text, are not in the map and fall back to unwrapping the
       * event's text payload.
       */
      const result = state.hostToolResults.has(event.toolCallId)
        ? ((state.hostToolResults.get(event.toolCallId) ?? null) as unknown)
        : dynamicKind === 'mcp'
          ? parseMcpToolResult(unwrapPiToolResult(event))
          : unwrapPiToolResult(event);
      state.hostToolResults.delete(event.toolCallId);
      state.pendingStepToolCallIds.delete(event.toolCallId);
      return [
        {
          type: 'tool-output-available',
          toolCallId: event.toolCallId,
          output: result,
          ...(kind !== 'host' ? { providerExecuted: true } : {}),
          ...(dynamicKind ? { dynamic: true } : {}),
        },
        ...finishStep(state),
      ];
    }

    default:
      return [];
  }
}
