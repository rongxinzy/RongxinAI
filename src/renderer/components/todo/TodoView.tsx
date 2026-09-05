import { Button } from '@shared/components/ui/button';
import { DestructiveConfirmDialog } from '@shared/components/ui/destructive-confirm-dialog';
import { Input } from '@shared/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@shared/components/ui/sheet';
import { ListTodo, Menu, Plus, Search } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {
  TodoStatus,
  TodoView as TodoViewFilter,
  type Todo,
  type TodoList,
} from '../../../shared/todo';
import { i18nService } from '../../services/i18n';
import { todoService } from '../../services/todo';
import PageHeader from '../PageHeader';
import TodoNavigationPanel, { todoNavigationItems } from './TodoNavigationPanel';
import TodoTaskDetail from './TodoTaskDetail';
import TodoTaskRow from './TodoTaskRow';
import {
  buildTodoCreateInput,
  countTodosByView,
  formatTodoDate,
  parseTodoInput,
  todayDateKey,
} from './todoUtils';

interface TodoViewProps {
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  updateBadge?: React.ReactNode;
}

const viewDescriptionKeys: Record<TodoViewFilter, string> = {
  [TodoViewFilter.MyDay]: 'todoMyDayDescription',
  [TodoViewFilter.Important]: 'todoImportantDescription',
  [TodoViewFilter.Planned]: 'todoPlannedDescription',
  [TodoViewFilter.All]: 'todoAllDescription',
  [TodoViewFilter.Completed]: 'todoCompletedDescription',
};

