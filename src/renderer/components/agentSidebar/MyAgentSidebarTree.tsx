import { Button } from '@shared/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@shared/components/ui/dialog';
import { DestructiveConfirmDialog } from '@shared/components/ui/destructive-confirm-dialog';
import { Input } from '@shared/components/ui/input';
import { Label } from '@shared/components/ui/label';
import { useReducedMotion } from 'motion/react';
import React, { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useDispatch } from 'react-redux';

import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { workspaceService } from '../../services/workspace';
import { store } from '../../store';
import {
  clearLoadingSessionId,
  setCurrentSession,
  setLoadingSessionId,
} from '../../store/slices/coworkSlice';
import { CoworkSessionStatusValue, type CoworkSessionSummary } from '../../types/cowork';
import { type CoworkOpenShareOptionsEventDetail, CoworkUiEvent } from '../cowork/constants';
import CreateProjectDialog from '../cowork/CreateProjectDialog';
import {
  AnimatedFolderPlusIcon,
  type AnimatedFolderPlusIconHandle,
} from '../icons/AnimatedFolderPlusIcon';
import type { AgentSidebarTaskNode, WorkspaceSidebarNode } from './types';
import { useWorkspaceSidebarState } from './useWorkspaceSidebarState';
import WorkspaceTreeNode from './WorkspaceTreeNode';

interface MyAgentSidebarTreeProps {
  isBatchMode: boolean;
  selectedIds: Set<string>;
  recentlyDeletedSessionIds: string[];
  onShowCowork: () => void;
  onToggleSelection: (sessionId: string) => void;
  onEnterBatchMode: (sessionId: string) => void;
  onVisibleSessionsChange?: (ids: string[]) => void;
  onDismissSearch?: () => void;
  workMode?: 'work' | 'chat';
  searchQuery?: string;
  searchCorpus?: CoworkSessionSummary[];
}

