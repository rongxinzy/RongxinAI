import type { QueueTodo } from '@shared/components/ai-elements/queue';

/** Regex: markdown checklist lines — "- [ ] text" or "- [x] text" */
const CHECKLIST_RE = /^-\s*\[([ xX])\]\s+(.+)$/;

/**
 * Parse markdown checklist from text content.
 * Extracts "- [ ] item" and "- [x] item" lines as QueueTodo items.
 * Only items at the start of lines are matched; indented items are skipped.
 */
export function parseTodosFromText(content: string): QueueTodo[] {
  const lines = content.split('\n');
  const todos: QueueTodo[] = [];
  let idCounter = 0;

  for (const line of lines) {
    const match = CHECKLIST_RE.exec(line);
    if (match) {
      const isCompleted = match[1].toLowerCase() === 'x';
      const title = match[2].trim();
      if (title) {
        todos.push({
          id: `todo-${idCounter++}`,
          title,
          status: isCompleted ? 'completed' : 'pending',
        });
      }
    }
  }

  return todos;
}

/**
 * Extract todos from a session's messages.
 * Looks at the last assistant message's content and parses checklists.
 * Returns empty array if no todos found or no assistant messages exist.
 */
export function extractTodosFromMessages(
  messages: Array<{ type: string; content: string }>,
): QueueTodo[] {
  // Walk backwards to find the latest assistant message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.type === 'assistant') {
      return parseTodosFromText(msg.content);
    }
  }
  return [];
}
