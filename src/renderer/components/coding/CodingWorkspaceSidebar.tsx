import { Button } from '@shared/components/ui/button';
import { DestructiveConfirmDialog } from '@shared/components/ui/destructive-confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import { cn } from '@shared/lib/utils';
import { Ellipsis, Folder, Plus, Settings2, Trash2 } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  CodingAgentProfileId,
  CodingLaneStatus,
  type CodingAgentProfile,
  type CodingSessionSummary,
  type CodingWorkspaceSummary,
} from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
import {
  AnimatedFolderOpenIcon,
  type AnimatedFolderOpenIconHandle,
} from '../icons/AnimatedFolderOpenIcon';
import {
  SidebarAnimatedMessageCirclePlusIcon,
  type SidebarAnimatedMessageCirclePlusIconHandle,
} from '../icons/SidebarAnimatedMessageCirclePlusIcon';
import { CodingWorkspaceDialog } from './CodingWorkspaceDialog';

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
  onManageAgents: (workspaceRoot: string) => void;
}

const statusClassName: Record<CodingLaneStatus, string> = {
  [CodingLaneStatus.Idle]: 'bg-muted-foreground/40',
  [CodingLaneStatus.Running]: 'bg-primary',
  [CodingLaneStatus.WaitingApproval]: 'bg-warning',
  [CodingLaneStatus.NeedsAuth]: 'bg-warning',
  [CodingLaneStatus.Disconnected]: 'bg-destructive',
  [CodingLaneStatus.Completed]: 'bg-success',
  [CodingLaneStatus.Failed]: 'bg-destructive',
};

const SESSIONS_TRANSITION_MS = 200;

