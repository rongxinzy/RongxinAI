import {
  Queue,
  QueueItem,
  QueueItemContent,
  QueueItemIndicator,
  QueueSection,
  QueueSectionContent,
} from '@shared/components/ai-elements/queue';
import { useMemo } from 'react';

import { i18nService } from '../../services/i18n';
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
    <Queue className="mx-auto max-h-[150px] w-[95%] rounded-b-none border-input border-b-0 overflow-y-auto group
      [&::-webkit-scrollbar]:w-1
      [&::-webkit-scrollbar-thumb]:rounded-full
      [&::-webkit-scrollbar-thumb]:bg-transparent
      [&::-webkit-scrollbar-track]:bg-transparent
      group-hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/20
    ">
      <QueueSection>
        <QueueSectionContent>
          <div className="flex items-center gap-2 px-1 py-0.5 text-xs text-muted-foreground">
            <span>
              {completed}/{total} {i18nService.t('coworkTodoCompleted')}
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
