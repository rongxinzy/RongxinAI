import { Button } from '@shared/components/ui/button';
import { ArrowLeft, PanelLeft, Pencil } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { scheduledTaskService } from '../../services/scheduledTask';
import { RootState } from '../../store';
import { selectTask, setViewMode } from '../../store/slices/scheduledTaskSlice';
import WindowTitleBar from '../window/WindowTitleBar';
import AllRunsHistory from './AllRunsHistory';
import DeleteConfirmModal from './DeleteConfirmModal';
import TaskDetail from './TaskDetail';
import TaskForm from './TaskForm';
import TaskList from './TaskList';

interface ScheduledTasksViewProps {
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  updateBadge?: React.ReactNode;
}

type TabType = 'tasks' | 'history';

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
  const [activeTab, setActiveTab] = useState<TabType>('tasks');
  const [deleteTaskInfo, setDeleteTaskInfo] = useState<{ id: string; name: string } | null>(null);
  const isFormDirtyRef = useRef(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const pendingBackActionRef = useRef<(() => void) | null>(null);

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
    // If we were viewing this task's detail, go back to list
    if (selectedTaskId === taskId) {
      dispatch(selectTask(null));
      dispatch(setViewMode('list'));
    }
  }, [deleteTaskInfo, selectedTaskId, dispatch]);

  const handleCancelDelete = useCallback(() => {
    setDeleteTaskInfo(null);
  }, []);

  useEffect(() => {
    scheduledTaskService.loadTasks();
  }, []);

  const requestLeave = useCallback((action: () => void) => {
    if (isFormDirtyRef.current) {
      pendingBackActionRef.current = () => {
        isFormDirtyRef.current = false;
        action();
      };
      setShowLeaveConfirm(true);
    } else {
      action();
    }
  }, []);

  const handleBackToList = () => {
    const action = () => {
      dispatch(selectTask(null));
      dispatch(setViewMode('list'));
    };
    if (viewMode === 'create' || viewMode === 'edit') {
      requestLeave(action);
    } else {
      action();
    }
  };

  const handleEditCancel = useCallback(() => {
    requestLeave(() => dispatch(setViewMode('detail')));
  }, [requestLeave, dispatch]);

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    if (tab === 'tasks') {
      dispatch(selectTask(null));
      dispatch(setViewMode('list'));
    }
  };

  // Show tabs only in list view (not in create/edit/detail sub-views)
  const showTabs = viewMode === 'list' && !selectedTaskId;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="draggable flex h-12 items-center justify-between px-4 border-b border-border shrink-0">
        <div className="flex items-center space-x-3 h-8">
          {isSidebarCollapsed && (
            <div className={`non-draggable flex items-center gap-1 ${isMac ? 'pl-[68px]' : ''}`}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onToggleSidebar}
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-raised transition-colors"
              >
                <PanelLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onNewChat}
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-raised transition-colors"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              {updateBadge}
            </div>
          )}
          {viewMode !== 'list' && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleBackToList}
              className="non-draggable p-2 rounded-lg hover:bg-surface-raised text-muted-foreground transition-colors"
              aria-label={i18nService.t('back')}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <h1 className="text-lg font-semibold text-foreground">
            {i18nService.t('scheduledTasksTitle')}
          </h1>
        </div>
        <WindowTitleBar inline />
      </div>

      {/* Tabs + New Task button */}
      {showTabs && (
        <div className="flex items-center justify-between border-b border-border px-4 shrink-0">
          <div className="flex">
            <Button
              type="button"
              variant={activeTab === 'tasks' ? 'default' : 'ghost'}
              onClick={() => handleTabChange('tasks')}
              className="px-4 py-2.5 text-[14px] font-normal leading-5 transition-colors relative rounded-none"
            >
              {i18nService.t('scheduledTasksTabTasks')}
              {activeTab === 'tasks' && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t" />
              )}
            </Button>
            <Button
              type="button"
              variant={activeTab === 'history' ? 'default' : 'ghost'}
              onClick={() => handleTabChange('history')}
              className="px-4 py-2.5 text-[14px] font-normal leading-5 transition-colors relative rounded-none"
            >
              {i18nService.t('scheduledTasksTabHistory')}
              {activeTab === 'history' && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t" />
              )}
            </Button>
          </div>
          {activeTab === 'tasks' && (
            <Button
              type="button"
              onClick={() => dispatch(setViewMode('create'))}
              className="px-3 py-1 text-[14px] font-normal leading-5 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors"
            >
              {i18nService.t('scheduledTasksNewTask')}
            </Button>
          )}
        </div>
      )}

      {/* Content */}
      <div
        className={`flex-1 min-h-0 ${viewMode === 'create' || viewMode === 'edit' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'}`}
      >
        {showTabs && activeTab === 'history' ? (
          <AllRunsHistory />
        ) : (
          <>
            {viewMode === 'list' && <TaskList onRequestDelete={handleRequestDelete} />}
            {viewMode === 'create' && (
              <TaskForm
                mode="create"
                onCancel={handleBackToList}
                onSaved={newTaskId => {
                  if (newTaskId) {
                    dispatch(selectTask(newTaskId));
                    dispatch(setViewMode('detail'));
                  } else {
                    handleBackToList();
                  }
                }}
                onDirtyChange={handleFormDirtyChange}
              />
            )}
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
          </>
        )}
      </div>

      {/* Delete confirmation modal */}
      {deleteTaskInfo && (
        <DeleteConfirmModal
          taskName={deleteTaskInfo.name}
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
        />
      )}

      {/* Unsaved changes confirmation overlay (back arrow) */}
      {showLeaveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35">
          <div
            role="dialog"
            aria-modal="true"
            onClick={e => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-background border-border border shadow-modal p-5"
          >
            <h4 className="text-sm font-semibold text-foreground mb-2">
              {i18nService.t('taskFormUnsavedChanges')}
            </h4>
            <p className="text-sm text-muted-foreground mb-4">{i18nService.t('taskFormLeaveConfirm')}</p>
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowLeaveConfirm(false)}
                className="px-4 py-2 text-sm rounded-lg text-muted-foreground hover:bg-surface-raised transition-colors border border-border"
              >
                {i18nService.t('taskFormStay')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  setShowLeaveConfirm(false);
                  pendingBackActionRef.current?.();
                  pendingBackActionRef.current = null;
                }}
                className="px-4 py-2 text-sm font-medium bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                {i18nService.t('taskFormLeave')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScheduledTasksView;
