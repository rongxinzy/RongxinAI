import { Button } from '@shared/components/ui/button';
import { DestructiveConfirmDialog } from '@shared/components/ui/destructive-confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import { cn } from '@shared/lib/utils';
import { Ellipsis, Folder, Settings2, Trash2 } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  CodingLaneStatus,
  type CodingAgentProfile,
  type CodingSessionSummary,
  type CodingWorkspaceSummary,
} from '../../../shared/codingAgent';
import { reportAppError } from '../../services/appErrorText';
import { showAppError, showAppToast } from '../../services/appToast';
import { i18nService } from '../../services/i18n';
import { getWorkspaceDisplayName } from '../../utils/path';
import {
  AnimatedFolderOpenIcon,
  type AnimatedFolderOpenIconHandle,
} from '../icons/AnimatedFolderOpenIcon';
import {
  AnimatedFolderPlusIcon,
  type AnimatedFolderPlusIconHandle,
} from '../icons/AnimatedFolderPlusIcon';
import {
  SidebarAnimatedMessageCirclePlusIcon,
  type SidebarAnimatedMessageCirclePlusIconHandle,
} from '../icons/SidebarAnimatedMessageCirclePlusIcon';
import { CodingUiEvent, type CodingCreateSessionEventDetail } from './constants';
import { CodingWorkspaceDialog } from './CodingWorkspaceDialog';
import { resolveReadyDefaultProfileId } from './codingSessionDraft';

export interface CodingSessionDraft {
  id: string;
  workspaceId: string;
  sourceRoot: string;
  profileId: string;
  modelOverride: string | null;
  sources: CodingWorkspaceSummary['sources'];
}

export interface CodingSidebarSelection {
  workspaceId: string | null;
  workspaceRoot: string;
  laneId: string | null;
  draft: CodingSessionDraft | null;
}

interface CodingWorkspaceSidebarProps {
  selection: CodingSidebarSelection;
  onSelectionChange: (selection: CodingSidebarSelection) => void;
}

const statusClassName: Record<CodingLaneStatus, string> = {
  [CodingLaneStatus.Idle]: 'bg-muted-foreground/40',
  [CodingLaneStatus.Running]: 'bg-primary',
  [CodingLaneStatus.WaitingApproval]: 'bg-warning',
  [CodingLaneStatus.WaitingElicitation]: 'bg-warning',
  [CodingLaneStatus.NeedsAuth]: 'bg-warning',
  [CodingLaneStatus.Disconnected]: 'bg-destructive',
  [CodingLaneStatus.Completed]: 'bg-success',
  [CodingLaneStatus.Failed]: 'bg-destructive',
};

const SESSIONS_TRANSITION_MS = 200;