export const CodingWorkspaceSidebar = ({
  selection,
  onSelectionChange,
  onManageAgents,
}: CodingWorkspaceSidebarProps) => {
  const [workspaces, setWorkspaces] = useState<CodingWorkspaceSummary[]>([]);
  const [profiles, setProfiles] = useState<CodingAgentProfile[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
  const [editingWorkspace, setEditingWorkspace] = useState<CodingWorkspaceSummary | null>(null);
  const [removingWorkspace, setRemovingWorkspace] = useState<CodingWorkspaceSummary | null>(null);
  const [removingSession, setRemovingSession] = useState<{
    workspace: CodingWorkspaceSummary;
    session: CodingSessionSummary;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyWorkspaces = useCallback(
    (next: CodingWorkspaceSummary[]) => {
      setWorkspaces(next);
      setExpandedIds(current => {
        if (current.size) return current;
        return new Set(next.map(workspace => workspace.id));
      });
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
    [
      onSelectionChange,
      selection.draft,
      selection.laneId,
      selection.workspaceId,
      selection.workspaceRoot,
    ],
  );

  const refresh = useCallback(async () => {
    const [workspaceResult, profileResult] = await Promise.all([
      window.electron.codingAgent.listWorkspaces(),
      window.electron.codingAgent.listProfiles(),
    ]);
    if (workspaceResult.success && workspaceResult.workspaces) {
      applyWorkspaces(workspaceResult.workspaces);
    } else {
      setError(workspaceResult.error ?? i18nService.t('codingAgentActionFailed'));
    }
    if (profileResult.success && profileResult.profiles) setProfiles(profileResult.profiles);
  }, [applyWorkspaces]);

  useEffect(() => {
    void refresh();
    return window.electron.codingAgent.onChanged(snapshot => {
      if (snapshot.room.workspaceRoot === selection.workspaceRoot) {
        setProfiles(snapshot.profiles);
      }
      void refresh();
    });
  }, [refresh, selection.workspaceRoot]);

  const selectedWorkspace = useMemo(
    () => workspaces.find(workspace => workspace.id === selection.workspaceId) ?? null,
    [selection.workspaceId, workspaces],
  );

  const openSessionDraft = (workspace: CodingWorkspaceSummary) => {
    setError(null);
    setExpandedIds(current => new Set(current).add(workspace.id));
    onSelectionChange({
      workspaceId: workspace.id,
      workspaceRoot: workspace.primaryRoot,
      laneId: null,
      draft: {
        id: crypto.randomUUID(),
        workspaceId: workspace.id,
        sourceRoot: workspace.sources[0]?.path ?? workspace.primaryRoot,
        profileId: workspace.defaultProfileId || CodingAgentProfileId.Builtin,
        modelOverride: null,
        sources: workspace.sources,
      },
    });
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
      setError(result.error ?? i18nService.t('codingAgentActionFailed'));
      return false;
    }
    applyWorkspaces(result.workspaces);
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
    }
    setEditingWorkspace(null);
    return true;
  };

  const removeWorkspace = async () => {
    if (!removingWorkspace) return;
    const result = await window.electron.codingAgent.deleteWorkspace(removingWorkspace.id);
    if (!result.success || !result.workspaces) {
      setError(result.error ?? i18nService.t('codingAgentActionFailed'));
      return;
    }
    setRemovingWorkspace(null);
    applyWorkspaces(result.workspaces);
  };

  const removeSession = async () => {
    if (!removingSession) return;
    const result = await window.electron.codingAgent.deleteSession({
      workspaceRoot: removingSession.workspace.primaryRoot,
      laneId: removingSession.session.id,
    });
    if (!result.success || !result.workspaces) {
      setError(result.error ?? i18nService.t('codingAgentActionFailed'));
      return;
    }
    setRemovingSession(null);
    applyWorkspaces(result.workspaces);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between px-1.5">
        <h2 className="min-w-0 truncate text-[14px] font-normal text-foreground opacity-[0.28]">
          {i18nService.t('codingWorkspaceSection')}
        </h2>
        <div className="flex items-center">
          {selectedWorkspace ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-foreground opacity-[0.34] hover:opacity-[0.5]"
              aria-label={i18nService.t('codingAgentManageAgents')}
              onClick={() => onManageAgents(selectedWorkspace.primaryRoot)}
            >
              <Settings2 />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-foreground opacity-[0.34] hover:opacity-[0.5]"
            aria-label={i18nService.t('codingWorkspaceAdd')}
            onClick={() => {
              setError(null);
              setEditingWorkspace(null);
              setWorkspaceDialogOpen(true);
            }}
          >
            <Plus />
          </Button>
        </div>
      </div>
      <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto pb-8">
        {workspaces.length === 0 ? (
          <button
            type="button"
            className="sidebar-interactive-surface w-full rounded-md px-2 py-8 text-center text-sm text-muted-foreground"
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
                onCreateSession={openSessionDraft}
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
        {error ? <p className="px-2 pt-2 text-xs text-destructive">{error}</p> : null}
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
        cancelVariant="outline"
        confirmVariant="outline"
        onCancel={() => setRemovingWorkspace(null)}
        onConfirm={() => void removeWorkspace()}
      />
      <DestructiveConfirmDialog
        open={Boolean(removingSession)}
        title={i18nService.t('codingSessionRemove')}
        description={i18nService.t('codingSessionRemoveConfirm')}
        cancelLabel={i18nService.t('codingWorkspaceCancel')}
        confirmLabel={i18nService.t('codingSessionRemove')}
        cancelVariant="outline"
        confirmVariant="outline"
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

  useEffect(() => {
    const wasExpanded = previousExpandedRef.current;
    previousExpandedRef.current = expanded;
    if (wasExpanded === expanded) return;
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
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => setIsSessionGroupVisible(true));
      });
    } else {
      setIsSessionGroupVisible(false);
      timeout = window.setTimeout(
        () => setShouldRenderSessions(false),
        SESSIONS_TRANSITION_MS,
      );
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
          className="h-full min-w-0 flex-1 justify-start gap-2 rounded-md py-0 pl-3 pr-2 text-left text-sm font-normal text-foreground hover:bg-transparent"
          onClick={() => {
            onToggleExpanded(workspace.id, !expanded);
            onSelectionChange({
              workspaceId: workspace.id,
              workspaceRoot: workspace.primaryRoot,
              laneId: workspace.activeSessionId,
              draft: null,
            });
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
            {workspace.name}
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
            className="text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground"
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
                    'pointer-events-none opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-[0.3]',
                    menuOpen && 'pointer-events-auto opacity-[0.46]',
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
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onRemoveWorkspace(workspace)}
              >
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
              'min-h-0 min-w-0 max-w-full',
              !isSessionGroupVisible && 'pointer-events-none overflow-hidden',
            )}
            role="group"
            aria-hidden={!expanded}
          >
            <div className="min-w-0 max-w-full space-y-0.5">
              {draft ? (
                <SessionRow
                  active
                  name={i18nService.t('codingSessionDraft')}
                  agentName={
                    profiles.find(profile => profile.id === draft.profileId)?.name
                  }
                  status={CodingLaneStatus.Idle}
                  nested={false}
                  onClick={() => undefined}
                />
              ) : null}
              {rootSessions.length === 0 && !draft ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="sidebar-interactive-surface ml-[-6px] h-8 w-[calc(100%+12px)] justify-start rounded-md pl-[38px] pr-2.5 text-[14px] font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
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
  <div className="group relative">
    <Button
      type="button"
      variant="ghost"
      className={cn(
        'ml-[-6px] h-8 w-[calc(100%+12px)] min-w-0 justify-start gap-2 rounded-md py-0 pr-2.5 text-left text-[14px] font-normal transition-colors hover:bg-transparent',
        nested ? 'pl-[46px]' : 'pl-[38px]',
        active
          ? 'sidebar-interactive-surface-active text-foreground'
          : 'sidebar-interactive-surface text-muted-foreground hover:text-foreground',
      )}
      onClick={onClick}
      role="treeitem"
      aria-level={nested ? 3 : 2}
      aria-selected={active}
    >
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className={cn('size-1.5 shrink-0 rounded-full', statusClassName[status])} />
      {agentName ? (
        <span
          className={cn(
            'shrink-0 truncate text-[12px] font-normal text-foreground opacity-[0.28] transition-opacity',
            onDelete && 'group-hover:pointer-events-none group-hover:opacity-0',
          )}
        >
          {agentName}
        </span>
      ) : null}
    </Button>
    {onDelete ? (
      <div className="pointer-events-none absolute inset-y-0 right-1 flex items-center">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-[0.3]"
          aria-label={i18nService.t('codingSessionRemove')}
          onClick={onDelete}
        >
          <Trash2 />
        </Button>
      </div>
    ) : null}
  </div>
);