const TodoView: React.FC<TodoViewProps> = ({
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
  updateBadge,
}) => {
  const [language, setLanguage] = useState(i18nService.getLanguage());
  const [activeView, setActiveView] = useState<TodoViewFilter>(TodoViewFilter.MyDay);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [allTodos, setAllTodos] = useState<Todo[]>([]);
  const [completedCount, setCompletedCount] = useState(0);
  const [suggestionTodos, setSuggestionTodos] = useState<Todo[]>([]);
  const [lists, setLists] = useState<TodoList[]>([]);
  const [query, setQuery] = useState('');
  const [newTodoTitle, setNewTodoTitle] = useState('');
  const [newListName, setNewListName] = useState('');
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null);
  const [deleteTodo, setDeleteTodo] = useState<Todo | null>(null);
  const [deleteList, setDeleteList] = useState<TodoList | null>(null);
  const [isMobileNavigationOpen, setIsMobileNavigationOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const selectedTodo = useMemo(
    () => todos.find(todo => todo.id === selectedTodoId) ?? null,
    [selectedTodoId, todos],
  );

  const activeList = useMemo(
    () => lists.find(list => list.id === activeListId) ?? null,
    [activeListId, lists],
  );

  const activeCounts = useMemo<Record<TodoViewFilter, number>>(() => {
    return countTodosByView(allTodos, completedCount, todayDateKey());
  }, [allTodos, completedCount]);

  const listCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const todo of allTodos) {
      if (todo.listId) counts.set(todo.listId, (counts.get(todo.listId) ?? 0) + 1);
    }
    return counts;
  }, [allTodos]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadFailed(false);
    const listInput = {
      view: activeView,
      listId: activeListId,
      query,
      referenceDate: todayDateKey(),
    };
    const allInput = {
      view: TodoViewFilter.All,
      query: '',
      referenceDate: todayDateKey(),
    };
    const completedInput = {
      view: TodoViewFilter.Completed,
      query: '',
      referenceDate: todayDateKey(),
    };
    const [todoResult, listsResult, allResult, completedResult] = await Promise.all([
      todoService.list(listInput),
      todoService.listLists(),
      todoService.list(allInput),
      todoService.list(completedInput),
    ]);
    const succeeded =
      todoResult.success && listsResult.success && allResult.success && completedResult.success;
    if (!succeeded) {
      setLoadFailed(true);
      setIsLoading(false);
      return;
    }
    setTodos(todoResult.todos ?? []);
    setLists(listsResult.lists ?? []);
    const allTodoItems = allResult.todos ?? [];
    setAllTodos(allTodoItems);
    setCompletedCount(completedResult.todos?.length ?? 0);
    setSuggestionTodos(
      allTodoItems
        .filter(todo => todo.myDayDate !== todayDateKey())
        .filter(todo => todo.important || todo.dueAt !== null)
        .slice(0, 3),
    );
    setIsLoading(false);
  }, [activeListId, activeView, query]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const unsubscribe = window.electron.todo.onChanged(() => {
      void loadData();
    });
    return unsubscribe;
  }, [loadData]);

  useEffect(() => i18nService.subscribe(() => setLanguage(i18nService.getLanguage())), []);

  const showError = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent('app:showToast', { detail: i18nService.t('todoSaveError') }),
    );
  }, []);

  const handleCreateTodo = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const title = newTodoTitle.trim();
    if (!title) return;
    const parsed = parseTodoInput(title);
    const result = await todoService.create(
      buildTodoCreateInput(title, parsed, activeView, activeListId, todayDateKey()),
    );
    if (!result.success) {
      showError();
      return;
    }
    setNewTodoTitle('');
    await loadData();
  };

  const handleCreateList = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const name = newListName.trim();
    if (!name) return;
    const result = await todoService.createList({ name });
    if (!result.success) {
      showError();
      return;
    }
    setNewListName('');
    await loadData();
  };

  const handleToggleTodo = async (todo: Todo, completed: boolean): Promise<void> => {
    const result = await todoService.update(todo.id, {
      status: completed ? TodoStatus.Completed : TodoStatus.Active,
    });
    if (!result.success) showError();
  };

  const handleToggleImportant = async (todo: Todo): Promise<void> => {
    const result = await todoService.update(todo.id, { important: !todo.important });
    if (!result.success) showError();
  };

  const handleConfirmDeleteTodo = async (): Promise<void> => {
    if (!deleteTodo) return;
    const todoId = deleteTodo.id;
    setDeleteTodo(null);
    setSelectedTodoId(null);
    const result = await todoService.delete(todoId);
    if (!result.success) showError();
  };

  const handleConfirmDeleteList = async (): Promise<void> => {
    if (!deleteList) return;
    const listId = deleteList.id;
    setDeleteList(null);
    if (activeListId === listId) {
      setActiveListId(null);
      setActiveView(TodoViewFilter.All);
    }
    const result = await todoService.deleteList(listId);
    if (!result.success) showError();
  };

  const handleSelectView = (view: TodoViewFilter): void => {
    setActiveView(view);
    setActiveListId(null);
    setIsMobileNavigationOpen(false);
  };

  const handleSelectList = (listId: string): void => {
    setActiveListId(listId);
    setActiveView(TodoViewFilter.All);
    setIsMobileNavigationOpen(false);
  };

  const focusNewTodoInput = (): void => {
    setIsMobileNavigationOpen(false);
    window.setTimeout(() => document.getElementById('todo-new-input')?.focus(), 0);
  };

  const sectionTitle =
    activeList?.name ??
    i18nService.t(
      todoNavigationItems.find(item => item.value === activeView)?.labelKey ?? 'todoAll',
    );
  const sectionDescription = activeList
    ? i18nService.t('todoListDescription')
    : activeView === TodoViewFilter.MyDay
      ? formatTodoDate(Date.now(), language)
      : i18nService.t(viewDescriptionKeys[activeView]);
  const activeCount = activeListId ? (listCounts.get(activeListId) ?? 0) : activeCounts[activeView];
  const parsedNewTodo = parseTodoInput(newTodoTitle);

  return (
    <div data-page-canvas className="flex h-full min-h-0 flex-col bg-background">
      <PageHeader
        title={i18nService.t('todoTitle')}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        onNewChat={onNewChat}
        updateBadge={updateBadge}
      />
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-56 shrink-0 flex-col border-r border-border-subtle bg-muted p-4 md:flex">
          <TodoNavigationPanel
            activeView={activeView}
            activeListId={activeListId}
            activeCounts={activeCounts}
            lists={lists}
            listCounts={listCounts}
            newListName={newListName}
            newListInputId="todo-new-list-input"
            onNewListNameChange={setNewListName}
            onCreateList={handleCreateList}
            onFocusNewTask={focusNewTodoInput}
            onSelectView={handleSelectView}
            onSelectList={handleSelectList}
            onDeleteList={setDeleteList}
          />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col px-4 sm:px-8">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsMobileNavigationOpen(true)}
              className="mt-4 w-full justify-start gap-2 md:hidden"
              aria-label={i18nService.t('todoOpenNavigation')}
            >
              <Menu />
              <span className="truncate">{sectionTitle}</span>
            </Button>
            <div className="flex shrink-0 flex-col gap-4 border-b border-border-subtle pb-4 pt-6 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <h2 className="truncate text-lg font-semibold text-foreground">{sectionTitle}</h2>
                  {activeCount > 0 ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {i18nService.t('todoTaskCount').replace('{count}', String(activeCount))}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{sectionDescription}</p>
              </div>
              <div className="relative w-full shrink-0 sm:w-64">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder={i18nService.t('todoSearchPlaceholder')}
                  aria-label={i18nService.t('todoSearchPlaceholder')}
                  className="pl-8"
                />
              </div>
            </div>

            {activeView === TodoViewFilter.MyDay && suggestionTodos.length > 0 && !query.trim() ? (
              <section className="mb-4 rounded-lg border border-border bg-card p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {i18nService.t('todoSuggestionTitle')}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {i18nService.t('todoSuggestionDescription')}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {suggestionTodos.length}
                  </span>
                </div>
                <div className="space-y-1">
                  {suggestionTodos.map(todo => (
                    <Button
                      key={todo.id}
                      type="button"
                      variant="ghost"
                      onClick={async () => {
                        const result = await todoService.update(todo.id, {
                          myDayDate: todayDateKey(),
                        });
                        if (result.success) await loadData();
                        else showError();
                      }}
                      className="w-full justify-start gap-2"
                    >
                      <Plus className="size-4" />
                      <span className="min-w-0 flex-1 truncate text-left">{todo.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {todo.important
                          ? i18nService.t('todoSuggestionImportant')
                          : i18nService.t('todoSuggestionDue')}
                      </span>
                    </Button>
                  ))}
                </div>
              </section>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto pb-4">
              {isLoading ? (
                <div className="space-y-2" aria-label={i18nService.t('todoLoading')}>
                  {[0, 1, 2, 3].map(index => (
                    <div key={index} className="h-12 animate-pulse rounded-lg bg-muted" />
                  ))}
                </div>
              ) : loadFailed ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                  <p className="text-sm text-muted-foreground">{i18nService.t('todoLoadError')}</p>
                  <Button type="button" variant="outline" onClick={() => void loadData()}>
                    {i18nService.t('retry')}
                  </Button>
                </div>
              ) : todos.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                  <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                    <ListTodo className="size-6 text-muted-foreground" aria-hidden="true" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {query.trim()
                      ? i18nService.t('todoNoSearchResults')
                      : i18nService.t('todoEmpty')}
                  </p>
                  {!query.trim() ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => document.getElementById('todo-new-input')?.focus()}
                      className="gap-2"
                    >
                      <Plus />
                      {i18nService.t('todoNewTask')}
                    </Button>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-1">
                  {todos.map(todo => (
                    <TodoTaskRow
                      key={todo.id}
                      todo={todo}
                      language={language}
                      onOpen={() => setSelectedTodoId(todo.id)}
                      onToggleComplete={completed => void handleToggleTodo(todo, completed)}
                      onToggleImportant={() => void handleToggleImportant(todo)}
                    />
                  ))}
                </div>
              )}
            </div>

            <form
              onSubmit={handleCreateTodo}
              className="shrink-0 border-t border-border-subtle py-4"
            >
              <div className="rounded-lg border border-border bg-card p-2 focus-within:ring-3 focus-within:ring-ring/30">
                <div className="flex items-center gap-2">
                  <Plus className="ml-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <Input
                    id="todo-new-input"
                    value={newTodoTitle}
                    onChange={event => setNewTodoTitle(event.target.value)}
                    placeholder={i18nService.t('todoAddTaskPlaceholder')}
                    aria-label={i18nService.t('todoNewTask')}
                    className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                  />
                </div>
                {parsedNewTodo.dueAt !== null || parsedNewTodo.important ? (
                  <p className="mt-2 pl-7 text-xs text-muted-foreground">
                    {parsedNewTodo.dueAt !== null
                      ? `${i18nService.t('todoParsedDue')}: ${formatTodoDate(parsedNewTodo.dueAt, language)}`
                      : null}
                    {parsedNewTodo.dueAt !== null && parsedNewTodo.important ? ' · ' : null}
                    {parsedNewTodo.important ? i18nService.t('todoParsedImportant') : null}
                  </p>
                ) : null}
              </div>
            </form>
          </div>
        </main>
      </div>

      <Sheet open={isMobileNavigationOpen} onOpenChange={setIsMobileNavigationOpen}>
        <SheetContent side="left" className="w-full sm:max-w-sm md:hidden">
          <SheetHeader>
            <SheetTitle>{i18nService.t('todoTitle')}</SheetTitle>
            <SheetDescription>{i18nService.t('todoNavigationDescription')}</SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 px-4 pb-4">
            <TodoNavigationPanel
              activeView={activeView}
              activeListId={activeListId}
              activeCounts={activeCounts}
              lists={lists}
              listCounts={listCounts}
              newListName={newListName}
              newListInputId="todo-new-list-input-mobile"
              onNewListNameChange={setNewListName}
              onCreateList={handleCreateList}
              onFocusNewTask={focusNewTodoInput}
              onSelectView={handleSelectView}
              onSelectList={handleSelectList}
              onDeleteList={list => {
                setIsMobileNavigationOpen(false);
                setDeleteList(list);
              }}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={selectedTodo !== null} onOpenChange={open => !open && setSelectedTodoId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{i18nService.t('todoDetails')}</SheetTitle>
            <SheetDescription>{i18nService.t('todoDetailsDescription')}</SheetDescription>
          </SheetHeader>
          {selectedTodo ? (
            <TodoTaskDetail
              todo={selectedTodo}
              lists={lists}
              language={language}
              onUpdated={loadData}
              onDelete={() => setDeleteTodo(selectedTodo)}
            />
          ) : null}
        </SheetContent>
      </Sheet>

      <DestructiveConfirmDialog
        open={deleteTodo !== null}
        title={i18nService.t('todoDeleteConfirmTitle')}
        description={i18nService
          .t('todoDeleteConfirmMessage')
          .replace('{title}', deleteTodo?.title ?? '')}
        cancelLabel={i18nService.t('cancel')}
        confirmLabel={i18nService.t('delete')}
        onCancel={() => setDeleteTodo(null)}
        onConfirm={() => void handleConfirmDeleteTodo()}
      />
      <DestructiveConfirmDialog
        open={deleteList !== null}
        title={i18nService.t('todoDeleteListConfirmTitle')}
        description={i18nService
          .t('todoDeleteListConfirmMessage')
          .replace('{name}', deleteList?.name ?? '')}
        cancelLabel={i18nService.t('cancel')}
        confirmLabel={i18nService.t('delete')}
        onCancel={() => setDeleteList(null)}
        onConfirm={() => void handleConfirmDeleteList()}
      />
    </div>
  );
};

export default TodoView;
