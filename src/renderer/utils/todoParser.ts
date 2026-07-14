import type { QueueTodo } from '@shared/components/ai-elements/queue';

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

/**
 * Parse markdown checklist from text content.
 * Extracts "- [ ] item" and "- [x] item" lines as QueueTodo items.
 * Only items at the start of lines are matched; indented items are skipped.
 * Duplicate titles are deduplicated (last occurrence wins for status).
 */
export function parseTodosFromText(content: string): QueueTodo[] {
  const lines = content.split('\n');
  const seen = new Map<string, QueueTodo>();

  for (const line of lines) {
    const match = CHECKLIST_RE.exec(line);
    if (match) {
      const isCompleted = match[1].toLowerCase() === 'x';
      const title = match[2].trim();
      if (title) {
        seen.set(title, {
          id: hashId(title),
          title,
          status: isCompleted ? 'completed' : 'pending',
        });
      }
    }
  }

  return Array.from(seen.values());
}

/**
 * Extract todos from a session's messages.
 * Walks backwards to find the latest assistant ANSWER message,
 * skipping thinking messages (metadata.isThinking) to avoid showing
 * internal planning as user-facing todos.
 */
export function extractTodosFromMessages(
  messages: Array<{ type: string; content: string; metadata?: Record<string, unknown> }>,
): QueueTodo[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.type !== 'assistant') continue;
    if (msg.metadata?.isThinking) continue;
    return parseTodosFromText(msg.content);
  }
  return [];
}
