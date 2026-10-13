import { Button } from '@shared/components/ui/button';
import { DestructiveConfirmDialog } from '@shared/components/ui/destructive-confirm-dialog';
import { FolderPlus } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';

import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { workspaceService } from '../../services/workspace';
import { store, type RootState } from '../../store';
import {
  selectCoworkSessions,
  selectCurrentSessionId,
} from '../../store/selectors/coworkSelectors';
import {
  clearLoadingSessionId,
  setCurrentSession,
  setLoadingSessionId,
} from '../../store/slices/coworkSlice';
import type { CoworkSessionSummary } from '../../types/cowork';
import { type CoworkOpenShareOptionsEventDetail, CoworkUiEvent } from '../cowork/constants';
import CreateProjectDialog from '../cowork/CreateProjectDialog';
import { isProjectWorkspaceActive, isSectionWorkspaceActive } from './activeWorkspace';
import EditProjectDialog from './EditProjectDialog';
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
  /** Folder action in the automation section: create a task in that folder. */
  onCreateScheduledTask?: (workspace: WorkspaceSidebarNode) => void;
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
  onCreateScheduledTask,
  workMode = 'work',
  searchQuery = '',
  searchCorpus = [],
}) => {
  const dispatch = useDispatch();
  const currentWorkspaceId = useSelector((state: RootState) => state.workspace.currentWorkspaceId);
  const currentSessionId = useSelector(selectCurrentSessionId);
  const sessions = useSelector(selectCoworkSessions);
  const currentSession = useMemo(
    () => sessions.find(session => session.id === currentSessionId) ?? null,
    [sessions, currentSessionId],
  );
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
      // The snapshot exists only while the Pi event stream is registered as live.
      const streamingSnapshot = store.getState().cowork.streamingSessions[task.id];
      if (streamingSnapshot) {
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

  // 点击左侧项目：右侧切换到该项目工作区；再点当前项目则折叠/展开
  const handleSelectWorkspace = async (workspace: WorkspaceSidebarNode) => {
    const previousId = store.getState().workspace.currentWorkspaceId;
    const isCurrent = previousId === workspace.id;
    if (isCurrent) {
      toggleExpanded(workspace.id);
      return;
    }
    await workspaceService.selectWorkspace(workspace.id);
    if (!workspace.isExpanded) {
      toggleExpanded(workspace.id);
    }
    coworkService.clearSession();
    onShowCowork();
    onDismissSearch?.();
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('cowork:focus-input', { detail: { clear: false } }));
    }, 0);
  };

  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const [workspacePendingRemoval, setWorkspacePendingRemoval] =
    useState<WorkspaceSidebarNode | null>(null);
  const [workspacePendingEdit, setWorkspacePendingEdit] = useState<WorkspaceSidebarNode | null>(
    null,
  );

  const handleConfirmRemoveWorkspace = async () => {
    const workspace = workspacePendingRemoval;
    setWorkspacePendingRemoval(null);
    if (!workspace) return;
    await workspaceService.deleteWorkspace(workspace.id);
  };

  const handleEditWorkspace = (workspace: WorkspaceSidebarNode) => {
    setWorkspacePendingEdit(workspace);
  };

  const handleSaveWorkspace = async (
    id: string,
    values: { name: string; folders: string[] },
  ): Promise<boolean> => {
    const updated = await workspaceService.updateWorkspace({
      id,
      name: values.name,
      folders: values.folders,
    });
    if (!updated) {
      window.dispatchEvent(
        new CustomEvent('app:showToast', { detail: i18nService.t('editProjectFailed') }),
      );
      return false;
    }
    return true;
  };

  const handleToggleWorkspacePin = async (workspace: WorkspaceSidebarNode, pinned: boolean) => {
    await workspaceService.toggleWorkspacePin(workspace.id, pinned);
  };

  const handleCreateWorkspace = () => {
    // Align with 「进入项目工作 → 新建空白项目」: open the create-project
    // dialog instead of the native directory picker.
    setIsCreateProjectOpen(true);
  };

  const handleProjectCreated = async (projectPath: string, projectName: string) => {
    const workspace = await workspaceService.createWorkspace(projectPath, projectName);
    if (!workspace) return false;
    await workspaceService.selectWorkspace(workspace.id);
    return true;
  };

  const handleDeleteTask = async (task: AgentSidebarTaskNode) => {
    if (await coworkService.deleteSession(task.id)) removeTaskPreview(task.id);
  };

  const handleToggleTaskPin = async (task: AgentSidebarTaskNode, pinned: boolean) => {
    const result = await coworkService.setSessionPinned(task.id, pinned);
    if (result.success) patchTaskPreview(task.id, { pinned, pinOrder: result.pinOrder });
  };

  const handleRenameTask = async (task: AgentSidebarTaskNode, title: string) => {
    const renamedTitle = await coworkService.renameSession(task.id, title);
    if (renamedTitle) patchTaskPreview(task.id, { title: renamedTitle });
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
        onCreated={handleProjectCreated}
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
      <EditProjectDialog
        workspace={workspacePendingEdit}
        open={workspacePendingEdit !== null}
        onOpenChange={open => {
          if (!open) setWorkspacePendingEdit(null);
        }}
        onSave={handleSaveWorkspace}
        onRemove={workspace => setWorkspacePendingRemoval(workspace)}
      />
      <div className="theme-sidebar-section sticky top-0 z-30 flex items-center justify-between">
        <h2 className="min-w-0 truncate">{i18nService.t('workspaces')}</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => void handleCreateWorkspace()}
          className="theme-action-muted"
          aria-label={i18nService.t('workspaceAdd')}
        >
          <FolderPlus className="size-4" strokeWidth={1.75} />
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
              isActiveWorkspace={isProjectWorkspaceActive(
                currentSession,
                workspace.id,
                currentWorkspaceId,
              )}
              onToggleExpanded={toggleExpanded}
              onSelectWorkspace={selectedWorkspace => void handleSelectWorkspace(selectedWorkspace)}
              onCreateTask={selectedWorkspace => void handleCreateTask(selectedWorkspace)}
              onEditWorkspace={handleEditWorkspace}
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
          <div className="theme-sidebar-section flex items-center">
            <h2 className="min-w-0 truncate">{i18nService.t('scheduledTasks')}</h2>
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
                  isActiveWorkspace={isSectionWorkspaceActive(currentSession, workspace.id, true)}
                  isBatchMode={isBatchMode}
                  selectedIds={selectedIds}
                  onToggleExpanded={toggleScheduledExpanded}
                  onCreateTask={selectedWorkspace => onCreateScheduledTask?.(selectedWorkspace)}
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
                  showCreateTask={Boolean(onCreateScheduledTask)}
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
