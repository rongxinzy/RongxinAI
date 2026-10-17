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
 * Adapted: output mapped to `UIMessageChunk` from `ai`.
 *
 * Not ported from upstream: the finish-step / compaction machinery (`toHarnessUsage`, `ZERO_PI_USAGE`,
 * `createInferredFinishStep`, `finishStep`, `takePiEarlyFinishStep`) and the state that only fed it (`stepOpen`,
 * `stepUsage`, `pendingStepToolCallIds`, `earlyFinishStepToolCallIds`, `turnReasoningTokens`). The Cowork IPC stream
 * never carries finish-step / compaction chunks — the session layer owns the turn lifecycle itself — so none of that
 * upstream state is observable through this translator and porting it would be dead code.
 *
 * Architecture: docs/architecture/streaming.md
 */
import { randomBytes } from 'node:crypto';
import type { UIMessageChunk } from 'ai';
import { extractAssistantText, getPiTerminalError, type PiSessionEvent } from './piEvents';
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
  /**
   * Tool-call id → wire tool name, recorded at `tool_execution_start`. Result
   * events do not always repeat `toolName`; the recorded name resolves the
   * dispatch flags of the result, and results for calls we never observed are
   * dropped because there is nothing to correlate them with.
   */
  observedToolNames: Map<string, string>;
  /**
   * Content-block index → tool-call id for tool inputs that are still
   * streaming. Pi addresses `toolcall_*` events by `contentIndex`, while the
   * UI chunks are keyed by the tool call id, so the id is resolved once at
   * `toolcall_start` and reused for the deltas that follow.
   */
  streamingToolInputIds: Map<number, string>;
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
   * find/ls). Chunks for these get `providerExecuted: true` so the UI does
   * not treat them as host-dispatched calls. User-registered tools are not in
   * this set.
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
    firstStreamedToolCallId: undefined,
    bufferedToolInputParts: new Map(),
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
 * End the currently open text / reasoning parts (if any) and clear their ids,
 * so the next delta opens a fresh part id. The turn bridge calls this before
 * sending a non-prefix snapshot: the renderer replaces the message text
 * wholesale there, and any later increment must start a new part instead of
 * appending to one whose prefix no longer matches. Returns the closing chunks.
 */
export function closeOpenTextAndReasoningParts(state: PiTranslatorState): UIMessageChunk[] {
  const parts: UIMessageChunk[] = [];
  if (state.currentTextId !== undefined) {
    parts.push({ type: 'text-end', id: state.currentTextId });
    state.currentTextId = undefined;
  }
  if (state.reasoningStarted && state.currentReasoningId !== undefined) {
    parts.push({ type: 'reasoning-end', id: state.currentReasoningId });
    state.reasoningStarted = false;
    state.currentReasoningId = undefined;
  }
  return parts;
}

/**
 * Align the accumulated assistant text with a snapshot the turn bridge sent
 * after a non-prefix rewrite. `message_end` gap-fill compares against this
 * value, so it must reflect what the renderer already has — otherwise the
 * closing event would re-send the whole snapshot as a "missing" suffix.
 */
export function setStreamedAssistantText(state: PiTranslatorState, text: string): void {
  state.streamedAssistantText = text;
}

/**
 * Pi's `tool_execution_end` event payload (`result`) is a Pi `AgentToolResult`
 * envelope `{ content: (TextContent | ImageContent)[], details, terminate? }`.
 * The `tool_result` event uses a flat shape with `content` and `details` at
 * the top level. Text-only results without details retain the string projection,
 * including empty text. Preserve envelopes carrying details or non-text content.
 */
function unwrapPiToolResult(event: PiSessionEvent): unknown {
  const candidates: unknown[] = [];
  const result = event.result;
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
          return preserved;
        }
        return envelope;
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
      };
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
      return textParts.map(p => p.text).join('');
    }
  }

  if (typeof event.result === 'string') return event.result;
  if (typeof event.content === 'string') return event.content;
  return event.result ?? event.content ?? null;
}

/**
 * Parse JSON while refusing prototype-pollution payloads.
 *
 * Semantics follow fastify/secure-json-parse (BSD-3-Clause) — the same rules
 * `@ai-sdk/provider-utils`'s `secureJsonParse` implements: a parsed value is
 * rejected when it contains a `__proto__` key, or a `constructor` key whose
 * value is an object that carries a `prototype` key. This is an independent
 * implementation (no runtime dependency added). Throws on invalid JSON or
 * forbidden keys; callers catch and fall back to the raw text.
 */
