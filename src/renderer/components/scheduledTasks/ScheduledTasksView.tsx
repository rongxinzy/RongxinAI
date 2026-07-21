import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/components/ui/tabs';
import { ArrowLeft, PanelLeft, Pencil, Plus } from 'lucide-react';
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
import TaskTemplateGallery, { type TaskTemplateValues } from './TaskTemplateGallery';

interface ScheduledTasksViewProps {
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  updateBadge?: React.ReactNode;
}

type TabType = 'create' | 'tasks' | 'history';

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
  const pendingTabSwitchRef = useRef<TabType | null>(null);
  const [createFormKey, setCreateFormKey] = useState(0);
  const [creatingTask, setCreatingTask] = useState(false);
  const [templatePrefill, setTemplatePrefill] = useState<TaskTemplateValues | undefined>();

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
    scheduledTaskService.loadTasks();
  }, []);

  const switchToTab = useCallback(
    (tab: TabType) => {
      if (isFormDirtyRef.current && activeTab === 'create') {
        pendingTabSwitchRef.current = tab;
        setShowLeaveConfirm(true);
        return;
      }
      setActiveTab(tab);
      if (tab === 'tasks') {
        dispatch(selectTask(null));
        dispatch(setViewMode('list'));
      }
    },
    [activeTab, dispatch],
  );

  const handleTabChange = (value: string) => {
    const tab = value as TabType;
    if (tab === activeTab) return;
    if (tab === 'create') {
      // Reset to template gallery
      setCreatingTask(false);
      setTemplatePrefill(undefined);
      setCreateFormKey(k => k + 1);
      isFormDirtyRef.current = false;
      setActiveTab('create');
    } else {
      switchToTab(tab);
    }
  };

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
      setActiveTab('tasks');
      if (newTaskId) {
        dispatch(selectTask(newTaskId));
        dispatch(setViewMode('detail'));
      } else {
        dispatch(selectTask(null));
        dispatch(setViewMode('list'));
      }
    },
    [dispatch],
  );

  // Show back arrow when viewing task detail or editing within tasks tab
  const showBack =
    activeTab === 'tasks' && (viewMode === 'detail' || viewMode === 'edit') && selectedTaskId;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="draggable flex h-12 items-center justify-between px-4 border-b border-border shrink-0">
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
          <h1 className="text-lg font-semibold text-foreground">
            {i18nService.t('scheduledTasksTitle')}
          </h1>
        </div>
        <WindowTitleBar inline />
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="flex-1 min-h-0 flex flex-col"
      >
        <div className="max-w-2xl mx-auto w-full px-4 mt-3">
          <TabsList className="shadow-inset">
            <TabsTrigger value="create" className="data-active:shadow-elevated">
              <Plus />
              {i18nService.t('scheduledTasksNewTask')}
            </TabsTrigger>
            <TabsTrigger value="tasks" className="data-active:shadow-elevated">
              {i18nService.t('scheduledTasksTabTasks')}
            </TabsTrigger>
            <TabsTrigger value="history" className="data-active:shadow-elevated">
              {i18nService.t('scheduledTasksTabHistory')}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="create" className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-2xl mx-auto w-full px-4">
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
        </TabsContent>

        <TabsContent value="tasks" className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-2xl mx-auto w-full px-4">
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
        </TabsContent>

        <TabsContent value="history" className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-2xl mx-auto w-full px-4">
            <AllRunsHistory />
          </div>
        </TabsContent>
      </Tabs>

      {/* Delete confirmation modal */}
      {deleteTaskInfo && (
        <DeleteConfirmModal
          taskName={deleteTaskInfo.name}
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
        />
      )}

      {/* Unsaved changes confirmation */}
      <Dialog open={showLeaveConfirm} onOpenChange={setShowLeaveConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{i18nService.t('taskFormUnsavedChanges')}</DialogTitle>
            <DialogDescription>{i18nService.t('taskFormLeaveConfirm')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowLeaveConfirm(false);
                pendingTabSwitchRef.current = null;
              }}
            >
              {i18nService.t('taskFormStay')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setShowLeaveConfirm(false);
                isFormDirtyRef.current = false;
                const target = pendingTabSwitchRef.current;
                pendingTabSwitchRef.current = null;
                if (target) {
                  setActiveTab(target);
                  if (target === 'tasks') {
                    dispatch(selectTask(null));
                    dispatch(setViewMode('list'));
                  }
                }
              }}
            >
              {i18nService.t('taskFormLeave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ScheduledTasksView;
