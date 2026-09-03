import { Button } from '@shared/components/ui/button';
import { Checkbox } from '@shared/components/ui/checkbox';
import { cn } from '@shared/lib/utils';
import { CalendarDays, ListChecks, Star } from 'lucide-react';
import React from 'react';

import { TodoStatus, type Todo } from '../../../shared/todo';
import { i18nService } from '../../services/i18n';
import { formatTodoDate, isTodoOverdue } from './todoUtils';

interface TodoTaskRowProps {
  todo: Todo;
  language: 'zh' | 'en';
  onOpen: () => void;
  onToggleComplete: (completed: boolean) => void;
  onToggleImportant: () => void;
}

const TodoTaskRow: React.FC<TodoTaskRowProps> = ({
  todo,
  language,
  onOpen,
  onToggleComplete,
  onToggleImportant,
}) => {
  const overdue = isTodoOverdue(todo);
  const completedSteps = todo.steps.filter(step => step.completed).length;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={todo.title}
      onClick={onOpen}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className="group flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-border-subtle bg-card px-3 py-2 text-left transition-colors duration-150 hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 active:translate-y-px"
    >
      <Checkbox
        checked={todo.status === TodoStatus.Completed}
        aria-label={
          todo.status === TodoStatus.Completed
            ? i18nService.t('todoMarkActive')
            : i18nService.t('todoMarkCompleted')
        }
        onClick={event => event.stopPropagation()}
        onCheckedChange={checked => onToggleComplete(checked === true)}
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'truncate text-sm text-foreground',
            todo.status === TodoStatus.Completed && 'text-muted-foreground line-through',
          )}
        >
          {todo.title}
        </p>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {todo.listName ? <span className="truncate">{todo.listName}</span> : null}
          {todo.dueAt !== null ? (
            <span className={cn('inline-flex items-center gap-1', overdue && 'text-destructive')}>
              <CalendarDays className="size-3" aria-hidden="true" />
              {formatTodoDate(todo.dueAt, language)}
            </span>
          ) : null}
          {todo.steps.length > 0 ? (
            <span className="inline-flex items-center gap-1">
              <ListChecks className="size-3" aria-hidden="true" />
              {completedSteps}/{todo.steps.length}
            </span>
          ) : null}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={
          todo.important ? i18nService.t('todoUnmarkImportant') : i18nService.t('todoMarkImportant')
        }
        title={
          todo.important ? i18nService.t('todoUnmarkImportant') : i18nService.t('todoMarkImportant')
        }
        onClick={event => {
          event.stopPropagation();
          onToggleImportant();
        }}
      >
        <Star
          className={cn(
            'size-4',
            todo.important ? 'fill-warning text-warning' : 'text-muted-foreground',
          )}
        />
      </Button>
    </div>
  );
};

export default TodoTaskRow;
