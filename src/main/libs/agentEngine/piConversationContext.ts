import type { CoworkMessage } from '../../coworkStore';

const PiConversationContextLimit = {
  TotalChars: 60_000,
  EntryChars: 8_000,
  DefaultContextWindowTokens: 32_768,
  DefaultMaxOutputTokens: 4_096,
  ReservedPromptTokens: 8_192,
  CharsPerToken: 0.5,
} as const;

export const calculatePiConversationHistoryCharLimit = (
  contextWindowTokens?: number,
  maxOutputTokens?: number,
): number => {
  const contextWindow =
    Number.isFinite(contextWindowTokens) && (contextWindowTokens ?? 0) > 0
      ? contextWindowTokens!
      : PiConversationContextLimit.DefaultContextWindowTokens;
  const outputTokens =
    Number.isFinite(maxOutputTokens) && (maxOutputTokens ?? 0) > 0
      ? maxOutputTokens!
      : PiConversationContextLimit.DefaultMaxOutputTokens;
  const availableTokens = Math.max(
    1,
    contextWindow - outputTokens - PiConversationContextLimit.ReservedPromptTokens,
  );
  return Math.min(
    PiConversationContextLimit.TotalChars,
    Math.max(2_000, Math.floor(availableTokens * PiConversationContextLimit.CharsPerToken)),
  );
};

const truncateEntry = (value: string): string => {
  const normalized = value.trim();
  if (normalized.length <= PiConversationContextLimit.EntryChars) return normalized;
  return `${normalized.slice(0, PiConversationContextLimit.EntryChars)}\n[truncated]`;
};

const formatHistoryMessage = (message: CoworkMessage): string | null => {
  if (message.type === 'assistant') {
    if (message.metadata?.isThinking) return null;
    const content = truncateEntry(message.content);
    return content ? `Assistant: ${content}` : null;
  }
  if (message.type === 'user') {
    const content = truncateEntry(message.content);
    return content ? `User: ${content}` : null;
  }
  if (message.type === 'tool_use') {
    const toolName =
      typeof message.metadata?.toolName === 'string' ? message.metadata.toolName : 'unknown';
    const input = message.metadata?.toolInput;
    const inputText = input ? truncateEntry(JSON.stringify(input)) : '';
    return `Tool call (${toolName})${inputText ? `: ${inputText}` : ''}`;
  }
  if (message.type === 'tool_result') {
    const content = truncateEntry(message.content || String(message.metadata?.toolResult || ''));
    return content ? `Tool result: ${content}` : null;
  }
  return null;
};

export const buildPiConversationPrompt = (
  messages: CoworkMessage[],
  currentPrompt: string,
  options: { maxChars?: number } = {},
): string => {
  const totalChars = Math.min(
    PiConversationContextLimit.TotalChars,
    Math.max(2_000, Math.floor(options.maxChars ?? PiConversationContextLimit.TotalChars)),
  );
  const entries = messages.map(formatHistoryMessage).filter((entry): entry is string => !!entry);
  const selected: string[] = [];
  let selectedChars = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const nextChars = selectedChars + entry.length + 2;
    if (nextChars > totalChars) break;
    selected.unshift(entry);
    selectedChars = nextChars;
  }
  if (selected.length === 0) return currentPrompt;
  return [
    '=== PREVIOUS CONVERSATION (context only, do not re-execute) ===',
    selected.join('\n\n'),
    '=== END PREVIOUS CONVERSATION ===',
    '',
    `User: ${currentPrompt}`,
  ].join('\n');
};
