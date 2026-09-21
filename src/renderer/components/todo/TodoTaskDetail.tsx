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

import { TodoStatus, type Todo, type TodoList, type TodoUpdateInput } from '../../../shared/todo';
import { i18nService } from '../../services/i18n';
import { todoService } from '../../services/todo';
import {
  fromDateInputValue,
  fromDateTimeInputValue,
  formatTodoDateTime,
  toDateInputMinValue,
  toDateInputValue,
  toDateTimeInputMaxValue,
  toDateTimeInputMinValue,
  toDateTimeInputValue,
  todayDateKey,
  validateTodoSchedule,
} from './todoUtils';

interface TodoTaskDetailProps {
  todo: Todo;
  lists: TodoList[];
  language: 'zh' | 'en';
  onUpdated: () => Promise<void>;
  onError: () => void;
  onDelete: () => void;
  onSaved: () => void;
}

const NO_LIST_VALUE = 'none';

const openInputPicker = (input: HTMLInputElement): void => {
  if (typeof input.showPicker !== 'function') return;
  try {
    input.showPicker();
  } catch {
    // 日历已经打开时再点会抛错，忽略即可
  }
};

const TodoTaskDetail: React.FC<TodoTaskDetailProps> = ({
  todo,
  lists,
  language,
  onUpdated,
  onError,
  onDelete,
  onSaved,
}) => {
  const [title, setTitle] = useState(todo.title);
  const [note, setNote] = useState(todo.note);
  const [dueDate, setDueDate] = useState(toDateInputValue(todo.dueAt));
  const [remindAt, setRemindAt] = useState(toDateTimeInputValue(todo.remindAt));
  const [listId, setListId] = useState(todo.listId ?? NO_LIST_VALUE);
  const [stepDraft, setStepDraft] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [dueError, setDueError] = useState('');
  const [remindError, setRemindError] = useState('');

  useEffect(() => {
    setTitle(todo.title);
    setNote(todo.note);
    setDueDate(toDateInputValue(todo.dueAt));
    setRemindAt(toDateTimeInputValue(todo.remindAt));
    setListId(todo.listId ?? NO_LIST_VALUE);
    setDueError('');
    setRemindError('');
  }, [todo]);

  const titleEmpty = !title.trim();
  const stepEmpty = !stepDraft.trim();
  const dueMin = toDateInputMinValue();
  const remindMin = toDateTimeInputMinValue();
  const remindMax = toDateTimeInputMaxValue(fromDateInputValue(dueDate));

  const showError = (message?: string): void => {
    window.dispatchEvent(
      new CustomEvent('app:showToast', {
        detail: message ?? i18nService.t('todoSaveError'),
      }),
    );
  };

  const saveDetails = async (closeOnSuccess = false): Promise<void> => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      showError(i18nService.t('todoTitleRequired'));
      return;
    }
    const nextDueAt = fromDateInputValue(dueDate);
    const nextRemindAt = fromDateTimeInputValue(remindAt);
    const scheduleKey = validateTodoSchedule(nextDueAt, nextRemindAt);
    if (scheduleKey) {
      const message = i18nService.t(scheduleKey);
      if (scheduleKey === 'todoDueDateMustBeFuture') {
        setDueError(message);
        setRemindError('');
      } else {
        setDueError('');
        setRemindError(message);
      }
      return;
    }
    setDueError('');
    setRemindError('');
    setIsSaving(true);
    try {
      const result = await todoService.update(todo.id, {
        title: trimmedTitle,
        note,
        dueAt: nextDueAt,
        remindAt: nextRemindAt,
        listId: listId === NO_LIST_VALUE ? null : listId,
      });
      if (result.success) {
        await onUpdated();
        if (closeOnSuccess) onSaved();
      } else showError();
    } finally {
      setIsSaving(false);
    }
  };

  const persistScheduleField = async (
    patch: { dueAt?: number | null; remindAt?: number | null },
    nextDue: number | null,
    nextRemind: number | null,
  ): Promise<void> => {
    const scheduleKey = validateTodoSchedule(nextDue, nextRemind);
    if (scheduleKey) {
      const message = i18nService.t(scheduleKey);
      if (scheduleKey === 'todoDueDateMustBeFuture') {
        setDueError(message);
        setRemindError('');
      } else {
        setDueError('');
        setRemindError(message);
      }
      return;
    }
    setDueError('');
    setRemindError('');
    const result = await todoService.update(todo.id, patch);
    if (result.success) await onUpdated();
    else showError();
  };

  const updateStatus = async (status: TodoStatus): Promise<void> => {
    const result = await todoService.update(todo.id, { status });
    if (result.success) await onUpdated();
    else showError();
  };

  const toggleMyDay = async (): Promise<void> => {
    const result = await todoService.update(todo.id, {
      myDayDate: todo.myDayDate === todayDateKey() ? null : todayDateKey(),
    });
    if (result.success) await onUpdated();
    else showError();
  };

  const toggleImportant = async (): Promise<void> => {
    const result = await todoService.update(todo.id, { important: !todo.important });
    if (result.success) await onUpdated();
    else showError();
  };

  const addStep = async (): Promise<void> => {
    const trimmedStep = stepDraft.trim();
    if (!trimmedStep) return;
    const result = await todoService.createStep({ todoId: todo.id, title: trimmedStep });
    if (result.success) {
      setStepDraft('');
      await onUpdated();
    } else showError();
  };

  const inMyDay = todo.myDayDate === todayDateKey();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-4">
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="space-y-1.5">
          <Input
            value={title}
            onChange={event => setTitle(event.target.value)}
            onBlur={() => {
              if (!titleEmpty) void saveDetails();
            }}
            aria-label={i18nService.t('todoTitleLabel')}
            aria-invalid={titleEmpty || undefined}
            className="theme-page-todo-task-detail-input-1"
          />
          {titleEmpty ? (
            <p className="text-xs text-muted-foreground">{i18nService.t('todoTitleRequired')}</p>
          ) : null}
        </div>

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

        <div className="grid items-start gap-3 border-b border-border-subtle pb-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 text-sm text-foreground">
            <label
              htmlFor="todo-due-date"
              className="flex h-5 cursor-pointer items-center gap-1.5 text-muted-foreground"
            >
              <CalendarDays className="size-4" />
              {i18nService.t('todoDueDate')}
            </label>
            <Input
              id="todo-due-date"
              type="date"
              name="todoDueDate"
              value={dueDate}
              min={dueMin}
              className="w-full cursor-pointer"
              onClick={event => openInputPicker(event.currentTarget)}
              onChange={event => {
                // 提醒弹层有时会误触发截止日期的 change，只接受当前焦点在本输入框上的修改
                if (document.activeElement !== event.currentTarget) return;
                const value = event.target.value;
                setDueDate(value);
                void persistScheduleField(
                  { dueAt: fromDateInputValue(value) },
                  fromDateInputValue(value),
                  fromDateTimeInputValue(remindAt),
                );
              }}
            />
            {dueError ? <p className="text-xs text-destructive">{dueError}</p> : null}
          </div>
          <div className="flex flex-col gap-1.5 text-sm text-foreground">
            <label
              htmlFor="todo-remind-at"
              className="flex h-5 cursor-pointer items-center text-muted-foreground"
            >
              {i18nService.t('todoReminder')}
            </label>
            <Input
              id="todo-remind-at"
              type="datetime-local"
              name="todoRemindAt"
              value={remindAt}
              min={remindMin}
              max={remindMax}
              className="w-full cursor-pointer"
              onClick={event => openInputPicker(event.currentTarget)}
              onChange={event => {
                if (document.activeElement !== event.currentTarget) return;
                const value = event.target.value;
                setRemindAt(value);
                void persistScheduleField(
                  { remindAt: fromDateTimeInputValue(value) },
                  fromDateInputValue(dueDate),
                  fromDateTimeInputValue(value),
                );
              }}
            />
            {remindError ? <p className="text-xs text-destructive">{remindError}</p> : null}
          </div>
        </div>

        <label className="block space-y-1.5 border-b border-border-subtle pb-4 text-sm text-foreground">
          <span className="text-muted-foreground">{i18nService.t('todoList')}</span>
          <Select
            value={listId}
            onValueChange={value => {
              const nextListId = value ?? NO_LIST_VALUE;
              markDirty('listId');
              setListId(nextListId);
              const request = ++saveRequestCounterRef.current;
              fieldSaveSequenceRef.current.set('listId', request);
              void todoService
                .update(todo.id, { listId: nextListId === NO_LIST_VALUE ? null : nextListId })
                .then(result => {
                  if (result.success) return onUpdated();
                  showError();
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

        <label htmlFor="todo-note" className="block space-y-1.5 text-sm text-foreground">
          <span className="text-muted-foreground">{i18nService.t('todoNote')}</span>
          <Textarea
            id="todo-note"
            value={note}
            onChange={event => setNote(event.target.value)}
            onBlur={() => {
              if (!titleEmpty) void saveDetails();
            }}
            placeholder={i18nService.t('todoNotePlaceholder')}
            rows={5}
            className="field-sizing-fixed max-h-40 min-h-[7.5rem] overflow-y-auto"
          />
        </label>

        <section className="space-y-2">
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
                      showError();
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
                    showError();
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
            <span className={cn(stepEmpty && 'cursor-not-allowed')}>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                disabled={stepEmpty}
                onClick={() => void addStep()}
                aria-label={i18nService.t('todoAddStep')}
                title={stepEmpty ? i18nService.t('todoStepPlaceholder') : i18nService.t('todoAddStep')}
              >
                <Plus />
              </Button>
            </span>
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
          <Button
            type="button"
            onClick={() => void saveDetails(true)}
            disabled={isSaving || titleEmpty}
            title={titleEmpty ? i18nService.t('todoTitleRequired') : undefined}
          >
            {isSaving ? i18nService.t('saving') : i18nService.t('save')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default TodoTaskDetail;