function safeJsonParse(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  rejectPrototypePollution(parsed);
  return parsed;
}

function rejectPrototypePollution(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      rejectPrototypePollution(item);
    }
    return;
  }
  if (value === null || typeof value !== 'object') {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === '__proto__') {
      throw new SyntaxError('Object contains forbidden prototype property');
    }
    if (
      key === 'constructor' &&
      child !== null &&
      typeof child === 'object' &&
      'prototype' in child
    ) {
      throw new SyntaxError('Object contains forbidden prototype property');
    }
    rejectPrototypePollution(child);
  }
}

function parseMcpToolResult(result: unknown): unknown {
  const text = typeof result === 'string' ? result : mcpResultText(result);
  if (text === undefined) return result;
  try {
    return safeJsonParse(text);
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

/**
 * `errorText` for `tool-output-error`: the projected result when it is already
 * a string, its JSON serialization otherwise, and a generic placeholder when
 * both are empty (mirrors the upstream `isError` semantics of preserving the
 * result payload).
 */
function toToolErrorText(result: unknown): string {
  const text = typeof result === 'string' ? result : (JSON.stringify(result) ?? '');
  return text.length > 0 ? text : 'Tool execution failed';
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
 * the host. Pi's native MCP names every server tool `mcp__<server>__<tool>`.
 * `tool-input-start` reports the same flags as the `tool-input-available` that
 * follows it so a consumer does not have to wait for the call to know who will
 * execute it.
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
 * unstreamed — the complete `tool-input-available` still arrives at
 * `tool_execution_start`.
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

type ToolInputStreamChunk = Extract<
  UIMessageChunk,
  { type: 'tool-input-start' | 'tool-input-delta' }
>;

function bufferToolInputPart(
  state: PiTranslatorState,
  part: ToolInputStreamChunk,
): UIMessageChunk[] {
  const toolCallId = part.toolCallId;
  if (toolCallId === state.firstStreamedToolCallId) return [part];
  const buffered = state.bufferedToolInputParts.get(toolCallId) ?? [];
  buffered.push(part);
  state.bufferedToolInputParts.set(toolCallId, buffered);
  return [];
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
        // A new assistant message cannot reuse the previous message's
        // buffered tool input (content-block ids and call order restart).
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
        // is safe: the complete input still arrives with the
        // `tool-input-available`.
        if (id === undefined) return [];
        if (update.type === 'toolcall_end') {
          // Unlike upstream, no `tool-input-end` is emitted here: the Cowork
          // renderer does not consume the tool-input stream, and
          // `tool-input-available` (sent at `tool_execution_start`) carries
          // the complete input. The mapping is only cleared so a reused
          // content index cannot leak the previous call's id.
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
      parts.push(...closeOpenTextAndReasoningParts(state));
      if (event.type === 'message_end' && event.message?.role === 'assistant') {
        state.lastAssistantError = getPiTerminalError(event);
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
      const hasSubmitted = state.hostToolResults.has(event.toolCallId);
      const submitted = state.hostToolResults.get(event.toolCallId);
      state.hostToolResults.delete(event.toolCallId);
      const unwrapped = unwrapPiToolResult(event);
      const result: unknown = hasSubmitted
        ? submitted === undefined
          ? null
          : submitted
        : dynamicKind === 'mcp'
          ? parseMcpToolResult(unwrapped)
          : unwrapped;
      const dispatchFlags = {
        ...(kind !== 'host' ? { providerExecuted: true } : {}),
        ...(dynamicKind !== undefined ? { dynamic: true } : {}),
      };
      // Pi reports tool failures with `isError: true`; map those to
      // `tool-output-error` so the UI can render the failure, with the
      // projected result as the error text.
      if (event.isError === true) {
        return [
          {
            type: 'tool-output-error',
            toolCallId: event.toolCallId,
            errorText: toToolErrorText(result),
            ...dispatchFlags,
          },
        ];
      }
      return [
        {
          type: 'tool-output-available',
          toolCallId: event.toolCallId,
          output: result,
          ...dispatchFlags,
        },
      ];
    }

    default:
      return [];
  }
}