const MyAgentSidebarTree: React.FC<MyAgentSidebarTreeProps> = ({
  isBatchMode,
  selectedIds,
  recentlyDeletedSessionIds,
  onShowCowork,
  onToggleSelection,
  onEnterBatchMode,
  onVisibleSessionsChange,
  onDismissSearch,
  workMode = 'work',
  searchQuery = '',
  searchCorpus = [],
}) => {
  const dispatch = useDispatch();
  const {
    workspaceNodes,
    scheduledWorkspaceNodes,
    patchTaskPreview,
    removeTaskPreview,
    retryLoadTasks,
    retryLoadScheduledTasks,
    loadMoreTasks,
    loadMoreScheduledTasks,
    collapseTasks,
    collapseScheduledTasks,
    toggleExpanded,
    toggleScheduledExpanded,
  } = useWorkspaceSidebarState(workMode, searchQuery, searchCorpus);

  useEffect(() => {
    onVisibleSessionsChange?.([
      ...workspaceNodes.flatMap(workspace => workspace.tasks.map(task => task.id)),
      ...scheduledWorkspaceNodes.flatMap(workspace => workspace.tasks.map(task => task.id)),
    ]);
  }, [onVisibleSessionsChange, scheduledWorkspaceNodes, workspaceNodes]);

  useEffect(() => {
    for (const sessionId of recentlyDeletedSessionIds) {
      removeTaskPreview(sessionId);
    }
  }, [recentlyDeletedSessionIds, removeTaskPreview]);

  const handleSelectTask = async (task: AgentSidebarTaskNode) => {
    flushSync(() => {
      dispatch(setLoadingSessionId(task.id));
    });
    try {
      if (task.workspaceId) {
        await workspaceService.selectWorkspace(task.workspaceId, { preserveSessionLoading: true });
      }

      // Restore the live streaming snapshot immediately so the stream stays
      // visible when switching back to a running session across workspaces.
      // Only restore when the task summary still reports running, preventing a
      // stale snapshot from overriding a completed session after reload.
      const streamingSnapshot = store.getState().cowork.streamingSessions[task.id];
      if (streamingSnapshot && task.status === CoworkSessionStatusValue.Running) {
        dispatch(setCurrentSession(streamingSnapshot));
      }

      onShowCowork();
      onDismissSearch?.();
      await coworkService.loadSession(task.id);
    } finally {
      dispatch(clearLoadingSessionId(task.id));
    }
  };

  const handleCreateTask = async (workspace: WorkspaceSidebarNode) => {
    await workspaceService.selectWorkspace(workspace.id);
    coworkService.clearSession();
    onShowCowork();
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('cowork:focus-input', { detail: { clear: false } }));
    }, 0);
  };

  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const folderPlusIconRef = useRef<AnimatedFolderPlusIconHandle>(null);
  const prefersReducedMotion = useReducedMotion();
  const [workspacePendingRemoval, setWorkspacePendingRemoval] =
    useState<WorkspaceSidebarNode | null>(null);
  const [workspacePendingRename, setWorkspacePendingRename] = useState<WorkspaceSidebarNode | null>(
    null,
  );
  const [workspaceRenameValue, setWorkspaceRenameValue] = useState('');

  const handleConfirmRemoveWorkspace = async () => {
    const workspace = workspacePendingRemoval;
    setWorkspacePendingRemoval(null);
    if (!workspace) return;
    await workspaceService.deleteWorkspace(workspace.id);
  };

  const handleRenameWorkspace = (workspace: WorkspaceSidebarNode) => {
    setWorkspaceRenameValue(workspace.name);
    setWorkspacePendingRename(workspace);
  };

  const handleToggleWorkspacePin = async (workspace: WorkspaceSidebarNode, pinned: boolean) => {
    await workspaceService.toggleWorkspacePin(workspace.id, pinned);
  };

  const handleConfirmRenameWorkspace = async () => {
    const workspace = workspacePendingRename;
    const name = workspaceRenameValue.trim();
    if (!workspace || !name) return;

    const renamedWorkspace = await workspaceService.renameWorkspace(workspace.id, name);
    if (!renamedWorkspace) {
      window.dispatchEvent(
        new CustomEvent('app:showToast', { detail: i18nService.t('renameProjectFailed') }),
      );
      return;
    }
    setWorkspacePendingRename(null);
  };

  const handleCreateWorkspace = () => {
    // Align with 「进入项目工作 → 新建空白项目」: open the create-project
    // dialog instead of the native directory picker.
    setIsCreateProjectOpen(true);
  };

  const handleProjectCreated = async (projectPath: string) => {
    const workspace = await workspaceService.ensureWorkspace(projectPath);
    if (workspace) await workspaceService.selectWorkspace(workspace.id);
  };

  const handleDeleteTask = async (task: AgentSidebarTaskNode) => {
    if (await coworkService.deleteSession(task.id)) removeTaskPreview(task.id);
  };

  const handleToggleTaskPin = async (task: AgentSidebarTaskNode, pinned: boolean) => {
    const result = await coworkService.setSessionPinned(task.id, pinned);
    if (result.success) patchTaskPreview(task.id, { pinned, pinOrder: result.pinOrder });
  };

  const handleRenameTask = async (task: AgentSidebarTaskNode, title: string) => {
    if (await coworkService.renameSession(task.id, title)) patchTaskPreview(task.id, { title });
  };

  const handleShareTask = async (task: AgentSidebarTaskNode) => {
    await handleSelectTask(task);
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent<CoworkOpenShareOptionsEventDetail>(CoworkUiEvent.OpenShareOptions, {
          detail: { sessionId: task.id },
        }),
      );
    }, 0);
  };

  return (
    <div className="pb-3" role="tree" aria-label={i18nService.t('workspaces')}>
      <CreateProjectDialog
        open={isCreateProjectOpen}
        onOpenChange={setIsCreateProjectOpen}
        onCreated={path => void handleProjectCreated(path)}
      />
      <DestructiveConfirmDialog
        open={workspacePendingRemoval !== null}
        title={i18nService.t('removeProjectDialogTitle')}
        description={i18nService.t('removeProjectDialogDescription')}
        cancelLabel={i18nService.t('cancel')}
        confirmLabel={i18nService.t('removeProject')}
        onCancel={() => setWorkspacePendingRemoval(null)}
        onConfirm={() => void handleConfirmRemoveWorkspace()}
      />
      <Dialog
        open={workspacePendingRename !== null}
        onOpenChange={open => {
          if (!open) setWorkspacePendingRename(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <h2 className="text-base font-semibold">{i18nService.t('renameProject')}</h2>
          <div className="space-y-2">
            <Label htmlFor="workspace-rename">{i18nService.t('projectNameLabel')}</Label>
            <Input
              id="workspace-rename"
              value={workspaceRenameValue}
              onChange={event => setWorkspaceRenameValue(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') void handleConfirmRenameWorkspace();
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWorkspacePendingRename(null)}>
              {i18nService.t('cancel')}
            </Button>
            <Button onClick={() => void handleConfirmRenameWorkspace()}>
              {i18nService.t('renameProject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="sticky top-0 z-30 flex h-9 items-center justify-between bg-surface-raised px-1.5">
        <h2 className="min-w-0 truncate text-sm font-normal text-muted-foreground">
          {i18nService.t('workspaces')}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => void handleCreateWorkspace()}
          onMouseEnter={() => {
            if (!prefersReducedMotion) folderPlusIconRef.current?.startAnimation();
          }}
          onMouseLeave={() => folderPlusIconRef.current?.stopAnimation()}
          className="theme-action-muted"
          aria-label={i18nService.t('workspaceAdd')}
        >
          <AnimatedFolderPlusIcon ref={folderPlusIconRef} />
        </Button>
      </div>

      {workspaceNodes.length === 0 ? (
        <div className="px-3 py-6 text-center">
          <p className="text-xs font-medium text-muted-foreground">
            {i18nService.t('workspaceNoWorkspaces')}
          </p>
          <Button
            type="button"
            onClick={() => void handleCreateWorkspace()}
            className="theme-page-my-agent-sidebar-tree-button-1 mt-3"
          >
            {i18nService.t('workspaceAdd')}
          </Button>
        </div>
      ) : (
        <div className="space-y-0.5 px-0">
          {workspaceNodes.map(workspace => (
            <WorkspaceTreeNode
              key={workspace.id}
              workspace={workspace}
              isBatchMode={isBatchMode}
              selectedIds={selectedIds}
              onToggleExpanded={toggleExpanded}
              onCreateTask={selectedWorkspace => void handleCreateTask(selectedWorkspace)}
              onRenameWorkspace={handleRenameWorkspace}
              onToggleWorkspacePin={handleToggleWorkspacePin}
              onRemoveWorkspace={selectedWorkspace => setWorkspacePendingRemoval(selectedWorkspace)}
              onRetryLoadTasks={workspaceId => void retryLoadTasks(workspaceId)}
              onLoadMoreTasks={workspaceId => void loadMoreTasks(workspaceId)}
              onCollapseTasks={collapseTasks}
              onSelectTask={task => void handleSelectTask(task)}
              onDeleteTask={handleDeleteTask}
              onShareTask={handleShareTask}
              onToggleTaskPin={handleToggleTaskPin}
              onRenameTask={handleRenameTask}
              onToggleSelection={onToggleSelection}
              onEnterBatchMode={task => onEnterBatchMode(task.id)}
            />
          ))}
        </div>
      )}

      {workMode === 'work' && (
        <div className="mt-3 flex flex-col gap-0.5">
          <div className="flex h-10 items-center bg-surface-raised px-1.5">
            <h2 className="min-w-0 truncate text-sm font-normal text-muted-foreground">
              {i18nService.t('scheduledTasks')}
            </h2>
          </div>

          {scheduledWorkspaceNodes.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground">
              {i18nService.t('scheduledTasksEmptyState')}
            </div>
          ) : (
            <div className="flex flex-col gap-0.5 px-0">
              {scheduledWorkspaceNodes.map(workspace => (
                <WorkspaceTreeNode
                  key={`scheduled-${workspace.id}`}
                  workspace={workspace}
                  isBatchMode={isBatchMode}
                  selectedIds={selectedIds}
                  onToggleExpanded={toggleScheduledExpanded}
                  onCreateTask={() => undefined}
                  onRemoveWorkspace={selectedWorkspace =>
                    setWorkspacePendingRemoval(selectedWorkspace)
                  }
                  onRetryLoadTasks={workspaceId => void retryLoadScheduledTasks(workspaceId)}
                  onLoadMoreTasks={workspaceId => void loadMoreScheduledTasks(workspaceId)}
                  onCollapseTasks={collapseScheduledTasks}
                  onSelectTask={task => void handleSelectTask(task)}
                  onDeleteTask={handleDeleteTask}
                  onShareTask={handleShareTask}
                  onToggleTaskPin={handleToggleTaskPin}
                  onRenameTask={handleRenameTask}
                  onToggleSelection={onToggleSelection}
                  onEnterBatchMode={task => onEnterBatchMode(task.id)}
                  showCreateTask={false}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MyAgentSidebarTree;
