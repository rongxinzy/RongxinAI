import { useChat } from '@ai-sdk/react';
import { useMemo, useRef } from 'react';

import { CoworkChatTransport, type CoworkChatTransportOptions } from '../services/coworkChatTransport';
import type { CoworkPermissionResult } from '../types/cowork';

export type UseCoworkChatOptions = CoworkChatTransportOptions;

/**
 * AI SDK `useChat` hook backed by the Cowork IPC protocol.
 *
 * Renders ai-elements components (Conversation, Message, PromptInput, etc.)
 * against the existing Cowork agent engine without coupling to the Redux store.
 *
 * The transport instance is stabilized via useMemo so internal state
 * (sessionId, tool_use→tool_result id maps, content diff tracking) survives
 * React re-renders.
 *
 * Usage:
 * ```tsx
 * const { messages, sendMessage, status, respondToPermission } = useCoworkChat({ sessionId: 'abc123' });
 * ```
 */
export function useCoworkChat(options: UseCoworkChatOptions = {}) {
  const transportRef = useRef<CoworkChatTransport | null>(null);

  const transport = useMemo(() => {
    // Reuse existing transport if sessionId hasn't changed.
    if (transportRef.current
      && transportRef.current.getSessionId() === (options.sessionId ?? null)) {
      return transportRef.current;
    }
    const t = new CoworkChatTransport(options);
    transportRef.current = t;
    return t;
  // Re-create transport only when session/agent/cwd change — `options` object
  // identity is intentionally ignored (options.skills/options.systemPrompt are
  // only read at sendMessage time, not needed for transport identity).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.sessionId, options.agentId, options.cwd]);

  const chat = useChat({ transport });

  /**
   * Bridge `addToolApprovalResponse` → Cowork's `respondToPermission`.
   * Call this when the user approves or denies a tool-approval-request.
   */
  const respondToPermission = async (requestId: string, result: CoworkPermissionResult): Promise<boolean> => {
    chat.addToolApprovalResponse({
      id: requestId,
      approved: result.behavior === 'allow',
      reason: result.behavior === 'deny' ? result.message : undefined,
    });
    return transport.respondToPermission(requestId, result);
  };

  return {
    ...chat,
    respondToPermission,
    transport,
  };
}
