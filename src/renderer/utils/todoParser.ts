import type { QueueTodo } from '@shared/components/ai-elements/queue';

interface TodoSourceMessage {
  id?: string;
  type: string;
  content: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

export interface ExtractedTodoList {
  sourceMessageId: string;
  sourceTimestamp: number;
  todos: QueueTodo[];
}

/** Regex: markdown checklist lines — "- [ ] text" or "- [x] text" */
const CHECKLIST_RE = /^-\s*\[([ xX])\]\s+(.+)$/;

/** Simple string hash for stable content-based ids. */
function hashId(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return `todo-${Math.abs(hash).toString(36)}`;
}

/** Strip trailing parenthetical status info for stem-based dedup.
 *  "Phase 3：逐条撰写（① ✅）" → "Phase 3：逐条撰写"
 *  "Phase 3：① ✅ | ② ✅"      → "Phase 3"                */
function extractStem(title: string): string {
  // Strip trailing Chinese/western bracket groups like （…） or (…)
  let stem = title;
  const stripped = stem.replace(/[（(][^）)]*[）)]\s*$/g, '').trim();
  if (stripped) stem = stripped;
  // Also strip trailing ①②③ status markers like "：① ✅ | ② ✅"
  stem = stem.replace(/[：:]\s*[①-⑫◉○✓✔✕✗✘⨯xX\s\|✅]+$/g, '').trim();
  return stem || title;
}

/**
 * Parse markdown checklist from text content.
 * Extracts "- [ ] item" and "- [x] item" lines as QueueTodo items.
 * Only items at the start of lines are matched; indented items are skipped.
 * Items with the same stem are deduplicated (last occurrence wins, keeping
 * the longer title for display).
 */
export function parseTodosFromText(content: string): QueueTodo[] {
  const lines = content.split('\n');
  const byStem = new Map<string, QueueTodo>();

  for (const line of lines) {
    const match = CHECKLIST_RE.exec(line);
    if (match) {
      const isCompleted = match[1].toLowerCase() === 'x';
      const title = match[2].trim();
      if (!title) continue;
      const stem = extractStem(title);
      const existing = byStem.get(stem);
      // Keep the longer title — status updates tend to add detail
      if (!existing || title.length >= existing.title.length) {
        byStem.set(stem, {
          id: hashId(stem),
          title,
          status: isCompleted ? 'completed' : 'pending',
        });
      }
    }
  }

  return Array.from(byStem.values());
}

/**
 * Extract todos from a session's messages.
 * Walks backwards through all assistant messages (skipping thinking),
 * and returns the first checklist found. This keeps the todo-list visible
 * during later turns when the current answer hasn't output a checklist yet.
 */
export function extractTodosFromMessages(messages: TodoSourceMessage[]): QueueTodo[] {
  return extractLatestTodoListFromMessages(messages)?.todos ?? [];
}

function extractTodoListFromMessage(
  message: TodoSourceMessage,
  fallbackIndex: number,
): ExtractedTodoList | null {
  const todos = parseTodosFromText(message.content);
  if (todos.length === 0) return null;

  return {
    sourceMessageId: message.id ?? `todo-source-${fallbackIndex}`,
    sourceTimestamp: message.timestamp ?? fallbackIndex,
    todos,
  };
}

/** Parses only the newest non-thinking assistant message. */
export function extractTodoListFromLatestAssistantMessage(
  messages: TodoSourceMessage[],
): ExtractedTodoList | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.type !== 'assistant' || message.metadata?.isThinking) continue;
    return extractTodoListFromMessage(message, i);
  }
  return null;
}

/** Returns the newest checklist together with the message that owns it. */
export function extractLatestTodoListFromMessages(
  messages: TodoSourceMessage[],
): ExtractedTodoList | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.type !== 'assistant') continue;
    if (msg.metadata?.isThinking) continue;
    const todoList = extractTodoListFromMessage(msg, i);
    if (todoList) return todoList;
  }
  return null;
}
