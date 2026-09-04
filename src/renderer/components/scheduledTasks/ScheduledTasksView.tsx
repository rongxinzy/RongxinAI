import { Badge } from '@shared/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { PageTabs } from '@shared/components/ui/page-tabs';
import { Spinner } from '@shared/components/ui/spinner';
import { Button } from '@shared/components/ui/button';
import { cn } from '@shared/lib/utils';
import { MessageCirclePlus } from 'lucide-react';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { scheduledTaskService } from '../../services/scheduledTask';
import { RootState } from '../../store';
import { setDraftPrompt } from '../../store/slices/coworkSlice';
import PageHeader from '../PageHeader';
import AllRunsHistory from './AllRunsHistory';
import DeleteConfirmModal from './DeleteConfirmModal';
import TaskForm from './TaskForm';
import TaskList from './TaskList';
import TaskTemplateGallery, { type TaskTemplateValues } from './TaskTemplateGallery';

interface ScheduledTasksViewProps {
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  updateBadge?: React.ReactNode;
}

const AUTO_TAB = {
  Create: 'create',
  Tasks: 'tasks',
  History: 'history',
} as const;

type AutoTab = (typeof AUTO_TAB)[keyof typeof AUTO_TAB];

const ScheduledTasksView: React.FC<ScheduledTasksViewProps> = ({
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
  updateBadge,
}) => {
  const dispatch = useDispatch();
  const tasks = useSelector((state: RootState) => state.scheduledTask.tasks);
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);

  const [activeTab, setActiveTab] = useState<AutoTab>(AUTO_TAB.Tasks);
  const [deleteTaskInfo, setDeleteTaskInfo] = useState<{ id: string; name: string } | null>(null);

  const activePaneScrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    activePaneScrollRef.current?.scrollTo({ top: 0 });
  }, [activeTab, initialDataLoaded]);

  // Create-task modal (template-prefilled or blank custom)
  const [createOpen, setCreateOpen] = useState(false);
  const [createPrefill, setCreatePrefill] = useState<TaskTemplateValues | undefined>();
  const [createFormKey, setCreateFormKey] = useState(0);

  // The list's edit action owns the only per-task modal. Detail views are intentionally omitted.
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const editingTask = editingTaskId ? (tasks.find(t => t.id === editingTaskId) ?? null) : null;

  const handleRequestDelete = useCallback((taskId: string, taskName: string) => {
    setDeleteTaskInfo({ id: taskId, name: taskName });
  }, []);

  const handleRequestEdit = useCallback((taskId: string) => {
    setEditingTaskId(taskId);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTaskInfo) return;
    const taskId = deleteTaskInfo.id;
    setDeleteTaskInfo(null);
    await scheduledTaskService.deleteTask(taskId);
    if (editingTaskId === taskId) {
      setEditingTaskId(null);
    }
  }, [deleteTaskInfo, editingTaskId]);

  const handleCancelDelete = useCallback(() => {
    setDeleteTaskInfo(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadTasks = scheduledTaskService.isInitialized
      ? scheduledTaskService.loadTasks()
      : scheduledTaskService.init();

    void loadTasks.finally(() => {
      if (!cancelled) {
        setInitialDataLoaded(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const openCreateModal = useCallback((prefill?: TaskTemplateValues) => {
    setCreatePrefill(prefill);
    setCreateFormKey(k => k + 1);
    setCreateOpen(true);
  }, []);

  // base-ui Tabs handles arrow-key/Home/End tablist navigation natively.

  const handleCreateSaved = useCallback(() => {
    setCreateOpen(false);
    setCreatePrefill(undefined);
    setActiveTab(AUTO_TAB.Tasks);
  }, []);

  const handleCreateByChat = useCallback(() => {
    dispatch(
      setDraftPrompt({
        sessionId: '__home__',
        draft: i18nService.t('scheduledTasksCreateByChatPrompt'),
      }),
    );
    onNewChat?.();
  }, [dispatch, onNewChat]);

  if (!initialDataLoaded) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          <span>{i18nService.t('scheduledTasksLoading')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={i18nService.t('scheduledTasksTitle')}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        onNewChat={onNewChat}
        updateBadge={updateBadge}
        tabs={
          <PageTabs
            value={activeTab}
            onValueChange={setActiveTab}
            items={[
              {
                value: AUTO_TAB.Tasks,
                label: i18nService.t('scheduledTasksTabTasks'),
                badge:
                  tasks.length > 0 ? <Badge variant="secondary">{tasks.length}</Badge> : undefined,
              },
              { value: AUTO_TAB.Create, label: i18nService.t('scheduledTasksNewTab') },
              { value: AUTO_TAB.History, label: i18nService.t('scheduledTasksTabHistory') },
            ]}
          />
        }
      />

      <div className="mx-auto w-full max-w-2xl shrink-0 px-8">
        <div className="flex items-center justify-between gap-4 pt-4">
          <p className="text-sm text-muted-foreground">{i18nService.t('scheduledTasksHeroDesc')}</p>
          <Button type="button" variant="outline" size="sm" onClick={handleCreateByChat}>
            <MessageCirclePlus className="size-4" />
            {i18nService.t('scheduledTasksCreateByChat')}
          </Button>
        </div>
      </div>

      <div
        ref={activePaneScrollRef}
        className={cn(
          'min-h-0 flex-1 overflow-x-hidden',
          activeTab === AUTO_TAB.History ? 'flex flex-col overflow-y-hidden' : 'overflow-y-auto',
        )}
      >
        <div
          className={cn(
            'mx-auto w-full max-w-2xl px-8',
            activeTab === AUTO_TAB.History && 'flex min-h-0 flex-1 flex-col',
          )}
        >
          <div
            key={activeTab}
            className={cn(
              'animate-fade-in pt-6 pb-10',
              activeTab === AUTO_TAB.History ? 'flex min-h-0 flex-1 flex-col' : 'min-h-full',
            )}
          >
            {activeTab === AUTO_TAB.Create && (
              <TaskTemplateGallery
                onSelectTemplate={values => openCreateModal(values)}
                onCustom={() => openCreateModal(undefined)}
              />
            )}

            {activeTab === AUTO_TAB.Tasks && (
              <TaskList onRequestDelete={handleRequestDelete} onRequestEdit={handleRequestEdit} />
            )}

            {activeTab === AUTO_TAB.History && <AllRunsHistory />}
          </div>
        </div>
      </div>

      {/* Create-task modal */}
      <Dialog
        open={createOpen}
        onOpenChange={open => {
          setCreateOpen(open);
          if (!open) {
            setCreatePrefill(undefined);
            setCreateFormKey(key => key + 1);
          }
        }}
      >
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="sr-only">
            <DialogTitle>{i18nService.t('scheduledTasksNewTask')}</DialogTitle>
            <DialogDescription>{i18nService.t('scheduledTasksNewTask')}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-b-xl px-4 pt-9">
            <TaskForm
              key={createFormKey}
              mode="create"
              prefill={createPrefill}
              onCancel={() => setCreateOpen(false)}
              onSaved={handleCreateSaved}
              onDirtyChange={() => {}}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Task edit modal */}
      <Dialog
        open={editingTask !== null}
        onOpenChange={open => {
          if (!open) {
            setEditingTaskId(null);
          }
        }}
      >
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="sr-only">
            <DialogTitle>{editingTask?.name ?? i18nService.t('scheduledTasksTitle')}</DialogTitle>
            <DialogDescription>{editingTask?.name ?? ''}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-b-xl px-4 pt-9">
            {editingTask && (
              <TaskForm
                mode="edit"
                task={editingTask}
                onCancel={() => setEditingTaskId(null)}
                onSaved={() => setEditingTaskId(null)}
                onDirtyChange={() => {}}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation modal */}
      {deleteTaskInfo && (
        <DeleteConfirmModal
          taskName={deleteTaskInfo.name}
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
        />
      )}
    </div>
  );
};

export default ScheduledTasksView;
