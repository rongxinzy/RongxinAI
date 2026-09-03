import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import {
  CalendarDays,
  CheckCircle2,
  FolderPlus,
  Inbox,
  ListTodo,
  Plus,
  Star,
  Sun,
  Trash2,
} from 'lucide-react';
import type React from 'react';

import { TodoView, type TodoList } from '../../../shared/todo';
import { i18nService } from '../../services/i18n';

interface TodoNavigationItem {
  value: TodoView;
  labelKey: string;
  icon: React.ComponentType;
}

export const todoNavigationItems: readonly TodoNavigationItem[] = [
  { value: TodoView.MyDay, labelKey: 'todoMyDay', icon: Sun },
  { value: TodoView.Important, labelKey: 'todoImportant', icon: Star },
  { value: TodoView.Planned, labelKey: 'todoPlanned', icon: CalendarDays },
  { value: TodoView.All, labelKey: 'todoAll', icon: Inbox },
  { value: TodoView.Completed, labelKey: 'todoCompleted', icon: CheckCircle2 },
];

interface TodoNavigationPanelProps {
  activeView: TodoView;
  activeListId: string | null;
  activeCounts: Record<TodoView, number>;
  lists: TodoList[];
  listCounts: Map<string, number>;
  newListName: string;
  newListInputId: string;
  onNewListNameChange: (name: string) => void;
  onCreateList: (event: React.FormEvent<HTMLFormElement>) => void;
  onFocusNewTask: () => void;
  onSelectView: (view: TodoView) => void;
  onSelectList: (listId: string) => void;
  onDeleteList: (list: TodoList) => void;
}

const TodoNavigationPanel: React.FC<TodoNavigationPanelProps> = ({
  activeView,
  activeListId,
  activeCounts,
  lists,
  listCounts,
  newListName,
  newListInputId,
  onNewListNameChange,
  onCreateList,
  onFocusNewTask,
  onSelectView,
  onSelectList,
  onDeleteList,
}) => (
  <div className="flex min-h-0 flex-1 flex-col">
    <Button type="button" onClick={onFocusNewTask} className="w-full justify-start">
      <Plus />
      {i18nService.t('todoNewTask')}
    </Button>

    <nav className="mt-4 flex flex-col gap-1" aria-label={i18nService.t('todoTitle')}>
      {todoNavigationItems.map(item => {
        const Icon = item.icon;
        const isActive = activeView === item.value && activeListId === null;
        const itemCount = activeCounts[item.value];
        return (
          <Button
            key={item.value}
            type="button"
            variant={isActive ? 'secondary' : 'ghost'}
            onClick={() => onSelectView(item.value)}
            className="w-full justify-start gap-2"
            aria-current={isActive ? 'page' : undefined}
          >
            <Icon />
            {i18nService.t(item.labelKey)}
            {itemCount > 0 ? (
              <span className="ml-auto text-xs text-muted-foreground">{itemCount}</span>
            ) : null}
          </Button>
        );
      })}
    </nav>

    <div className="mt-6 min-h-0 flex-1">
      <div className="mb-2 flex items-center justify-between px-2 text-xs font-medium text-muted-foreground">
        <span>{i18nService.t('todoListSection')}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={i18nService.t('todoNewList')}
          title={i18nService.t('todoNewList')}
          onClick={() => document.getElementById(newListInputId)?.focus()}
        >
          <FolderPlus />
        </Button>
      </div>
      <div className="flex flex-col gap-1 overflow-y-auto">
        {lists.map(list => {
          const isActive = activeListId === list.id;
          const listCount = listCounts.get(list.id) ?? 0;
          return (
            <div key={list.id} className="flex items-center gap-1">
              <Button
                type="button"
                variant={isActive ? 'secondary' : 'ghost'}
                onClick={() => onSelectList(list.id)}
                className="min-w-0 flex-1 justify-start gap-2"
                aria-current={isActive ? 'page' : undefined}
              >
                <ListTodo />
                <span className="truncate">{list.name}</span>
                {listCount > 0 ? (
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {listCount}
                  </span>
                ) : null}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`${i18nService.t('todoDeleteList')}: ${list.name}`}
                title={i18nService.t('todoDeleteList')}
                onClick={() => onDeleteList(list)}
              >
                <Trash2 />
              </Button>
            </div>
          );
        })}
      </div>
    </div>

    <form onSubmit={onCreateList} className="mt-3 flex items-center gap-2">
      <Input
        id={newListInputId}
        value={newListName}
        onChange={event => onNewListNameChange(event.target.value)}
        placeholder={i18nService.t('todoListNamePlaceholder')}
        aria-label={i18nService.t('todoNewList')}
      />
      <Button
        type="submit"
        variant="outline"
        size="icon-sm"
        aria-label={i18nService.t('todoNewList')}
      >
        <Plus />
      </Button>
    </form>
  </div>
);

export default TodoNavigationPanel;
