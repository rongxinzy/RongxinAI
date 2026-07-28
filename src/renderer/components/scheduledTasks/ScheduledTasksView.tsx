import { Button } from '@shared/components/ui/button';
import { Spinner } from '@shared/components/ui/spinner';
import { ArrowLeft, CalendarClock, PanelLeft, Pencil } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { scheduledTaskService } from '../../services/scheduledTask';
import { RootState } from '../../store';
import { selectTask, setViewMode } from '../../store/slices/scheduledTaskSlice';
import { useGatewayReady } from '../cowork/useGatewayReady';
import WindowTitleBar from '../window/WindowTitleBar';
import AllRunsHistory from './AllRunsHistory';
import DeleteConfirmModal from './DeleteConfirmModal';
import TaskDetail from './TaskDetail';
import TaskForm from './TaskForm';
import TaskList from './TaskList';
import TaskTemplateGallery, { type TaskTemplateValues } from './TaskTemplateGallery';

interface ScheduledTasksViewProps {
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  updateBadge?: React.ReactNode;
}

const ScheduledTasksView: React.FC<ScheduledTasksViewProps> = ({
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
  updateBadge,
}) => {
  const dispatch = useDispatch();
  const isMac = window.electron.platform === 'darwin';
  const viewMode = useSelector((state: RootState) => state.scheduledTask.viewMode);
  const selectedTaskId = useSelector((state: RootState) => state.scheduledTask.selectedTaskId);
  const tasks = useSelector((state: RootState) => state.scheduledTask.tasks);
  const selectedTask = selectedTaskId ? (tasks.find(t => t.id === selectedTaskId) ?? null) : null;
  const gatewayReady = useGatewayReady();
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const [deleteTaskInfo, setDeleteTaskInfo] = useState<{ id: string; name: string } | null>(null);
  const isFormDirtyRef = useRef(false);
  const [createFormKey, setCreateFormKey] = useState(0);
  const [creatingTask, setCreatingTask] = useState(false);
  const [templatePrefill, setTemplatePrefill] = useState<TaskTemplateValues | undefined>();
  const tasksSectionRef = useRef<HTMLElement>(null);

  const handleFormDirtyChange = useCallback((dirty: boolean) => {
    isFormDirtyRef.current = dirty;
  }, []);

  const handleRequestDelete = useCallback((taskId: string, taskName: string) => {
    setDeleteTaskInfo({ id: taskId, name: taskName });
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTaskInfo) return;
    const taskId = deleteTaskInfo.id;
    setDeleteTaskInfo(null);
    await scheduledTaskService.deleteTask(taskId);
    if (selectedTaskId === taskId) {
      dispatch(selectTask(null));
      dispatch(setViewMode('list'));
    }
  }, [deleteTaskInfo, selectedTaskId, dispatch]);

  const handleCancelDelete = useCallback(() => {
    setDeleteTaskInfo(null);
  }, []);

  useEffect(() => {
    if (!gatewayReady) {
      setInitialDataLoaded(false);
      return;
    }

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
  }, [gatewayReady]);

  const handleBackToList = () => {
    dispatch(selectTask(null));
    dispatch(setViewMode('list'));
  };

  const handleEditCancel = useCallback(() => {
    if (selectedTaskId) {
      dispatch(setViewMode('detail'));
    } else {
      dispatch(setViewMode('list'));
    }
  }, [selectedTaskId, dispatch]);

  const handleCreateSaved = useCallback(
    (newTaskId?: string) => {
      isFormDirtyRef.current = false;
      setCreatingTask(false);
      setTemplatePrefill(undefined);
      setCreateFormKey(k => k + 1);
      if (newTaskId) {
        dispatch(selectTask(newTaskId));
        dispatch(setViewMode('detail'));
        tasksSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        dispatch(selectTask(null));
        dispatch(setViewMode('list'));
      }
    },
    [dispatch],
  );

  // Show back arrow when viewing task detail or editing
  const showBack = (viewMode === 'detail' || viewMode === 'edit') && selectedTaskId;

  if (!gatewayReady || !initialDataLoaded) {
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
      {/* Header */}
      <div className="draggable flex h-12 shrink-0 items-center justify-between px-4">
        <div className="flex items-center gap-3 h-8">
          {isSidebarCollapsed && (
            <div className={`non-draggable flex items-center gap-1 ${isMac ? 'pl-[68px]' : ''}`}>
              <Button type="button" variant="ghost" size="icon" onClick={onToggleSidebar}>
                <PanelLeft />
              </Button>
              <Button type="button" variant="ghost" size="icon" onClick={onNewChat}>
                <Pencil />
              </Button>
              {updateBadge}
            </div>
          )}
          {showBack && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleBackToList}
              className="non-draggable"
              aria-label={i18nService.t('back')}
            >
              <ArrowLeft />
            </Button>
          )}
        </div>
        <WindowTitleBar inline />
      </div>

      {/* Single-page content: three sections separated by dividers */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-8 pb-8">
          {/* ── Hero ── */}
          <section className="animate-fade-in-up py-8">
            <div className="flex items-center gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary-muted">
                <CalendarClock className="size-6 text-primary" />
              </div>
              <div className="min-w-0">
                <h1 className="text-xxl font-semibold text-foreground">
                  {i18nService.t('scheduledTasksTitle')}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {i18nService.t('scheduledTasksHeroDesc')}
                </p>
              </div>
            </div>
          </section>

          <div className="border-t border-border-subtle" />
          {/* ── Section: Create ── */}
          <section className="py-6">
            <h2 className="text-base font-semibold text-foreground">
              {i18nService.t('scheduledTasksNewTab')}
            </h2>
            <div className="mt-4">
              {creatingTask ? (
                <TaskForm
                  key={createFormKey}
                  mode="create"
                  prefill={templatePrefill}
                  onCancel={() => {
                    setCreatingTask(false);
                    setTemplatePrefill(undefined);
                    isFormDirtyRef.current = false;
                  }}
                  onSaved={handleCreateSaved}
                  onDirtyChange={handleFormDirtyChange}
                />
              ) : (
                <TaskTemplateGallery
                  onSelectTemplate={values => {
                    setTemplatePrefill(values);
                    setCreatingTask(true);
                  }}
                  onCustom={() => {
                    setTemplatePrefill(undefined);
                    setCreatingTask(true);
                  }}
                />
              )}
            </div>
          </section>

          <div className="border-t border-border-subtle" />

          {/* ── Section: Tasks ── */}
          <section ref={tasksSectionRef} className="scroll-mt-4 py-6">
            <h2 className="text-base font-semibold text-foreground">
              {i18nService.t('scheduledTasksTabTasks')}
            </h2>
            <div className="mt-4">
              {viewMode === 'list' && <TaskList onRequestDelete={handleRequestDelete} />}
              {viewMode === 'edit' && selectedTask && (
                <TaskForm
                  mode="edit"
                  task={selectedTask}
                  onCancel={handleEditCancel}
                  onSaved={() => dispatch(setViewMode('detail'))}
                  onDirtyChange={handleFormDirtyChange}
                />
              )}
              {viewMode === 'detail' && selectedTask && (
                <TaskDetail task={selectedTask} onRequestDelete={handleRequestDelete} />
              )}
            </div>
          </section>

          <div className="border-t border-border-subtle" />

          {/* ── Section: History ── */}
          <section className="py-6">
            <h2 className="text-base font-semibold text-foreground">
              {i18nService.t('scheduledTasksTabHistory')}
            </h2>
            <div className="mt-4">
              <AllRunsHistory />
            </div>
          </section>
        </div>
      </div>

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
