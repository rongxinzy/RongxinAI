import {
  Queue,
  QueueItem,
  QueueItemContent,
  QueueItemIndicator,
  QueueSection,
  QueueSectionContent,
} from '@shared/components/ai-elements/queue';
import { useMemo } from 'react';

import { extractTodosFromMessages } from '../../utils/todoParser';

interface TodoQueueProps {
  messages: Array<{ type: string; content: string }>;
}

/**
 * Renders a todo list parsed from the latest assistant message's markdown
 * checklist (`- [ ]` / `- [x]`). Placed above the PromptInput area, matching
 * the ai-elements official Queue + PromptInput layout.
 */
export function TodoQueue({ messages }: TodoQueueProps) {
  const todos = useMemo(() => extractTodosFromMessages(messages), [messages]);

  if (todos.length === 0) return null;

  const completed = todos.filter((t) => t.status === 'completed').length;
  const total = todos.length;

  return (
    <Queue className="w-full max-h-[150px] overflow-y-auto rounded-b-none border-input border-b-0">
      <QueueSection>
        <QueueSectionContent>
          <div className="flex items-center gap-2 px-1 py-0.5 text-xs text-muted-foreground">
            <span>
              {completed}/{total} completed
            </span>
          </div>
          {todos.map((todo) => (
            <QueueItem key={todo.id}>
              <div className="flex items-center gap-2">
                <QueueItemIndicator completed={todo.status === 'completed'} />
                <QueueItemContent completed={todo.status === 'completed'}>
                  {todo.title}
                </QueueItemContent>
              </div>
            </QueueItem>
          ))}
        </QueueSectionContent>
      </QueueSection>
    </Queue>
  );
}