export const CodingWorkspaceSidebar = ({
  selection,
  onSelectionChange,
}: CodingWorkspaceSidebarProps) => {
  const [workspaces, setWorkspaces] = useState<CodingWorkspaceSummary[]>([]);
  const [profiles, setProfiles] = useState<CodingAgentProfile[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const expansionInitialized = useRef(false);
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
  const [editingWorkspace, setEditingWorkspace] = useState<CodingWorkspaceSummary | null>(null);
  const [removingWorkspace, setRemovingWorkspace] = useState<CodingWorkspaceSummary | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [removingSession, setRemovingSession] = useState<{
    workspace: CodingWorkspaceSummary;
    session: CodingSessionSummary;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const addWorkspaceIconRef = useRef<AnimatedFolderPlusIconHandle>(null);
  const prefersReducedMotion = useReducedMotion();
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const applyWorkspaces = useCallback(
    (next: CodingWorkspaceSummary[]) => {
      // Mutation responses can arrive after the user selects another workspace.
      const selection = selectionRef.current;
      setWorkspaces(next);
      // An empty set also means the user deliberately collapsed every folder.
      if (!expansionInitialized.current && next.length > 0) {
        expansionInitialized.current = true;
        setExpandedIds(new Set(next.map(workspace => workspace.id)));
      }
      const selected = next.find(workspace => workspace.id === selection.workspaceId);
      if (selected) {
        if (selection.draft?.workspaceId === selected.id) return;
        const laneId = selected.sessions.some(session => session.id === selection.laneId)
          ? selection.laneId
          : selected.activeSessionId;
        if (selected.primaryRoot !== selection.workspaceRoot || laneId !== selection.laneId) {
          onSelectionChange({
            workspaceId: selected.id,
            workspaceRoot: selected.primaryRoot,
            laneId,
            draft: null,
          });
        }
        return;
      }
      const fallback = next[0];
      onSelectionChange(
        fallback
          ? {
              workspaceId: fallback.id,
              workspaceRoot: fallback.primaryRoot,
              laneId: fallback.activeSessionId,
              draft: null,
            }
          : { workspaceId: null, workspaceRoot: '', laneId: null, draft: null },
      );
    },
    [onSelectionChange],
  );

  const refreshSequence = useRef(0);
  const invalidateRefresh = useCallback(() => {
    ++refreshSequence.current;
  }, []);
  const refresh = useCallback(async () => {
    const request = ++refreshSequence.current;
    const [workspaceResult, profileResult] = await Promise.all([
      window.electron.codingAgent.listWorkspaces(),
      window.electron.codingAgent.listProfiles(),
    ]);
    if (request !== refreshSequence.current) return;
    if (workspaceResult.success && workspaceResult.workspaces) {
      applyWorkspaces(workspaceResult.workspaces);
    } else {
      showAppError(workspaceResult.error, 'codingAgentActionFailed');
    }
    if (profileResult.success && profileResult.profiles) setProfiles(profileResult.profiles);
  }, [applyWorkspaces]);

  useEffect(() => {
    void refresh();
    const unsubscribe = window.electron.codingAgent.onChanged(snapshot => {
      if (snapshot.room.workspaceRoot === selection.workspaceRoot) {
        setProfiles(snapshot.profiles);
      }
      void refresh();
    });
    return () => {
      invalidateRefresh();
      unsubscribe();
    };
  }, [invalidateRefresh, refresh, selection.workspaceRoot]);

  const startSession = (workspace: CodingWorkspaceSummary, profileId?: string) => {
    setExpandedIds(current => new Set(current).add(workspace.id));
    const detail: CodingCreateSessionEventDetail = profileId
      ? { workspace, profileId }
      : { workspace };
    window.dispatchEvent(
      new CustomEvent<CodingCreateSessionEventDetail>(CodingUiEvent.CreateSession, { detail }),
    );
  };

  const saveWorkspace = async (input: {
    name: string;
    sourceFolders: string[];
    defaultProfileId: string;
  }) => {
    setError(null);
    const result = editingWorkspace
      ? await window.electron.codingAgent.updateWorkspace({
          workspaceId: editingWorkspace.id,
          ...input,
        })
      : await window.electron.codingAgent.createWorkspace(input);
    if (!result.success || !result.workspaces) {
      setError(reportAppError(result.error, 'codingAgentActionFailed'));
      return false;
    }
    applyWorkspaces(result.workspaces);
    const wasCreate = !editingWorkspace;
    const saved = editingWorkspace
      ? result.workspaces.find(workspace => workspace.id === editingWorkspace.id)
      : result.workspaces.find(workspace => workspace.primaryRoot === input.sourceFolders[0]);
    if (saved) {
      setExpandedIds(current => new Set(current).add(saved.id));
      onSelectionChange({
        workspaceId: saved.id,
        workspaceRoot: saved.primaryRoot,
        laneId: saved.activeSessionId,
        draft: null,
      });
      // 新建工作区时默认 Agent 已在对话框里选定：可用就直接进入会话草稿；
      // 不可用则提示并退回选择框。等 selection 落稳再执行，避免被 selectionKey 变化打断。
      if (wasCreate) {
        const readyProfileId = resolveReadyDefaultProfileId(profiles, saved.defaultProfileId);
        window.setTimeout(() => {
          startSession(saved, readyProfileId ?? undefined);
          if (!readyProfileId) {
            showAppToast(i18nService.t('codingWorkspaceDefaultAgentUnavailable'), {
              isError: true,
            });
          }
        }, 0);
      }
    }
    setEditingWorkspace(null);
    return true;
  };

  const removeWorkspace = async () => {
    if (!removingWorkspace || isRemoving) return;
    setIsRemoving(true);
    try {
      const result = await window.electron.codingAgent.deleteWorkspace(removingWorkspace.id);
      if (!result.success || !result.workspaces) {
        showAppError(result.error, 'codingAgentActionFailed');
        return;
      }
      setRemovingWorkspace(null);
      applyWorkspaces(result.workspaces);
    } catch (error) {
      showAppError(error, 'codingAgentActionFailed');
    } finally {
      setIsRemoving(false);
    }
  };

  const removeSession = async () => {
    if (!removingSession || isRemoving) return;
    setIsRemoving(true);
    try {
      const result = await window.electron.codingAgent.deleteSession({
        workspaceRoot: removingSession.workspace.primaryRoot,
        laneId: removingSession.session.id,
      });
      if (!result.success || !result.workspaces) {
        showAppError(result.error, 'codingAgentActionFailed');
        return;
      }
      setRemovingSession(null);
      applyWorkspaces(result.workspaces);
    } catch (error) {
      showAppError(error, 'codingAgentActionFailed');
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between px-1.5">
        <h2 className="min-w-0 truncate text-sm font-normal text-foreground opacity-[0.28]">
          {i18nService.t('codingWorkspaceSection')}
        </h2>
        <div className="flex items-center">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="theme-action-faint"
            aria-label={i18nService.t('codingAgentManageAgents')}
            title={i18nService.t('codingAgentManageAgents')}
            onClick={() => window.dispatchEvent(new CustomEvent(CodingUiEvent.ManageAgents))}
          >
            <Settings2 />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="theme-action-faint"
            aria-label={i18nService.t('codingWorkspaceAdd')}
            onMouseEnter={() => {
              if (!prefersReducedMotion) addWorkspaceIconRef.current?.startAnimation();
            }}
            onMouseLeave={() => addWorkspaceIconRef.current?.stopAnimation()}
            onClick={() => {
              setError(null);
              setEditingWorkspace(null);
              setWorkspaceDialogOpen(true);
            }}
          >
            <AnimatedFolderPlusIcon ref={addWorkspaceIconRef} />
          </Button>
        </div>
      </div>
      <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto pb-8">
        {workspaces.length === 0 ? (
          <button
            type="button"
            className="theme-native-workspace-action w-full px-2 py-8 text-center"
            onClick={() => setWorkspaceDialogOpen(true)}
          >
            <Folder className="mx-auto mb-2 size-8 opacity-50" />
            {i18nService.t('codingWorkspaceEmpty')}
          </button>
        ) : (
          <div className="space-y-0.5">
            {workspaces.map(workspace => (
              <WorkspaceNode
                key={workspace.id}
                workspace={workspace}
                profiles={profiles}
                selection={selection}
                expanded={expandedIds.has(workspace.id)}
                onToggleExpanded={(workspaceId, open) =>
                  setExpandedIds(current => {
                    const next = new Set(current);
                    if (open) next.add(workspaceId);
                    else next.delete(workspaceId);
                    return next;
                  })
                }
                onSelectionChange={onSelectionChange}
                onCreateSession={startSession}
                onEditWorkspace={target => {
                  setEditingWorkspace(target);
                  setWorkspaceDialogOpen(true);
                }}
                onRemoveWorkspace={setRemovingWorkspace}
                onRemoveSession={(target, session) =>
                  setRemovingSession({ workspace: target, session })
                }
              />
            ))}
          </div>
        )}
      </div>
      <CodingWorkspaceDialog
        open={workspaceDialogOpen}
        workspace={editingWorkspace}
        profiles={profiles}
        error={error}
        onOpenChange={open => {
          setWorkspaceDialogOpen(open);
          if (!open) {
            setEditingWorkspace(null);
            setError(null);
          }
        }}
        onSubmit={saveWorkspace}
      />
      <DestructiveConfirmDialog
        open={Boolean(removingWorkspace)}
        title={i18nService.t('codingWorkspaceRemove')}
        description={i18nService.t('codingWorkspaceRemoveConfirm')}
        cancelLabel={i18nService.t('codingWorkspaceCancel')}
        confirmLabel={i18nService.t('codingWorkspaceRemove')}
        confirmVariant="outline"
        isConfirming={isRemoving}
        onCancel={() => setRemovingWorkspace(null)}
        onConfirm={() => void removeWorkspace()}
      />
      <DestructiveConfirmDialog
        open={Boolean(removingSession)}
        title={i18nService.t('codingSessionRemove')}
        description={i18nService.t('codingSessionRemoveConfirm')}
        cancelLabel={i18nService.t('codingWorkspaceCancel')}
        confirmLabel={i18nService.t('codingSessionRemove')}
        confirmVariant="outline"
        isConfirming={isRemoving}
        onCancel={() => setRemovingSession(null)}
        onConfirm={() => void removeSession()}
      />
    </div>
  );
};

interface WorkspaceNodeProps {
  workspace: CodingWorkspaceSummary;
  profiles: CodingAgentProfile[];
  selection: CodingSidebarSelection;
  expanded: boolean;
  onToggleExpanded: (workspaceId: string, open: boolean) => void;
  onSelectionChange: (selection: CodingSidebarSelection) => void;
  onCreateSession: (workspace: CodingWorkspaceSummary) => void;
  onEditWorkspace: (workspace: CodingWorkspaceSummary) => void;
  onRemoveWorkspace: (workspace: CodingWorkspaceSummary) => void;
  onRemoveSession: (workspace: CodingWorkspaceSummary, session: CodingSessionSummary) => void;
}

const WorkspaceNode = ({
  workspace,
  profiles,
  selection,
  expanded,
  onToggleExpanded,
  onSelectionChange,
  onCreateSession,
  onEditWorkspace,
  onRemoveWorkspace,
  onRemoveSession,
}: WorkspaceNodeProps) => {
  const [shouldRenderSessions, setShouldRenderSessions] = useState(expanded);
  const [isSessionGroupVisible, setIsSessionGroupVisible] = useState(expanded);
  const [menuOpen, setMenuOpen] = useState(false);
  const folderIconRef = useRef<AnimatedFolderOpenIconHandle>(null);
  const createSessionIconRef = useRef<SidebarAnimatedMessageCirclePlusIconHandle>(null);
  const prefersReducedMotion = useReducedMotion();
  const previousExpandedRef = useRef(expanded);
  const previousReducedMotionRef = useRef(prefersReducedMotion);

  useEffect(() => {
    const wasExpanded = previousExpandedRef.current;
    const wasReducedMotion = previousReducedMotionRef.current;
    previousExpandedRef.current = expanded;
    previousReducedMotionRef.current = prefersReducedMotion;
    if (wasExpanded === expanded && wasReducedMotion === prefersReducedMotion) return;
    if (prefersReducedMotion) {
      setShouldRenderSessions(expanded);
      setIsSessionGroupVisible(expanded);
      return;
    }
    let frame = 0;
    let timeout = 0;
    if (expanded) {
      setShouldRenderSessions(true);
      setIsSessionGroupVisible(false);
      const reveal = () => {
        if (timeout) window.clearTimeout(timeout);
        setIsSessionGroupVisible(true);
      };
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(reveal);
      });
      // Hidden/background windows may suspend animation frames indefinitely.
      timeout = window.setTimeout(reveal, 60);
    } else {
      setIsSessionGroupVisible(false);
      timeout = window.setTimeout(() => setShouldRenderSessions(false), SESSIONS_TRANSITION_MS);
    }
    return () => {
      if (frame) cancelAnimationFrame(frame);
      if (timeout) window.clearTimeout(timeout);
    };
  }, [expanded, prefersReducedMotion]);

  const rootSessions = workspace.sessions.filter(session => !session.parentSessionId);
  const draft = selection.draft?.workspaceId === workspace.id ? selection.draft : null;

  return (
    <div className="space-y-0.5">
      <div
        data-slot="workspace-tree-row"
        className="sidebar-interactive-surface group sticky top-0 z-20 ml-[-6px] flex h-7 w-[calc(100%+12px)] items-center rounded-md transition-colors hover:shadow-subtle"
      >
        <Button
          variant="ghost"
          className="theme-page-coding-workspace-sidebar-button-1 h-full min-w-0 flex-1 justify-start text-left"
          onClick={() => {
            onToggleExpanded(workspace.id, !expanded);
          }}
          onMouseEnter={() => {
            if (!prefersReducedMotion) folderIconRef.current?.startAnimation();
          }}
          onMouseLeave={() => folderIconRef.current?.stopAnimation()}
          role="treeitem"
          aria-level={1}
          aria-expanded={expanded}
        >
          <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
            <AnimatedFolderOpenIcon ref={folderIconRef} />
          </span>
          <span
            className="min-w-0 flex-1 truncate text-muted-foreground"
            title={workspace.primaryRoot}
          >
            {getWorkspaceDisplayName(
              workspace.primaryRoot,
              workspace.name,
              i18nService.t('defaultConversation'),
            )}
          </span>
        </Button>
        <div className="flex h-7 shrink-0 items-center gap-0.5 pr-1.5">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onCreateSession(workspace)}
            onMouseEnter={() => {
              if (!prefersReducedMotion) createSessionIconRef.current?.startAnimation();
            }}
            onMouseLeave={() => createSessionIconRef.current?.stopAnimation()}
            className="theme-action-muted"
            aria-label={i18nService.t('codingSessionCreate')}
          >
            <SidebarAnimatedMessageCirclePlusIcon
              ref={createSessionIconRef}
              size={14}
              className="size-3.5"
            />
          </Button>
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className={cn(
                    'theme-page-coding-workspace-sidebar-button-variant-1 pointer-events-none group-hover:pointer-events-auto',
                    menuOpen &&
                      'theme-page-coding-workspace-sidebar-button-variant-2 pointer-events-auto',
                  )}
                  aria-label={i18nService.t('codingWorkspaceEdit')}
                >
                  <Ellipsis />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="min-w-[124px]">
              <DropdownMenuItem onClick={() => onEditWorkspace(workspace)}>
                {i18nService.t('codingWorkspaceEdit')}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => onRemoveWorkspace(workspace)}>
                <Trash2 className="h-3.5 w-3.5" />
                {i18nService.t('codingWorkspaceRemove')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {shouldRenderSessions && (
        <div
          className={cn(
            'grid w-full min-w-0 max-w-full transition-[grid-template-rows,opacity] duration-200 ease-out',
            isSessionGroupVisible ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
          )}
        >
          <div
            className={cn(
              'min-h-0 min-w-0 max-w-full overflow-hidden',
              !isSessionGroupVisible && 'pointer-events-none',
            )}
            role="group"
            aria-hidden={!expanded}
          >
            <div className="min-w-0 max-w-full space-y-0.5">
              {draft ? (
                <SessionRow
                  active
                  name={i18nService.t('codingSessionDraft')}
                  agentName={profiles.find(profile => profile.id === draft.profileId)?.name}
                  status={CodingLaneStatus.Idle}
                  nested={false}
                  onClick={() => undefined}
                />
              ) : null}
              {rootSessions.length === 0 && !draft ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="theme-page-coding-workspace-sidebar-button-2 sidebar-interactive-surface ml-[-6px] justify-start"
                  onClick={() => onCreateSession(workspace)}
                >
                  {i18nService.t('codingSessionNew')}
                </Button>
              ) : (
                rootSessions.map(session => {
                  const profile = profiles.find(candidate => candidate.id === session.profileId);
                  const collaborators = workspace.sessions.filter(
                    candidate => candidate.parentSessionId === session.id,
                  );
                  return (
                    <div key={session.id}>
                      <SessionRow
                        active={selection.laneId === session.id}
                        name={session.title}
                        agentName={profile?.name}
                        status={session.status}
                        nested={false}
                        onClick={() =>
                          onSelectionChange({
                            workspaceId: workspace.id,
                            workspaceRoot: workspace.primaryRoot,
                            laneId: session.id,
                            draft: null,
                          })
                        }
                        onDelete={() => onRemoveSession(workspace, session)}
                      />
                      {collaborators.map(collaborator => (
                        <SessionRow
                          key={collaborator.id}
                          active={selection.laneId === collaborator.id}
                          name={
                            profiles.find(candidate => candidate.id === collaborator.profileId)
                              ?.name ?? i18nService.t('codingSessionCollaborator')
                          }
                          agentName={i18nService.t('codingSessionCollaborator')}
                          status={collaborator.status}
                          nested
                          onClick={() =>
                            onSelectionChange({
                              workspaceId: workspace.id,
                              workspaceRoot: workspace.primaryRoot,
                              laneId: collaborator.id,
                              draft: null,
                            })
                          }
                          onDelete={() => onRemoveSession(workspace, collaborator)}
                        />
                      ))}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SessionRow = ({
  active,
  name,
  agentName,
  status,
  nested,
  onClick,
  onDelete,
}: {
  active: boolean;
  name: string;
  agentName?: string;
  status: CodingLaneStatus;
  nested: boolean;
  onClick: () => void;
  onDelete?: () => void;
}) => (
  <div className="group relative ml-[-6px] flex w-[calc(100%+12px)] min-w-0 items-center">
    <Button
      type="button"
      variant="ghost"
      className={cn(
        'theme-page-coding-workspace-sidebar-button-variant-3 min-w-0 flex-1 justify-start text-left',
        nested
          ? 'theme-page-coding-workspace-sidebar-button-variant-4'
          : 'theme-page-coding-workspace-sidebar-button-variant-5',
        active
          ? 'theme-page-coding-workspace-sidebar-button-variant-6 sidebar-interactive-surface-active'
          : 'theme-page-coding-workspace-sidebar-button-variant-7 sidebar-interactive-surface',
      )}
      onClick={onClick}
      role="treeitem"
      aria-level={nested ? 3 : 2}
      aria-selected={active}
    >
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className={cn('size-1.5 shrink-0 rounded-full', statusClassName[status])} />
      {agentName ? (
        <span className="theme-coding-session-agent shrink-0 truncate" title={agentName}>
          {agentName}
        </span>
      ) : null}
    </Button>
    {onDelete ? (
      <div className="flex shrink-0 items-center pr-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="theme-page-coding-workspace-sidebar-button-3"
          aria-label={i18nService.t('codingSessionRemove')}
          onClick={onDelete}
        >
          <Trash2 />
        </Button>
      </div>
    ) : null}
  </div>
);
