import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { LayeredTabsList, LayeredTabsSeparatorEdge } from '@shared/components/ui/layered-tabs';
import { Tabs, TabsContent } from '@shared/components/ui/tabs';
import { Spinner } from '@shared/components/ui/spinner';
import { ArrowLeft, PanelLeft, Pencil } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
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

const SCHEDULED_TASK_TAB = {
  Create: 'create',
  Tasks: 'tasks',
  History: 'history',
} as const;

type TabType = (typeof SCHEDULED_TASK_TAB)[keyof typeof SCHEDULED_TASK_TAB];

const SCHEDULED_TASK_TAB_ORDER: TabType[] = [
  SCHEDULED_TASK_TAB.Create,
  SCHEDULED_TASK_TAB.Tasks,
  SCHEDULED_TASK_TAB.History,
];
const tabContentVariants = {
  enter: (direction: number) => ({
    opacity: 0,
    x: direction > 0 ? 28 : -28,
  }),
  center: {
    opacity: 1,
    x: 0,
  },
  exit: (direction: number) => ({
    opacity: 0,
    x: direction > 0 ? -28 : 28,
  }),
};

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
  const [activeTab, setActiveTab] = useState<TabType>(SCHEDULED_TASK_TAB.Tasks);
  const [tabDirection, setTabDirection] = useState(1);
  const prefersReducedMotion = useReducedMotion();
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

  const switchToTab = useCallback(
    (tab: TabType) => {
      setTabDirection(
        SCHEDULED_TASK_TAB_ORDER.indexOf(tab) >= SCHEDULED_TASK_TAB_ORDER.indexOf(activeTab)
          ? 1
          : -1,
      );
      if (isFormDirtyRef.current && activeTab === SCHEDULED_TASK_TAB.Create) {
        pendingTabSwitchRef.current = tab;
        setShowLeaveConfirm(true);
        return;
      }
      setActiveTab(tab);
      if (tab === SCHEDULED_TASK_TAB.Tasks) {
        dispatch(selectTask(null));
        dispatch(setViewMode('list'));
      }
    },
    [activeTab, dispatch],
  );

  const handleTabChange = (value: string) => {
    const tab = value as TabType;
    if (tab === activeTab) return;
    if (tab === SCHEDULED_TASK_TAB.Create) {
      setTabDirection(
        SCHEDULED_TASK_TAB_ORDER.indexOf(tab) >= SCHEDULED_TASK_TAB_ORDER.indexOf(activeTab)
          ? 1
          : -1,
      );
      // Reset to template gallery
      setCreatingTask(false);
      setTemplatePrefill(undefined);
      setCreateFormKey(k => k + 1);
      isFormDirtyRef.current = false;
      setActiveTab(SCHEDULED_TASK_TAB.Create);
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
      setTabDirection(1);
      setActiveTab(SCHEDULED_TASK_TAB.Tasks);
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
    activeTab === SCHEDULED_TASK_TAB.Tasks &&
    (viewMode === 'detail' || viewMode === 'edit') &&
    selectedTaskId;

  const scheduledTaskTabs = [
    { value: SCHEDULED_TASK_TAB.Create, label: i18nService.t('scheduledTasksNewTab') },
    { value: SCHEDULED_TASK_TAB.Tasks, label: i18nService.t('scheduledTasksTabTasks') },
    { value: SCHEDULED_TASK_TAB.History, label: i18nService.t('scheduledTasksTabHistory') },
  ] as const;

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
          <h1 className="text-lg font-semibold text-foreground">
            {i18nService.t('scheduledTasksTitle')}
          </h1>
        </div>
        <WindowTitleBar inline />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="min-h-0 flex-1 gap-0">
        <LayeredTabsList
          value={activeTab}
          items={scheduledTaskTabs}
          separatorEdge={LayeredTabsSeparatorEdge.Top}
          className="pb-4"
        />

        <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col px-4">
          <div className="min-h-0 flex-1 overflow-hidden">
            <TabsContent value={activeTab} keepMounted className="h-full min-h-0 overflow-hidden">
              <AnimatePresence initial={false} custom={tabDirection} mode="wait">
                <motion.div
                  key={activeTab}
                  custom={tabDirection}
                  variants={tabContentVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{
                    duration: prefersReducedMotion ? 0 : 0.22,
                    ease: 'easeOut',
                  }}
                  className="h-full min-h-0 overflow-y-auto pt-4"
                >
                  {activeTab === SCHEDULED_TASK_TAB.Create && (
                    <div className="w-full px-4">
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
                  )}

                  {activeTab === SCHEDULED_TASK_TAB.Tasks && (
                    <div className="w-full px-4">
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
                  )}

                  {activeTab === SCHEDULED_TASK_TAB.History && (
                    <div className="w-full px-4">
                      <AllRunsHistory />
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </TabsContent>
          </div>
        </div>
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
                  if (target === SCHEDULED_TASK_TAB.Tasks) {
                    setTabDirection(
                      SCHEDULED_TASK_TAB_ORDER.indexOf(target) >=
                        SCHEDULED_TASK_TAB_ORDER.indexOf(activeTab)
                        ? 1
                        : -1,
                    );
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
