import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { Textarea } from '@shared/components/ui/textarea';
import { cn } from '@shared/lib/utils';
import { CalendarDays, Check, ListChecks, Plus, Star, Trash2 } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

import { TodoStatus, type Todo, type TodoList } from '../../../shared/todo';
import { i18nService } from '../../services/i18n';
import { todoService } from '../../services/todo';
import {
  fromDateInputValue,
  fromDateTimeInputValue,
  formatTodoDateTime,
  toDateInputValue,
  toDateTimeInputValue,
  todayDateKey,
} from './todoUtils';

interface TodoTaskDetailProps {
  todo: Todo;
  lists: TodoList[];
  language: 'zh' | 'en';
  onUpdated: () => Promise<void>;
  onError: () => void;
  onDelete: () => void;
}

const NO_LIST_VALUE = 'none';

const TodoTaskDetail: React.FC<TodoTaskDetailProps> = ({
  todo,
  lists,
  language,
  onUpdated,
  onError,
  onDelete,
}) => {
  const [title, setTitle] = useState(todo.title);
  const [note, setNote] = useState(todo.note);
  const [dueDate, setDueDate] = useState(toDateInputValue(todo.dueAt));
  const [remindAt, setRemindAt] = useState(toDateTimeInputValue(todo.remindAt));
  const [listId, setListId] = useState(todo.listId ?? NO_LIST_VALUE);
  const [stepDraft, setStepDraft] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  // Background refreshes (onChanged -> loadData) replace the todo object; only
  // resync fields the user is not editing, otherwise in-progress edits would
  // be silently reverted by every save of another field.
  const dirtyFieldsRef = useRef(new Set<string>());
  const lastTodoIdRef = useRef(todo.id);

  useEffect(() => {
    if (lastTodoIdRef.current !== todo.id) {
      lastTodoIdRef.current = todo.id;
      dirtyFieldsRef.current.clear();
      setTitle(todo.title);
      setNote(todo.note);
      setDueDate(toDateInputValue(todo.dueAt));
      setRemindAt(toDateTimeInputValue(todo.remindAt));
      setListId(todo.listId ?? NO_LIST_VALUE);
      return;
    }
    const dirty = dirtyFieldsRef.current;
    setTitle(current => (dirty.has('title') ? current : todo.title));
    setNote(current => (dirty.has('note') ? current : todo.note));
    setDueDate(current => (dirty.has('dueDate') ? current : toDateInputValue(todo.dueAt)));
    setRemindAt(current => (dirty.has('remindAt') ? current : toDateTimeInputValue(todo.remindAt)));
    setListId(current => (dirty.has('listId') ? current : todo.listId ?? NO_LIST_VALUE));
  }, [todo]);

  const markDirty = (field: string): void => {
    dirtyFieldsRef.current.add(field);
  };

  const clearDirty = (...fields: string[]): void => {
    for (const field of fields) dirtyFieldsRef.current.delete(field);
  };

  const saveDetails = async (): Promise<void> => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    setIsSaving(true);
    try {
      const result = await todoService.update(todo.id, {
        title: trimmedTitle,
        note,
        dueAt: fromDateInputValue(dueDate),
        remindAt: fromDateTimeInputValue(remindAt),
        listId: listId === NO_LIST_VALUE ? null : listId,
      });
      if (result.success) {
        clearDirty('title', 'note', 'dueDate', 'remindAt', 'listId');
        await onUpdated();
      } else {
        onError();
      }
    } finally {
      setIsSaving(false);
    }
  };

  const updateStatus = async (status: TodoStatus): Promise<void> => {
    const result = await todoService.update(todo.id, { status });
    if (result.success) await onUpdated();
    else onError();
  };

  const toggleMyDay = async (): Promise<void> => {
    const result = await todoService.update(todo.id, {
      myDayDate: todo.myDayDate === todayDateKey() ? null : todayDateKey(),
    });
    if (result.success) await onUpdated();
    else onError();
  };

  const toggleImportant = async (): Promise<void> => {
    const result = await todoService.update(todo.id, { important: !todo.important });
    if (result.success) await onUpdated();
    else onError();
  };

  const addStep = async (): Promise<void> => {
    const trimmedStep = stepDraft.trim();
    if (!trimmedStep) return;
    const result = await todoService.createStep({ todoId: todo.id, title: trimmedStep });
    if (result.success) {
      setStepDraft('');
      await onUpdated();
    } else {
      onError();
    }
  };

  const inMyDay = todo.myDayDate === todayDateKey();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6">
      <div className="space-y-4">
        <Input
          value={title}
          onChange={event => {
            markDirty('title');
            setTitle(event.target.value);
          }}
          onBlur={() => void saveDetails()}
          aria-label={i18nService.t('todoTitleLabel')}
          className="theme-page-todo-task-detail-input-1"
        />

        <div className="flex flex-wrap gap-2 border-b border-border-subtle pb-4">
          <Button type="button" variant={inMyDay ? 'secondary' : 'outline'} onClick={toggleMyDay}>
            <CalendarDays />
            {inMyDay
              ? i18nService.t('todoRemoveFromMyDay')
              : i18nService.t('todoAddToMyDay')}
          </Button>
          <Button
            type="button"
            variant={todo.important ? 'secondary' : 'outline'}
            onClick={toggleImportant}
          >
            <Star className={cn(todo.important && 'fill-warning text-warning')} />
            {todo.important
              ? i18nService.t('todoUnmarkImportant')
              : i18nService.t('todoMarkImportant')}
          </Button>
        </div>

        <div className="grid gap-3 border-b border-border-subtle pb-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm text-foreground">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <CalendarDays className="size-4" />
              {i18nService.t('todoDueDate')}
            </span>
            <Input
              type="date"
              value={dueDate}
              onChange={event => {
                markDirty('dueDate');
                setDueDate(event.target.value);
                void todoService
                  .update(todo.id, { dueAt: fromDateInputValue(event.target.value) })
                  .then(result => {
                    if (result.success) {
                      clearDirty('dueDate');
                      return onUpdated();
                    }
                    onError();
                  });
              }}
            />
          </label>
          <label className="space-y-1.5 text-sm text-foreground">
            <span className="text-muted-foreground">{i18nService.t('todoReminder')}</span>
            <Input
              type="datetime-local"
              value={remindAt}
              onChange={event => {
                markDirty('remindAt');
                setRemindAt(event.target.value);
                void todoService
                  .update(todo.id, { remindAt: fromDateTimeInputValue(event.target.value) })
                  .then(result => {
                    if (result.success) {
                      clearDirty('remindAt');
                      return onUpdated();
                    }
                    onError();
                  });
              }}
            />
          </label>
        </div>

        <label className="block space-y-1.5 border-b border-border-subtle pb-4 text-sm text-foreground">
          <span className="text-muted-foreground">{i18nService.t('todoList')}</span>
          <Select
            value={listId}
            onValueChange={value => {
              const nextListId = value ?? NO_LIST_VALUE;
              markDirty('listId');
              setListId(nextListId);
              void todoService
                .update(todo.id, { listId: nextListId === NO_LIST_VALUE ? null : nextListId })
                .then(result => {
                  if (result.success) {
                    clearDirty('listId');
                    return onUpdated();
                  }
                  onError();
                });
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {listId === NO_LIST_VALUE
                  ? i18nService.t('todoNoList')
                  : (lists.find(list => list.id === listId)?.name ?? i18nService.t('todoNoList'))}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_LIST_VALUE}>{i18nService.t('todoNoList')}</SelectItem>
              {lists.map(list => (
                <SelectItem key={list.id} value={list.id}>
                  {list.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="block space-y-1.5 text-sm text-foreground">
          <span className="text-muted-foreground">{i18nService.t('todoNote')}</span>
          <Textarea
            value={note}
            onChange={event => {
              markDirty('note');
              setNote(event.target.value);
            }}
            onBlur={() => void saveDetails()}
            placeholder={i18nService.t('todoNotePlaceholder')}
            rows={5}
          />
        </label>

        <section className="space-y-2 border-b border-border-subtle pb-4">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <ListChecks className="size-4" />
            {i18nService.t('todoSteps')}
          </div>
          {todo.steps.map(step => (
            <div
              key={step.id}
              className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-muted"
            >
              <Button
                type="button"
                variant={step.completed ? 'secondary' : 'outline'}
                size="icon-xs"
                aria-label={
                  step.completed
                    ? i18nService.t('todoMarkActive')
                    : i18nService.t('todoMarkCompleted')
                }
                onClick={() =>
                  void todoService
                    .updateStep({ id: step.id, completed: !step.completed })
                    .then(result => {
                      if (result.success) return onUpdated();
                      onError();
                    })
                }
              >
                {step.completed ? <Check /> : null}
              </Button>
              <span
                className={cn(
                  'min-w-0 flex-1 text-sm',
                  step.completed && 'text-muted-foreground line-through',
                )}
              >
                {step.title}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={i18nService.t('todoDeleteStep')}
                title={i18nService.t('todoDeleteStep')}
                onClick={() =>
                  void todoService.deleteStep(step.id).then(result => {
                    if (result.success) return onUpdated();
                    onError();
                  })
                }
              >
                <Trash2 className="text-muted-foreground" />
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Input
              value={stepDraft}
              onChange={event => setStepDraft(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void addStep();
                }
              }}
              placeholder={i18nService.t('todoStepPlaceholder')}
            />
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => void addStep()}
              aria-label={i18nService.t('todoAddStep')}
            >
              <Plus />
            </Button>
          </div>
        </section>

        <div className="flex items-center justify-between border-t border-border-subtle pt-4">
          <span className="text-xs text-muted-foreground">
            {i18nService.t('todoCreatedAt')}: {formatTodoDateTime(todo.createdAt, language)}
          </span>
          <Button type="button" variant="ghost" onClick={onDelete}>
            <Trash2 />
            {i18nService.t('todoDelete')}
          </Button>
        </div>

        <div className="flex justify-end gap-2">
          {todo.status === TodoStatus.Active ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void updateStatus(TodoStatus.Completed)}
            >
              <Check />
              {i18nService.t('todoMarkCompleted')}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => void updateStatus(TodoStatus.Active)}
            >
              {i18nService.t('todoMarkActive')}
            </Button>
          )}
          <Button type="button" onClick={() => void saveDetails()} disabled={isSaving}>
            {isSaving ? i18nService.t('saving') : i18nService.t('save')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default TodoTaskDetail;
