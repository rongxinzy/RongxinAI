import type { QueueTodo } from '@shared/components/ai-elements/queue';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useProductionPlanTodos } from './useProductionPlanTodos';

export const TODO_COMPLETION_VISIBLE_MS = 3000;
export const TODO_DISMISS_ANIMATION_MS = 200;

interface UseTodoQueueLifecycleOptions {
  isStreaming: boolean;
  sessionId?: string;
}

interface ProductionTodoList {
  sourceMessageId: string;
  sourceTimestamp: number;
  todos: QueueTodo[];
}

interface DisplayedTodoList extends ProductionTodoList {
  sessionId: string;
}

interface AcceptedTodoSource {
  sessionId: string;
  sourceMessageId: string;
  sourceTimestamp: number;
}

export interface TodoQueueLifecycleState {
  isDismissing: boolean;
  todos: QueueTodo[];
}

export function areTodosComplete(todos: QueueTodo[]): boolean {
  return todos.length > 0 && todos.every(todo => todo.status === 'completed');
}

function toDisplayedTodoList(
  sessionId: string | undefined,
  todoList: ProductionTodoList | null,
): DisplayedTodoList | null {
  if (!sessionId || !todoList || areTodosComplete(todoList.todos)) return null;
  return { sessionId, ...todoList };
}

function getTodoStatusKey(todoList: DisplayedTodoList | null): string {
  if (!todoList) return '';
  return `${todoList.sourceMessageId}:${todoList.todos
    .map(todo => `${todo.id}:${todo.status ?? 'pending'}`)
    .join('|')}`;
}

export function useTodoQueueLifecycle({
  isStreaming,
  sessionId,
}: UseTodoQueueLifecycleOptions): TodoQueueLifecycleState {
  const productionPlan = useProductionPlanTodos(sessionId);
  const latestTodoList = useMemo(() => {
    if (!productionPlan || productionPlan.todos.length === 0) return null;
    return {
      sourceMessageId: `production-plan:${productionPlan.runId}`,
      sourceTimestamp: productionPlan.progressVersion,
      todos: productionPlan.todos,
    };
  }, [productionPlan]);
  const [displayedTodoList, setDisplayedTodoList] = useState<DisplayedTodoList | null>(null);
  const displayedTodoListRef = useRef(displayedTodoList);
  displayedTodoListRef.current = displayedTodoList;
  const [isDismissing, setIsDismissing] = useState(false);
  const activeSessionIdRef = useRef(sessionId);
  const restoredSessionIdRef = useRef<string | undefined>(undefined);
  const acceptedSourceRef = useRef<AcceptedTodoSource | null>(null);
  const dismissedSourceIdRef = useRef<string | null>(null);

  useEffect(() => {
    let acceptedSource = acceptedSourceRef.current;
    const sessionChanged = activeSessionIdRef.current !== sessionId;

    if (!sessionId) {
      activeSessionIdRef.current = sessionId;
      restoredSessionIdRef.current = undefined;
      acceptedSourceRef.current = null;
      acceptedSource = null;
      dismissedSourceIdRef.current = null;
      setDisplayedTodoList(null);
      setIsDismissing(false);
      return;
    }

    if (sessionChanged) {
      activeSessionIdRef.current = sessionId;
      restoredSessionIdRef.current = undefined;
      acceptedSourceRef.current = null;
      acceptedSource = null;
      dismissedSourceIdRef.current = null;
      setDisplayedTodoList(null);
      setIsDismissing(false);
    }

    if (restoredSessionIdRef.current !== sessionId) {
      if (productionPlan === undefined) return;

      const restoredTodoList = latestTodoList;
      restoredSessionIdRef.current = sessionId;
      acceptedSourceRef.current = restoredTodoList
        ? {
            sessionId,
            sourceMessageId: restoredTodoList.sourceMessageId,
            sourceTimestamp: restoredTodoList.sourceTimestamp,
          }
        : null;
      dismissedSourceIdRef.current =
        restoredTodoList && areTodosComplete(restoredTodoList.todos)
          ? restoredTodoList.sourceMessageId
          : null;
      setDisplayedTodoList(toDisplayedTodoList(sessionId, restoredTodoList));
      setIsDismissing(false);
      return;
    }

    if (!latestTodoList) {
      if (productionPlan !== undefined) {
        setDisplayedTodoList(null);
        setIsDismissing(false);
      }
      return;
    }
    if (acceptedSource && latestTodoList.sourceTimestamp < acceptedSource.sourceTimestamp) {
      return;
    }

    const complete = areTodosComplete(latestTodoList.todos);
    if (complete && dismissedSourceIdRef.current === latestTodoList.sourceMessageId) {
      return;
    }

    acceptedSourceRef.current = {
      sessionId,
      sourceMessageId: latestTodoList.sourceMessageId,
      sourceTimestamp: latestTodoList.sourceTimestamp,
    };
    if (!complete) dismissedSourceIdRef.current = null;
    setDisplayedTodoList({ sessionId, ...latestTodoList });
    setIsDismissing(false);
  }, [latestTodoList, productionPlan, sessionId]);

  const todoStatusKey = getTodoStatusKey(displayedTodoList);
  const displayedSourceMessageId = displayedTodoList?.sourceMessageId;
  const displayedTodosComplete = areTodosComplete(displayedTodoList?.todos ?? []);

  useEffect(() => {
    const currentTodoList = displayedTodoListRef.current;
    if (
      !currentTodoList ||
      currentTodoList.sessionId !== sessionId ||
      !displayedTodosComplete ||
      isStreaming ||
      isDismissing
    ) {
      return;
    }

    const completionTimer = window.setTimeout(() => {
      setIsDismissing(true);
    }, TODO_COMPLETION_VISIBLE_MS);
    return () => window.clearTimeout(completionTimer);
  }, [displayedTodosComplete, isDismissing, isStreaming, sessionId, todoStatusKey]);

  useEffect(() => {
    const currentTodoList = displayedTodoListRef.current;
    if (!currentTodoList || !isDismissing) return;

    const sourceMessageId = currentTodoList.sourceMessageId;
    const dismissTimer = window.setTimeout(() => {
      dismissedSourceIdRef.current = sourceMessageId;
      setDisplayedTodoList(current =>
        current?.sourceMessageId === sourceMessageId ? null : current,
      );
      setIsDismissing(false);
    }, TODO_DISMISS_ANIMATION_MS);
    return () => window.clearTimeout(dismissTimer);
  }, [displayedSourceMessageId, isDismissing]);

  if (!displayedTodoList || displayedTodoList.sessionId !== sessionId) {
    return { isDismissing: false, todos: [] };
  }

  return {
    isDismissing,
    todos: displayedTodoList.todos,
  };
}
