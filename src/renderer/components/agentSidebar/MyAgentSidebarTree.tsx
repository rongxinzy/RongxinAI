import { Button } from '@shared/components/ui/button';
import { FolderPlus } from 'lucide-react';
import React, { useEffect } from 'react';
import { flushSync } from 'react-dom';
import { useDispatch } from 'react-redux';

import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { workspaceService } from '../../services/workspace';
import { clearLoadingSessionId, setLoadingSessionId } from '../../store/slices/coworkSlice';
import { type CoworkOpenShareOptionsEventDetail, CoworkUiEvent } from '../cowork/constants';
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
  workMode?: 'work' | 'chat';
}

const MyAgentSidebarTree: React.FC<MyAgentSidebarTreeProps> = ({
  isBatchMode,
  selectedIds,
  recentlyDeletedSessionIds,
  onShowCowork,
  onToggleSelection,
  onEnterBatchMode,
  onVisibleSessionsChange,
  workMode = 'work',
}) => {
  const dispatch = useDispatch();
  const {
    workspaceNodes,
    scheduledWorkspaceNodes,
    patchTaskPreview,
    removeTaskPreview,
    retryLoadTasks,
    loadMoreTasks,
    loadMoreScheduledTasks,
    collapseTasks,
    collapseScheduledTasks,
    toggleExpanded,
    toggleScheduledExpanded,
  } = useWorkspaceSidebarState(workMode);

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
      onShowCowork();
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

  const handleCreateWorkspace = async () => {
    const result = await window.electron.dialog.selectDirectory();
    if (!result.success || !result.path) return;
    const workspace = await workspaceService.ensureWorkspace(result.path);
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
      <div className="sticky top-0 z-30 flex h-10 items-center justify-between bg-surface-raised px-1.5">
        <h2 className="min-w-0 truncate text-[14px] font-normal text-foreground opacity-[0.28]">
          {i18nService.t('workspaces')}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => void handleCreateWorkspace()}
          className="text-foreground opacity-[0.34] hover:opacity-[0.5]"
          aria-label={i18nService.t('workspaceAdd')}
        >
          <FolderPlus className="size-4" />
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
            className="mt-3 h-auto px-3 py-1.5 text-xs"
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
            <h2 className="min-w-0 truncate text-[14px] font-normal text-foreground opacity-[0.28]">
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
                  onRetryLoadTasks={workspaceId => void retryLoadTasks(workspaceId)}
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
