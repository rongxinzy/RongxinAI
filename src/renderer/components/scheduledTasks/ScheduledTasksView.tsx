import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Spinner } from '@shared/components/ui/spinner';
import { cn } from '@shared/lib/utils';
import { CalendarClock, PanelLeftOpen } from 'lucide-react';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { SidebarAnimatedMessageCirclePlusIcon } from '../icons/SidebarAnimatedMessageCirclePlusIcon';
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

const AUTO_TAB = {
  Create: 'create',
  Tasks: 'tasks',
  History: 'history',
} as const;

type AutoTab = (typeof AUTO_TAB)[keyof typeof AUTO_TAB];

const AUTO_TAB_ORDER: AutoTab[] = [AUTO_TAB.Tasks, AUTO_TAB.Create, AUTO_TAB.History];

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
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);

  const [activeTab, setActiveTab] = useState<AutoTab>(AUTO_TAB.Tasks);
  const [deleteTaskInfo, setDeleteTaskInfo] = useState<{ id: string; name: string } | null>(null);

  // Directional pane slide: track previous tab to know which way to slide.
  // The first reveal fades in (direction-neutral) so entry never slides "backward";
  // every later switch slides from the side you are heading (left / right).
  const prevTabIndexRef = useRef(AUTO_TAB_ORDER.indexOf(AUTO_TAB.Tasks));
  const [mounted, setMounted] = useState(false);
  const tabDir: 'left' | 'right' | null = mounted
    ? AUTO_TAB_ORDER.indexOf(activeTab) >= prevTabIndexRef.current
      ? 'right'
      : 'left'
    : null;
  prevTabIndexRef.current = AUTO_TAB_ORDER.indexOf(activeTab);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Sliding underline indicator: measure the active tab button and translate a single bar.
  // The view can mount while a route ancestor is still hidden / mid-transform, so the first
  // measurement may read 0 — poll with rAF until the button has a real width (with a safety
  // timeout) so the bar never stays invisible. A ResizeObserver covers later width changes
  // (e.g. the count badge appearing/disappearing).
  const tabRefs = useRef<Record<string, HTMLElement | null>>({});
  const tabRowRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    let raf = 0;
    let timeout = 0;
    const measure = () => {
      const el = tabRefs.current[activeTab];
      if (el && el.offsetWidth > 0) {
        setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
        return true;
      }
      return false;
    };
    const poll = () => {
      if (measure()) return;
      raf = requestAnimationFrame(poll);
    };
    if (!measure()) {
      raf = requestAnimationFrame(poll);
      timeout = window.setTimeout(measure, 600);
    }
    const ro = new ResizeObserver(() => measure());
    if (tabRowRef.current) ro.observe(tabRowRef.current);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [activeTab, tasks.length]);

  // Create-task modal (template-prefilled or blank custom)
  const [createOpen, setCreateOpen] = useState(false);
  const [createPrefill, setCreatePrefill] = useState<TaskTemplateValues | undefined>();
  const [createFormKey, setCreateFormKey] = useState(0);

  // Task detail / edit modal, driven by mirroring redux selection
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [detailEdit, setDetailEdit] = useState(false);
  const detailTask = detailTaskId ? (tasks.find(t => t.id === detailTaskId) ?? null) : null;

  // Mirror redux selection (from TaskList card-click / dropdown edit) into the modal,
  // then clear the selection so list and modal stay decoupled.
  useEffect(() => {
    if (!selectedTaskId) return;
    if (viewMode === 'detail' || viewMode === 'edit') {
      setDetailTaskId(selectedTaskId);
      setDetailEdit(viewMode === 'edit');
      dispatch(selectTask(null));
      dispatch(setViewMode('list'));
    }
  }, [selectedTaskId, viewMode, dispatch]);

  const handleRequestDelete = useCallback((taskId: string, taskName: string) => {
    setDeleteTaskInfo({ id: taskId, name: taskName });
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTaskInfo) return;
    const taskId = deleteTaskInfo.id;
    setDeleteTaskInfo(null);
    await scheduledTaskService.deleteTask(taskId);
    if (detailTaskId === taskId) {
      setDetailTaskId(null);
      setDetailEdit(false);
    }
  }, [deleteTaskInfo, detailTaskId]);

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

  // WAI-ARIA tablist keyboard nav: ←/→ (and Home/End) move focus + activate with wrap,
  // so the sliding underline follows the keyboard as well as the pointer.
  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, value: AutoTab) => {
      const idx = AUTO_TAB_ORDER.indexOf(value);
      let next = -1;
      if (e.key === 'ArrowRight') next = (idx + 1) % AUTO_TAB_ORDER.length;
      else if (e.key === 'ArrowLeft')
        next = (idx - 1 + AUTO_TAB_ORDER.length) % AUTO_TAB_ORDER.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = AUTO_TAB_ORDER.length - 1;
      if (next < 0) return;
      e.preventDefault();
      const target = AUTO_TAB_ORDER[next];
      setActiveTab(target);
      tabRefs.current[target]?.focus();
    },
    [],
  );

  const handleCreateSaved = useCallback((newTaskId?: string) => {
    setCreateOpen(false);
    setCreatePrefill(undefined);
    setActiveTab(AUTO_TAB.Tasks);
    if (newTaskId) {
      setDetailTaskId(newTaskId);
      setDetailEdit(false);
    }
  }, []);

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
      {/* Header */}
      <div className="draggable flex h-12 shrink-0 items-center justify-between px-4">
        <div className="flex items-center gap-3 h-8">
          {isSidebarCollapsed && (
            <div className={`non-draggable flex items-center gap-1 ${isMac ? 'pl-[68px]' : ''}`}>
              <Button type="button" variant="ghost" size="icon" onClick={onToggleSidebar}>
                <PanelLeftOpen />
              </Button>
              <Button type="button" variant="ghost" size="icon" onClick={onNewChat}>
                <SidebarAnimatedMessageCirclePlusIcon />
              </Button>
              {updateBadge}
            </div>
          )}
        </div>
        <WindowTitleBar inline />
      </div>

      <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col px-8">
        {/* ── Hero ── */}
        <section className="animate-fade-in-up shrink-0 pt-8 pb-6">
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

        {/* ── Tab list on the divider line, with a sliding underline ── */}
        <div className="relative shrink-0 border-b border-border">
          <div ref={tabRowRef} role="tablist" className="flex items-center gap-6">
            {(
              [
                { value: AUTO_TAB.Tasks, label: i18nService.t('scheduledTasksTabTasks') },
                { value: AUTO_TAB.Create, label: i18nService.t('scheduledTasksNewTab') },
                { value: AUTO_TAB.History, label: i18nService.t('scheduledTasksTabHistory') },
              ] as const
            ).map(tab => {
              const active = activeTab === tab.value;
              return (
                <Button
                  key={tab.value}
                  variant="ghost"
                  ref={el => {
                    tabRefs.current[tab.value] = el;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setActiveTab(tab.value)}
                  onKeyDown={e => handleTabKeyDown(e, tab.value)}
                  className={cn(
                    'relative -mb-px h-auto gap-2 rounded-none border-b-2 border-transparent px-0 pb-2.5 hover:bg-transparent focus-visible:text-foreground active:translate-y-0 dark:hover:bg-transparent',
                    active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {tab.label}
                  {tab.value === AUTO_TAB.Tasks && tasks.length > 0 && (
                    <Badge variant="secondary">{tasks.length}</Badge>
                  )}
                </Button>
              );
            })}
          </div>
          <span
            aria-hidden
            className="absolute bottom-0 h-0.5 rounded-full bg-primary transition-[left,width] duration-300 ease-smooth"
            style={{
              left: indicator?.left ?? 0,
              width: indicator?.width ?? 0,
              opacity: indicator ? 1 : 0,
            }}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-stable">
          <div
            key={`${activeTab}-${tabDir ?? 'init'}`}
            className={cn(
              'min-h-full pt-6 pb-10',
              tabDir === 'right'
                ? 'animate-slide-in-right'
                : tabDir === 'left'
                  ? 'animate-slide-in-left'
                  : 'animate-fade-in',
            )}
          >
            {activeTab === AUTO_TAB.Create && (
              <TaskTemplateGallery
                onSelectTemplate={values => openCreateModal(values)}
                onCustom={() => openCreateModal(undefined)}
              />
            )}

            {activeTab === AUTO_TAB.Tasks && <TaskList onRequestDelete={handleRequestDelete} />}

            {activeTab === AUTO_TAB.History && <AllRunsHistory />}
          </div>
        </div>
      </div>

      {/* Create-task modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
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

      {/* Task detail / edit modal */}
      <Dialog
        open={detailTask !== null}
        onOpenChange={open => {
          if (!open) {
            setDetailTaskId(null);
            setDetailEdit(false);
          }
        }}
      >
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="sr-only">
            <DialogTitle>{detailTask?.name ?? i18nService.t('scheduledTasksTitle')}</DialogTitle>
            <DialogDescription>{detailTask?.name ?? ''}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-b-xl px-4 pt-9">
            {detailTask &&
              (detailEdit ? (
                <TaskForm
                  mode="edit"
                  task={detailTask}
                  onCancel={() => setDetailEdit(false)}
                  onSaved={() => setDetailEdit(false)}
                  onDirtyChange={() => {}}
                />
              ) : (
                <TaskDetail task={detailTask} onRequestDelete={handleRequestDelete} />
              ))}
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
