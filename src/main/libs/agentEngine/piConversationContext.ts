import type { CoworkMessage } from '../../coworkStore';
import { formatConversationAttachments } from './piConversationAttachments';

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

const truncateEntry = (
  value: string,
  maxChars: number = PiConversationContextLimit.EntryChars,
): string => {
  const normalized = value.trim();
  if (normalized.length <= maxChars) return normalized;
  const suffix = '\n[truncated]';
  return `${normalized.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`;
};

const formatHistoryMessage = (
  message: CoworkMessage,
  ocrCommandFor?: (imagePath: string) => string,
): string | null => {
  if (message.type === 'assistant') {
    if (message.metadata?.isThinking) return null;
    const content = truncateEntry(message.content);
    return content ? `Assistant: ${content}` : null;
  }
  if (message.type === 'user') {
    const content = truncateEntry(message.content);
    const attachments = formatConversationAttachments(message, ocrCommandFor);
    const entry = [attachments, content].filter(Boolean).join('\n');
    return entry ? `User: ${entry}` : null;
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
  if (message.type === 'system' && message.metadata?.interruption) {
    return 'Application: The preceding execution was interrupted. Do not resume it unless the current user request explicitly asks to continue or retry.';
  }
  return null;
};

const resolveHistoryBudget = (maxChars?: number): { totalChars: number; entryBudget: number } => {
  const totalChars = Math.min(
    PiConversationContextLimit.TotalChars,
    Math.max(2_000, Math.floor(maxChars ?? PiConversationContextLimit.TotalChars)),
  );
  // Reserve space for several messages even when one tool observation is huge.
  const entryBudget = Math.min(PiConversationContextLimit.EntryChars, Math.floor(totalChars / 4));
  return { totalChars, entryBudget };
};

const wrapHistoryPrompt = (selectedOldestFirst: string[], currentPrompt: string): string => {
  if (selectedOldestFirst.length === 0) return currentPrompt;
  return [
    '=== PREVIOUS CONVERSATION (context only, do not re-execute) ===',
    selectedOldestFirst.join('\n\n'),
    '=== END PREVIOUS CONVERSATION ===',
    '',
    `User: ${currentPrompt}`,
  ].join('\n');
};

export const buildPiConversationPrompt = (
  messages: CoworkMessage[],
  currentPrompt: string,
  options: { maxChars?: number; ocrCommandFor?: (imagePath: string) => string } = {},
): string => {
  const { totalChars, entryBudget } = resolveHistoryBudget(options.maxChars);
  const entries = messages
    .map(message => formatHistoryMessage(message, options.ocrCommandFor))
    .filter((entry): entry is string => !!entry);
  const selected: string[] = [];
  let selectedChars = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = truncateEntry(entries[index], entryBudget);
    const nextChars = selectedChars + entry.length + 2;
    if (nextChars > totalChars) break;
    selected.unshift(entry);
    selectedChars = nextChars;
  }
  return wrapHistoryPrompt(selected, currentPrompt);
};

/** Default page size for tail-first history reads during session restore. */
const PI_HISTORY_RESTORE_PAGE_SIZE = 100;

/**
 * Same output as buildPiConversationPrompt, but pulls history newest-first in
 * pages and stops as soon as the character budget is filled, so restoring a
 * long session no longer materializes its whole transcript. Selection order
 * and truncation are identical: newest-first greedy fill, stop at the first
 * entry that does not fit.
 *
 * fetchPage(offset, limit) must return messages newest-first.
 */
export const buildPiConversationPromptFromPages = (
  fetchPage: (offset: number, limit: number) => CoworkMessage[],
  currentPrompt: string,
  options: {
    maxChars?: number;
    ocrCommandFor?: (imagePath: string) => string;
    pageSize?: number;
  } = {},
): string => {
  const { totalChars, entryBudget } = resolveHistoryBudget(options.maxChars);
  const pageSize = Math.max(1, Math.floor(options.pageSize ?? PI_HISTORY_RESTORE_PAGE_SIZE));
  const selectedNewestFirst: string[] = [];
  let selectedChars = 0;
  let offset = 0;
  let budgetFilled = false;
  while (!budgetFilled) {
    const page = fetchPage(offset, pageSize);
    if (page.length === 0) break;
    offset += page.length;
    for (const message of page) {
      const entry = formatHistoryMessage(message, options.ocrCommandFor);
      if (!entry) continue;
      const truncated = truncateEntry(entry, entryBudget);
      const nextChars = selectedChars + truncated.length + 2;
      if (nextChars > totalChars) {
        budgetFilled = true;
        break;
      }
      selectedNewestFirst.push(truncated);
      selectedChars = nextChars;
    }
    if (page.length < pageSize) break;
  }
  return wrapHistoryPrompt(selectedNewestFirst.reverse(), currentPrompt);
};

/** The store surface the paged restore path relies on. */
export interface PiHistoryRestoreStore {
  getSessionMessagesDesc(sessionId: string, limit: number, offset: number): CoworkMessage[];
  getSessionMessageStats(sessionId: string): {
    messageCount: number;
    contentBytes: number;
    metadataBytes: number;
  };
  /** Legacy full-read fallback used only when paged reads are unavailable. */
  getSession?(
    sessionId: string,
    messageLimit?: number | null,
  ): { messages: CoworkMessage[] } | null;
}

/**
 * Builds the restore prompt for a session rebuild from paged tail reads.
 * Stores that cannot page fall back to the legacy full read rather than
 * dropping the whole history.
 */
export const restorePiConversationPrompt = (
  store: PiHistoryRestoreStore | null | undefined,
  sessionId: string,
  currentPrompt: string,
  options: { maxChars?: number; ocrCommandFor?: (imagePath: string) => string } = {},
): string => {
  if (!store || typeof store.getSessionMessagesDesc !== 'function') {
    if (typeof store?.getSession !== 'function') return currentPrompt;
    const legacy = store.getSession(sessionId, null);
    return buildPiConversationPrompt(legacy?.messages ?? [], currentPrompt, options);
  }
  return buildPiConversationPromptFromPages(
    (offset, limit) => store.getSessionMessagesDesc(sessionId, limit, offset),
    currentPrompt,
    options,
  );
};

/**
 * Whole-session history totals for restore diagnostics. Never throws and never
 * materializes messages: a broken store must not break a session rebuild.
 */
export const summarizePiHistoryFromStore = (
  store: PiHistoryRestoreStore | null | undefined,
  sessionId: string,
): { messageCount: number; contentBytes: number; metadataBytes: number } => {
  const empty = { messageCount: 0, contentBytes: 0, metadataBytes: 0 };
  if (!store || typeof store.getSessionMessageStats !== 'function') return empty;
  try {
    return store.getSessionMessageStats(sessionId);
  } catch {
    return empty;
  }
};
