import {
  type ChatRequestOptions,
  type ChatTransport,
  generateId,
  type UIMessage,
  type UIMessageChunk,
} from 'ai';

import type { CoworkPermissionResult } from '../types/cowork';

export interface CoworkChatTransportOptions {
  /** Session to send messages to. If omitted, a new session is created. */
  sessionId?: string;
  /** CWD override for new sessions. */
  cwd?: string;
  /** Optional skill ids to attach. */
  activeSkillIds?: string[];
  /** Optional agent id. */
  agentId?: string;
  /** System prompt for new sessions. */
  systemPrompt?: string;
}

/** Extract text from a UIMessage's text parts. */
function extractText(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

/** Extract image parts from a UIMessage. */
function extractImages(message: UIMessage): Array<{ name: string; mimeType: string; base64Data: string }> {
  const result: Array<{ name: string; mimeType: string; base64Data: string }> = [];
  for (const part of message.parts) {
    if (part.type === 'file' && part.mediaType?.startsWith('image/')) {
      const url = (part as { url?: string }).url || '';
      const commaIdx = url.indexOf(',');
      if (commaIdx >= 0) {
        result.push({
          name: 'image',
          mimeType: part.mediaType,
          base64Data: url.slice(commaIdx + 1),
        });
      }
    }
  }
  return result;
}

/**
 * A `ChatTransport` that bridges the existing Cowork IPC protocol into the
 * AI SDK v6 `useChat` hook.
 *
 * Key design decisions:
 *
 * 1. `tool_use` messages are emitted with `providerExecuted: true` —
 *    the agent (Pi/OpenClaw) executed the tool server-side, so the client
 *    does NOT need to call `addToolOutput`.
 *
 * 2. `tool_result` messages are emitted as `tool-output-available` chunks,
 *    matching the toolCallId so ai-sdk links them to the same ToolInvocation.
 *
 * 3. `onStreamMessageUpdate` sends the FULL accumulating content snapshot,
 *    NOT a delta.  We track the last-known content per messageId and emit only
 *    the diff so ai-elements renders without duplication.
 *
 * 4. Permission requests are mapped to `tool-approval-request` so the
 *    frontend can call `addToolApprovalResponse(approved)` and the transport
 *    routes the response back to `coworkService.respondToPermission()`.
 */
export class CoworkChatTransport implements ChatTransport<UIMessage> {
  private currentSessionId: string | null;
  /** Map from cowork tool_use DB id to the ai-sdk toolCallId for tool_output pairing. */
  private toolUseIdMap = new Map<string, string>();
  /** Track last-known content per cowork messageId to compute real deltas. */
  private lastContentByCoworkId = new Map<string, string>();

  /** Callback set externally by the UI layer to handle permission responses. */
  public onPermission: ((requestId: string, result: CoworkPermissionResult) => void) | null = null;

  constructor(private readonly options: CoworkChatTransportOptions = {}) {
    this.currentSessionId = options.sessionId ?? null;
  }

  getSessionId(): string | null {
    return this.currentSessionId;
  }

  // -- ChatTransport impl --------------------------------------------

  async sendMessages({
    chatId: _chatId,
    messages,
    abortSignal,
  }: {
    trigger: 'submit-message' | 'regenerate-message';
    chatId: string;
    messageId: string | undefined;
    messages: UIMessage[];
    abortSignal: AbortSignal | undefined;
  } & ChatRequestOptions): Promise<ReadableStream<UIMessageChunk>> {
    const cowork = window.electron?.cowork;
    if (!cowork) throw new Error('Cowork IPC bridge is not available.');

    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const prompt = lastUser ? extractText(lastUser) : '';
    const images = lastUser ? extractImages(lastUser) : [];

    const sessionId = this.currentSessionId;

    let session: { id: string } | undefined;
    if (sessionId) {
      const result = await cowork.continueSession({
        sessionId,
        prompt: prompt || '(empty)',
        activeSkillIds: this.options.activeSkillIds,
        imageAttachments: images.length > 0 ? images : undefined,
      });
      if (!result.success) throw new Error(result.error || 'Failed to continue session');
      session = result.session;
    } else {
      const result = await cowork.startSession({
        prompt: prompt || '(empty)',
        cwd: this.options.cwd,
        systemPrompt: this.options.systemPrompt,
        activeSkillIds: this.options.activeSkillIds,
        agentId: this.options.agentId,
        imageAttachments: images.length > 0 ? images : undefined,
      });
      if (!result.success) throw new Error(result.error || 'Failed to start session');
      session = result.session;
      this.currentSessionId = result.session?.id ?? null;
    }

    const activeSessionId = session?.id ?? this.currentSessionId;
    if (!activeSessionId) throw new Error('No session ID available after send.');

    return this.streamCoworkEvents(activeSessionId, abortSignal);
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }

  /**
   * Called by the frontend when the user approves/denies a tool-approval-request.
   * Bridges addToolApprovalResponse → cowork.respondToPermission.
   */
  async respondToPermission(requestId: string, result: CoworkPermissionResult): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork) return false;
    const response = await cowork.respondToPermission({ requestId, result });
    return response.success;
  }

  // -- Stream management ---------------------------------------------

  private streamCoworkEvents(
    sessionId: string,
    abortSignal: AbortSignal | undefined,
  ): ReadableStream<UIMessageChunk> {
    const cowork = window.electron?.cowork;
    // Capture class fields before entering the ReadableStream callback
    // where `this` refers to the underlying source, not the class instance.
    const lastContentByCoworkId = this.lastContentByCoworkId;
    const toolUseIdMap = this.toolUseIdMap;

    return new ReadableStream({
      start(controller) {
        let closed = false;
        let textId: string | null = null;
        let reasoningId: string | null = null;
        const emittedApprovals = new Set<string>();

        const enqueue = (chunk: UIMessageChunk) => {
          if (!closed) controller.enqueue(chunk);
        };

        const close = (reason?: string) => {
          if (closed) return;
          closed = true;
          if (textId) enqueue({ type: 'text-end', id: textId });
          if (reasoningId) enqueue({ type: 'reasoning-end', id: reasoningId });
          enqueue({
            type: 'finish',
            finishReason: reason === 'error' ? 'error' as const : 'stop' as const,
          });
          controller.close();
          cleanup.forEach((fn) => fn());
        };

        const cleanup: Array<() => void> = [];

        // -- onStreamMessage: new discrete messages --
        const unsubMsg = cowork.onStreamMessage(({ sessionId: sid, message }) => {
          if (sid !== sessionId) return;
          if (message.type === 'user') return;

          if (message.type === 'assistant') {
            const prev = lastContentByCoworkId.get(message.id) || '';
            const full = message.content || '';
            const delta = full.startsWith(prev) ? full.slice(prev.length) : full;
            lastContentByCoworkId.set(message.id, full);

            if (delta) {
              if (!textId) {
                textId = message.id || generateId();
                enqueue({ type: 'text-start', id: textId });
              }
              enqueue({ type: 'text-delta', id: textId, delta });
            }
            return;
          }

          if (message.type === 'tool_use') {
            const meta = message.metadata as Record<string, unknown> | undefined;
            const toolName = (meta?.toolName as string) || message.content || 'unknown';
            const toolUseId = (meta?.toolUseId as string) || message.id;
            const toolCallId = message.id || generateId();

            if (toolUseId) toolUseIdMap.set(toolUseId, toolCallId);

            enqueue({
              type: 'tool-input-available',
              toolCallId,
              toolName,
              input: (meta?.toolInput as Record<string, unknown>) ?? {},
              providerExecuted: true,
            });
            return;
          }

          if (message.type === 'tool_result') {
            const meta = message.metadata as Record<string, unknown> | undefined;
            const toolUseId = (meta?.toolUseId as string) || '';
            const toolCallId = toolUseIdMap.get(toolUseId) || message.id;

            enqueue({
              type: 'tool-output-available',
              toolCallId,
              output: (meta?.toolResult as string) || message.content || '',
              providerExecuted: true,
            });
            return;
          }

          if (message.type === 'system' && message.content) {
            enqueue({ type: 'start-step' });
            enqueue({ type: 'finish-step' });
          }
        });
        cleanup.push(unsubMsg);

        // -- onStreamMessageUpdate: streaming deltas --
        const unsubUpd = cowork.onStreamMessageUpdate(({ sessionId: sid, messageId, content }) => {
          if (sid !== sessionId) return;

          const prev = lastContentByCoworkId.get(messageId) || '';
          const delta = content.startsWith(prev) ? content.slice(prev.length) : content;
          lastContentByCoworkId.set(messageId, content);

          if (!delta) return;

          if (!textId) {
            textId = messageId || generateId();
            enqueue({ type: 'text-start', id: textId });
          }
          enqueue({ type: 'text-delta', id: textId, delta });
        });
        cleanup.push(unsubUpd);

        // -- onStreamPermission: tool execution requires user approval --
        const unsubPerm = cowork.onStreamPermission(({ sessionId: sid, request }) => {
          if (sid !== sessionId) return;
          if (emittedApprovals.has(request.requestId)) return;
          emittedApprovals.add(request.requestId);

          enqueue({
            type: 'tool-approval-request',
            approvalId: request.requestId,
            toolCallId: request.toolUseId || request.requestId,
          });
        });
        cleanup.push(unsubPerm);

        // Dismiss permission when the agent cancels it before user responds.
        const unsubPermDismiss = cowork.onStreamPermissionDismiss(({ requestId }) => {
          if (!emittedApprovals.has(requestId)) return;
          emittedApprovals.delete(requestId);
          enqueue({ type: 'tool-output-denied', toolCallId: requestId });
        });
        cleanup.push(unsubPermDismiss);

        // -- onStreamComplete --
        const unsubComplete = cowork.onStreamComplete(({ sessionId: sid }) => {
          if (sid !== sessionId) return;
          close('stop');
        });
        cleanup.push(unsubComplete);

        // -- onStreamError --
        const unsubErr = cowork.onStreamError(({ sessionId: sid, error }) => {
          if (sid !== sessionId) return;
          const message = typeof error === 'string' ? error : error.message;
          enqueue({ type: 'error', errorText: message });
          close('error');
        });
        cleanup.push(unsubErr);

        // -- abort --
        abortSignal?.addEventListener('abort', () => {
          void cowork.stopSession(sessionId);
        });
      },
    });
  }
}
