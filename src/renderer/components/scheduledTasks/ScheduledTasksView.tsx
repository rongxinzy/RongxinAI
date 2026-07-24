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
import { Separator } from '@shared/components/ui/separator';
import { Spinner } from '@shared/components/ui/spinner';
import { cn } from '@shared/lib/utils';
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

interface ScheduledTaskTabTriggerProps {
  value: TabType;
  activeTab: TabType;
  index: number;
  label: string;
  prefersReducedMotion: boolean | null;
}

const ScheduledTaskTabTrigger: React.FC<ScheduledTaskTabTriggerProps> = ({
  value,
  activeTab,
  index,
  label,
  prefersReducedMotion,
}) => {
  const isActive = value === activeTab;
  const activeIndex = SCHEDULED_TASK_TAB_ORDER.indexOf(activeTab);
  const tabLayer = isActive ? 20 : activeIndex === 0 ? 3 - index : index + 1;
  const isThirdLayer = activeIndex === 0 ? index === 2 : activeIndex === 2 ? index === 0 : false;
  const tabHeight = isActive ? 40 : isThirdLayer ? 27.5 : 32;
  const tabWidth = isThirdLayer ? '86%' : '100%';
  const textScale = isActive ? 1 : isThirdLayer ? 0.75 : 0.875;

  return (
    <TabsTrigger
      value={value}
      style={{ zIndex: isActive ? 30 : tabLayer, boxShadow: isActive ? 'none' : undefined }}
      className={cn(
        'group relative h-10 min-w-0 flex-1 rounded-t-lg rounded-b-none border-0 bg-transparent px-0 py-0 text-sm font-medium text-muted-foreground transition-colors duration-200 ease-out hover:text-foreground',
        'data-active:z-10 data-active:border-b-0 data-active:bg-transparent data-active:font-semibold data-active:text-muted-foreground data-active:shadow-none data-active:hover:bg-transparent data-active:hover:text-muted-foreground dark:data-active:bg-transparent',
        'after:inset-x-0 after:bottom-0 after:z-10 after:h-px after:bg-border after:opacity-100',
        index > 0 && '-ml-4',
      )}
    >
      <motion.span
        key="inactive-background"
        className={cn(
          'pointer-events-none absolute bottom-0 rounded-t-lg border border-b-0 border-border transition-colors duration-200',
          isActive && 'z-20 bg-card',
          !isActive && !isThirdLayer && 'bg-secondary',
          !isThirdLayer && 'shadow-md [clip-path:inset(-8px_-8px_0_-8px)]',
          isThirdLayer && 'bg-surface-tertiary shadow-none',
        )}
        animate={{ height: tabHeight, width: tabWidth }}
        style={{ left: index === 0 ? 'auto' : 0, right: index === 0 ? 0 : 'auto' }}
        transition={{
          height: prefersReducedMotion
            ? { duration: 0 }
            : { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 },
          width: { duration: prefersReducedMotion ? 0 : 0.2, ease: 'easeOut' },
        }}
        aria-hidden="true"
      />
      <motion.span
        className="absolute bottom-0 z-30 inline-flex min-w-0 items-center justify-center gap-1.5 truncate text-base leading-none"
        animate={{
          height: tabHeight,
          scale: textScale,
          width: tabWidth,
        }}
        style={{ left: index === 0 ? 'auto' : 0, right: index === 0 ? 0 : 'auto' }}
        transition={{
          height: prefersReducedMotion
            ? { duration: 0 }
            : { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 },
          scale: { duration: prefersReducedMotion ? 0 : 0.2, ease: 'easeOut' },
          width: { duration: prefersReducedMotion ? 0 : 0.2, ease: 'easeOut' },
        }}
      >
        {label}
      </motion.span>
    </TabsTrigger>
  );
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
      <Tabs value={activeTab} onValueChange={handleTabChange} className="flex-1 min-h-0">
        <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col px-4 pt-3 pb-4">
          <div className="relative flex shrink-0 items-end">
            <Separator className="w-auto min-w-0 flex-1" />
            <TabsList className="relative flex h-10 w-72 max-w-full items-end gap-0 rounded-none bg-transparent p-0 shadow-none">
              <ScheduledTaskTabTrigger
                value={SCHEDULED_TASK_TAB.Create}
                activeTab={activeTab}
                index={0}
                label={i18nService.t('scheduledTasksNewTab')}
                prefersReducedMotion={prefersReducedMotion}
              />
              <ScheduledTaskTabTrigger
                value={SCHEDULED_TASK_TAB.Tasks}
                activeTab={activeTab}
                index={1}
                label={i18nService.t('scheduledTasksTabTasks')}
                prefersReducedMotion={prefersReducedMotion}
              />
              <ScheduledTaskTabTrigger
                value={SCHEDULED_TASK_TAB.History}
                activeTab={activeTab}
                index={2}
                label={i18nService.t('scheduledTasksTabHistory')}
                prefersReducedMotion={prefersReducedMotion}
              />
            </TabsList>
            <Separator className="w-auto min-w-0 flex-1" />
          </div>

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
