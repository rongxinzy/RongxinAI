import { Button } from '@shared/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@shared/components/ui/collapsible';
import { DestructiveConfirmDialog } from '@shared/components/ui/destructive-confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import { cn } from '@shared/lib/utils';
import { Bot, ChevronRight, Folder, MoreHorizontal, Plus, Settings2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  CodingAgentProfileId,
  CodingLaneStatus,
  type CodingAgentProfile,
  type CodingWorkspaceSummary,
} from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 items-center justify-between px-1.5">
        <h2 className="truncate text-[14px] font-normal text-foreground opacity-[0.46]">
          {i18nService.t('codingWorkspaceSection')}
        </h2>
        <div className="flex items-center">
          {selectedWorkspace ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
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
      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        {workspaces.length === 0 ? (
          <button
            type="button"
            className="w-full rounded-lg px-2 py-8 text-center text-sm text-muted-foreground hover:bg-muted/50"
            onClick={() => setWorkspaceDialogOpen(true)}
          >
            <Folder className="mx-auto mb-2 size-8 opacity-50" />
            {i18nService.t('codingWorkspaceEmpty')}
          </button>
        ) : (
          <div className="space-y-1">
            {workspaces.map(workspace => {
              const expanded = expandedIds.has(workspace.id);
              const rootSessions = workspace.sessions.filter(session => !session.parentSessionId);
              return (
                <Collapsible
                  key={workspace.id}
                  open={expanded}
                  onOpenChange={open =>
                    setExpandedIds(current => {
                      const next = new Set(current);
                      if (open) next.add(workspace.id);
                      else next.delete(workspace.id);
                      return next;
                    })
                  }
                >
                  <div className="group flex items-center gap-0.5 rounded-lg hover:bg-muted/60">
                    <CollapsibleTrigger
                      onClick={() =>
                        onSelectionChange({
                          workspaceId: workspace.id,
                          workspaceRoot: workspace.primaryRoot,
                          laneId: workspace.activeSessionId,
                          draft: null,
                        })
                      }
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-8 min-w-0 flex-1 justify-start px-1.5 font-normal"
                        />
                      }
                    >
                      <ChevronRight
                        className={cn('transition-transform', expanded && 'rotate-90')}
                      />
                      <Folder />
                      <span className="truncate">{workspace.name}</span>
                    </CollapsibleTrigger>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="opacity-0 group-hover:opacity-100"
                      aria-label={i18nService.t('codingSessionCreate')}
                      onClick={() => openSessionDraft(workspace)}
                    >
                      <Plus />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        nativeButton
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="opacity-0 group-hover:opacity-100"
                            aria-label={i18nService.t('codingWorkspaceEdit')}
                          >
                            <MoreHorizontal />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => {
                            setEditingWorkspace(workspace);
                            setWorkspaceDialogOpen(true);
                          }}
                        >
                          {i18nService.t('codingWorkspaceEdit')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setRemovingWorkspace(workspace)}
                        >
                          <Trash2 />
                          {i18nService.t('codingWorkspaceRemove')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <CollapsibleContent>
                    {selection.draft?.workspaceId === workspace.id ? (
                      <SessionRow
                        active
                        name={i18nService.t('codingSessionDraft')}
                        agentName={
                          profiles.find(profile => profile.id === selection.draft?.profileId)?.name
                        }
                        status={CodingLaneStatus.Idle}
                        nested={false}
                        onClick={() => undefined}
                      />
                    ) : null}
                    {rootSessions.length === 0 && selection.draft?.workspaceId !== workspace.id ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="ml-5 h-8 w-[calc(100%-1.25rem)] justify-start text-muted-foreground"
                        onClick={() => openSessionDraft(workspace)}
                      >
                        <Plus />
                        {i18nService.t('codingSessionNew')}
                      </Button>
                    ) : (
                      rootSessions.map(session => {
                        const profile = profiles.find(
                          candidate => candidate.id === session.profileId,
                        );
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
                            />
                            {collaborators.map(collaborator => (
                              <SessionRow
                                key={collaborator.id}
                                active={selection.laneId === collaborator.id}
                                name={
                                  profiles.find(
                                    candidate => candidate.id === collaborator.profileId,
                                  )?.name ?? i18nService.t('codingSessionCollaborator')
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
                              />
                            ))}
                          </div>
                        );
                      })
                    )}
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
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
        onCancel={() => setRemovingWorkspace(null)}
        onConfirm={() => void removeWorkspace()}
      />
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
}: {
  active: boolean;
  name: string;
  agentName?: string;
  status: CodingLaneStatus;
  nested: boolean;
  onClick: () => void;
}) => (
  <Button
    type="button"
    variant={active ? 'secondary' : 'ghost'}
    className={cn(
      'h-auto w-full min-w-0 justify-start gap-2 px-2 py-1.5 text-left font-normal',
      nested ? 'pl-10' : 'pl-7',
    )}
    onClick={onClick}
  >
    <Bot className="size-4 shrink-0" />
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm">{name}</span>
      {agentName ? (
        <span className="block truncate text-xs text-muted-foreground">{agentName}</span>
      ) : null}
    </span>
    <span className={cn('size-1.5 shrink-0 rounded-full', statusClassName[status])} />
  </Button>
);
