import { useChat } from '@ai-sdk/react';
import { useRef } from 'react';

import { ChatChatTransport } from '../services/chatChatTransport';

/**
 * AI SDK `useChat` hook backed by `apiService.chat()` for direct LLM chat mode.
 *
 * Usage:
 * ```tsx
 * const { messages, sendMessage, status } = useChatChat();
 * ```
 */
export function useChatChat() {
  const transportRef = useRef<ChatChatTransport>(new ChatChatTransport());

  const chat = useChat({ transport: transportRef.current });

  return chat;
}
