import { Button } from '@shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import { cn } from '@shared/lib/utils';
import { useReducedMotion } from 'motion/react';
import { Ellipsis, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

import { i18nService } from '../../services/i18n';
import { isScratchWorkspacePath } from '../../utils/path';
import AgentTaskRow from './AgentTaskRow';
import ExpandAgentTasksRow from './ExpandAgentTasksRow';
import {
  AnimatedFolderOpenIcon,
  type AnimatedFolderOpenIconHandle,
} from '../icons/AnimatedFolderOpenIcon';
import {
  SidebarAnimatedMessageCirclePlusIcon,
  type SidebarAnimatedMessageCirclePlusIconHandle,
} from '../icons/SidebarAnimatedMessageCirclePlusIcon';
import type { AgentSidebarTaskNode, WorkspaceSidebarNode } from './types';

interface WorkspaceTreeNodeProps {
  workspace: WorkspaceSidebarNode;
  isBatchMode: boolean;
  selectedIds: Set<string>;
  onToggleExpanded: (workspaceId: string) => void;
  onCreateTask: (workspace: WorkspaceSidebarNode) => void;
  onRenameWorkspace?: (workspace: WorkspaceSidebarNode) => void;
  onRemoveWorkspace?: (workspace: WorkspaceSidebarNode) => void;
  onToggleWorkspacePin?: (workspace: WorkspaceSidebarNode, pinned: boolean) => Promise<void>;
  onRetryLoadTasks: (workspaceId: string) => void;
  onLoadMoreTasks: (workspaceId: string) => void;
  onCollapseTasks: (workspaceId: string) => void;
  onSelectTask: (task: AgentSidebarTaskNode) => void;
  onDeleteTask: (task: AgentSidebarTaskNode) => Promise<void>;
  onShareTask: (task: AgentSidebarTaskNode) => Promise<void>;
  onToggleTaskPin: (task: AgentSidebarTaskNode, pinned: boolean) => Promise<void>;
  onRenameTask: (task: AgentSidebarTaskNode, title: string) => Promise<void>;
  onToggleSelection: (sessionId: string) => void;
  onEnterBatchMode: (task: AgentSidebarTaskNode) => void;
  showCreateTask?: boolean;
}

const TASKS_TRANSITION_MS = 200;

const WorkspaceTreeNode: React.FC<WorkspaceTreeNodeProps> = ({
  workspace,
  isBatchMode,
  selectedIds,
  onToggleExpanded,
  onCreateTask,
  onRenameWorkspace,
  onRemoveWorkspace,
  onToggleWorkspacePin,
  onRetryLoadTasks,
  onLoadMoreTasks,
  onCollapseTasks,
  onSelectTask,
  onDeleteTask,
  onShareTask,
  onToggleTaskPin,
  onRenameTask,
  onToggleSelection,
  onEnterBatchMode,
  showCreateTask = true,
}) => {
  const [shouldRenderTasks, setShouldRenderTasks] = useState(workspace.isExpanded);
  const [isTaskGroupVisible, setIsTaskGroupVisible] = useState(workspace.isExpanded);
  const [menuOpen, setMenuOpen] = useState(false);
  const folderIconRef = useRef<AnimatedFolderOpenIconHandle>(null);
  const createTaskIconRef = useRef<SidebarAnimatedMessageCirclePlusIconHandle>(null);
  const prefersReducedMotion = useReducedMotion();
  const previousExpandedRef = useRef(workspace.isExpanded);
  const canRemove =
    typeof onRemoveWorkspace === 'function' && !isScratchWorkspacePath(workspace.path);
  const canRename =
    typeof onRenameWorkspace === 'function' && !isScratchWorkspacePath(workspace.path);
  const canManage = canRemove || canRename;

  useEffect(() => {
    let frame = 0;
    let timeout = 0;
    const wasExpanded = previousExpandedRef.current;
    previousExpandedRef.current = workspace.isExpanded;
    if (wasExpanded === workspace.isExpanded) return;
    if (workspace.isExpanded) {
      setShouldRenderTasks(true);
      setIsTaskGroupVisible(false);
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => setIsTaskGroupVisible(true));
      });
    } else {
      setIsTaskGroupVisible(false);
      timeout = window.setTimeout(() => setShouldRenderTasks(false), TASKS_TRANSITION_MS);
    }
    return () => {
      if (frame) cancelAnimationFrame(frame);
      if (timeout) window.clearTimeout(timeout);
    };
  }, [workspace.isExpanded]);

  return (
    <div className="space-y-0.5">
      <div
        data-slot="workspace-tree-row"
        className="sidebar-interactive-surface group sticky top-0 z-20 ml-[-6px] flex h-7 w-[calc(100%+12px)] items-center rounded-md transition-colors hover:shadow-subtle"
      >
        <Button
          variant="ghost"
          className="h-full min-w-0 flex-1 justify-start gap-2 rounded-md py-0 pl-3 pr-2 text-left text-sm font-normal text-foreground hover:bg-transparent aria-expanded:bg-transparent"
          onClick={() => onToggleExpanded(workspace.id)}
          onMouseEnter={() => {
            if (!prefersReducedMotion) folderIconRef.current?.startAnimation();
          }}
          onMouseLeave={() => folderIconRef.current?.stopAnimation()}
          role="treeitem"
          aria-level={1}
          aria-expanded={workspace.isExpanded}
        >
          <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
            <AnimatedFolderOpenIcon ref={folderIconRef} />
          </span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground" title={workspace.path}>
            {workspace.name}
          </span>
        </Button>
        <div className="flex h-7 shrink-0 items-center gap-0.5 pr-1.5">
          {showCreateTask && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onCreateTask(workspace)}
              onMouseEnter={() => {
                if (!prefersReducedMotion) createTaskIconRef.current?.startAnimation();
              }}
              onMouseLeave={() => createTaskIconRef.current?.stopAnimation()}
              className="text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground"
              aria-label={i18nService.t('myAgentSidebarNewTask')}
            >
              <SidebarAnimatedMessageCirclePlusIcon
                ref={createTaskIconRef}
                size={14}
                className="size-3.5"
              />
            </Button>
          )}
          {canManage && (
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className={cn(
                      'pointer-events-none opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-[0.3]',
                      menuOpen && 'pointer-events-auto opacity-[0.46]',
                    )}
                    aria-label={i18nService.t('workspaceActions')}
                  >
                    <Ellipsis />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="min-w-[124px]">
                {canRename && (
                  <DropdownMenuItem onClick={() => onRenameWorkspace(workspace)}>
                    <Pencil className="h-3.5 w-3.5" />
                    {i18nService.t('renameProject')}
                  </DropdownMenuItem>
                )}
                {onToggleWorkspacePin && (
                  <DropdownMenuItem
                    onClick={() => void onToggleWorkspacePin(workspace, !workspace.pinned)}
                  >
                    {workspace.pinned ? (
                      <PinOff className="h-3.5 w-3.5" />
                    ) : (
                      <Pin className="h-3.5 w-3.5" />
                    )}
                    {i18nService.t(workspace.pinned ? 'unpinProject' : 'pinProject')}
                  </DropdownMenuItem>
                )}
                {canRemove && (
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => onRemoveWorkspace?.(workspace)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {i18nService.t('removeProject')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {shouldRenderTasks && (
        <div
          className={`grid w-full min-w-0 max-w-full transition-[grid-template-rows,opacity] duration-200 ease-out ${isTaskGroupVisible ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
        >
          <div
            className={`min-h-0 min-w-0 max-w-full ${isTaskGroupVisible ? '' : 'pointer-events-none overflow-hidden'}`}
            role="group"
            aria-hidden={!workspace.isExpanded}
          >
            <div className="min-w-0 max-w-full space-y-0.5">
              {workspace.hasLoadError && workspace.tasks.length === 0 && (
                <Button
                  variant="ghost"
                  onClick={() => onRetryLoadTasks(workspace.id)}
                  className="ml-[-6px] flex h-7 w-[calc(100%+12px)] justify-start rounded-md pl-[38px] pr-2.5 text-sm font-normal text-destructive hover:bg-destructive/10"
                >
                  {i18nService.t('myAgentSidebarLoadFailed')}
                </Button>
              )}
              {workspace.isLoadingTasks && workspace.tasks.length === 0 && (
                <div className="ml-[-6px] flex h-7 w-[calc(100%+12px)] items-center pl-[38px] pr-2.5 text-sm text-muted-foreground">
                  {i18nService.t('loading')}
                </div>
              )}
              {!workspace.isLoadingTasks &&
                !workspace.hasLoadError &&
                workspace.tasks.length === 0 && (
                  <div className="ml-[-6px] flex h-7 w-[calc(100%+12px)] items-center pl-[38px] pr-2.5 text-sm text-muted-foreground">
                    {i18nService.t('myAgentSidebarNoTasks')}
                  </div>
                )}
              {workspace.tasks.map(task => (
                <AgentTaskRow
                  key={task.id}
                  task={task}
                  isBatchMode={isBatchMode}
                  isSelected={isBatchMode ? selectedIds.has(task.id) : task.isSelected}
                  showBatchOption
                  onSelect={() => onSelectTask(task)}
                  onDelete={() => onDeleteTask(task)}
                  onShare={() => onShareTask(task)}
                  onTogglePin={pinned => onToggleTaskPin(task, pinned)}
                  onRename={title => onRenameTask(task, title)}
                  onToggleSelection={() => onToggleSelection(task.id)}
                  onEnterBatchMode={() => onEnterBatchMode(task)}
                />
              ))}
              {workspace.canExpandTasks && (
                <ExpandAgentTasksRow
                  isLoading={workspace.isLoadingTasks}
                  label={i18nService.t('myAgentSidebarExpandMore')}
                  onClick={() => onLoadMoreTasks(workspace.id)}
                />
              )}
              {workspace.canCollapseTasks && (
                <ExpandAgentTasksRow
                  isLoading={false}
                  label={i18nService.t('myAgentSidebarCollapse')}
                  onClick={() => onCollapseTasks(workspace.id)}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkspaceTreeNode;
