import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import { coworkService } from '../../services/cowork';
import { localStore } from '../../services/store';
import { RootState } from '../../store';
import {
  selectCoworkSessions,
  selectCurrentSessionId,
  selectUnreadSessionIds,
} from '../../store/selectors/coworkSelectors';
import type { CoworkSessionSummary } from '../../types/cowork';
import { CoworkSessionStatusValue } from '../../types/cowork';
import { AgentSidebarIndicator, AgentSidebarPageSize, isScheduledSessionTitle } from './constants';
import type {
  AgentSidebarTaskNode,
  WorkspaceSidebarNode,
  WorkspaceSidebarPreferenceState,
} from './types';

const WORKSPACE_SIDEBAR_STATE_KEY = 'workspaceSidebar.state';

const modeMatches = (session: CoworkSessionSummary, workMode: 'work' | 'chat') =>
  workMode === 'chat' ? session.mode === 'chat' : session.mode !== 'chat';

const toTaskNode = (
  session: CoworkSessionSummary,
  currentSessionId: string | null,
  unread: Set<string>,
): AgentSidebarTaskNode => ({
  id: session.id,
  agentId: session.agentId?.trim() || 'main',
  workspaceId: session.workspaceId,
  title: session.title,
  status: session.status,
  pinned: session.pinned,
  pinOrder: session.pinOrder ?? null,
  updatedAt: session.updatedAt,
  createdAt: session.createdAt,
  indicator:
    session.status === CoworkSessionStatusValue.Running
      ? AgentSidebarIndicator.Running
      : session.status === CoworkSessionStatusValue.Completed && unread.has(session.id)
        ? AgentSidebarIndicator.CompletedUnread
        : AgentSidebarIndicator.None,
  isSelected: session.id === currentSessionId,
});

const sortTasks = (tasks: CoworkSessionSummary[]) =>
  [...tasks].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.pinned && b.pinned) {
      const aOrder = a.pinOrder ?? a.updatedAt ?? a.createdAt;
      const bOrder = b.pinOrder ?? b.updatedAt ?? b.createdAt;
      if (aOrder !== bOrder) return aOrder - bOrder;
    }
    return (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt);
  });

const mergeTasks = (current: CoworkSessionSummary[], incoming: CoworkSessionSummary[]) => {
  const byId = new Map(current.map(session => [session.id, session]));
  incoming.forEach(session => byId.set(session.id, session));
  return [...byId.values()];
};

export const useWorkspaceSidebarState = (workMode: 'work' | 'chat' = 'work') => {
  const workspaces = useSelector((state: RootState) => state.workspace.workspaces);
  const currentSessionId = useSelector(selectCurrentSessionId);
  const sessions = useSelector(selectCoworkSessions);
  const unreadSessionIds = useDeferredValue(useSelector(selectUnreadSessionIds));
  const unreadSet = useMemo(() => new Set(unreadSessionIds), [unreadSessionIds]);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [expandedTaskIds, setExpandedTaskIds] = useState<string[]>([]);
  const [scheduledExpandedIds, setScheduledExpandedIds] = useState<string[]>([]);
  const [scheduledExpandedTaskIds, setScheduledExpandedTaskIds] = useState<string[]>([]);
  const [previews, setPreviews] = useState<Record<string, CoworkSessionSummary[]>>({});
  const [hasMore, setHasMore] = useState<Record<string, boolean>>({});
  const [loadingIds, setLoadingIds] = useState<string[]>([]);
  const [failedIds, setFailedIds] = useState<string[]>([]);
  const loadingKeysRef = useRef(new Set<string>());

  const setLoading = useCallback((id: string, loading: boolean) => {
    setLoadingIds(current =>
      loading
        ? current.includes(id)
          ? current
          : [...current, id]
        : current.filter(value => value !== id),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    void localStore
      .getItem<WorkspaceSidebarPreferenceState>(WORKSPACE_SIDEBAR_STATE_KEY)
      .then(state => {
        if (cancelled) return;
        setExpandedIds(state?.expandedWorkspaceIds ?? []);
        setExpandedTaskIds(state?.expandedTaskListWorkspaceIds ?? []);
        setScheduledExpandedIds(state?.scheduledExpandedWorkspaceIds ?? []);
        setScheduledExpandedTaskIds(state?.scheduledExpandedTaskListWorkspaceIds ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const autoExpandInitializedRef = useRef(false);

  useEffect(() => {
    // Auto-expand the first workspace on initial mount only.
    // After the user has manually collapsed all workspaces, do NOT
    // re-expand — doing so causes a flicker / re-expand animation
    // because toggleExpanded removes the last ID first, then this
    // effect immediately re-adds it.
    if (expandedIds.length || !workspaces.length || autoExpandInitializedRef.current) return;
    autoExpandInitializedRef.current = true;
    setExpandedIds([workspaces[0].id]);
  }, [expandedIds.length, workspaces]);

  useEffect(() => {
    void localStore.setItem(WORKSPACE_SIDEBAR_STATE_KEY, {
      expandedWorkspaceIds: expandedIds,
      expandedTaskListWorkspaceIds: expandedTaskIds,
      scheduledExpandedWorkspaceIds: scheduledExpandedIds,
      scheduledExpandedTaskListWorkspaceIds: scheduledExpandedTaskIds,
    } satisfies WorkspaceSidebarPreferenceState);
  }, [expandedIds, expandedTaskIds, scheduledExpandedIds, scheduledExpandedTaskIds]);

  const loadWorkspaceTasks = useCallback(
    async (workspaceId: string, offset = 0, replace = offset === 0) => {
      const key = `${workspaceId}:${offset}`;
      if (loadingKeysRef.current.has(key)) return;
      loadingKeysRef.current.add(key);
      setLoading(workspaceId, true);
      setFailedIds(current => current.filter(id => id !== workspaceId));
      try {
        const result = await coworkService.listSessionsForWorkspacePreview(
          workspaceId,
          AgentSidebarPageSize.Preview,
          offset,
        );
        if (!result.success) {
          setFailedIds(current =>
            current.includes(workspaceId) ? current : [...current, workspaceId],
          );
          return;
        }
        setPreviews(current => ({
          ...current,
          [workspaceId]: replace
            ? (result.sessions ?? [])
            : mergeTasks(current[workspaceId] ?? [], result.sessions ?? []),
        }));
        setHasMore(current => ({ ...current, [workspaceId]: result.hasMore ?? false }));
      } finally {
        loadingKeysRef.current.delete(key);
        setLoading(workspaceId, false);
      }
    },
    [setLoading],
  );

  useEffect(() => {
    workspaces.forEach(workspace => {
      if (!previews[workspace.id]) void loadWorkspaceTasks(workspace.id);
    });
  }, [loadWorkspaceTasks, previews, workspaces]);

  useEffect(() => {
    const currentWorkspaceId = sessions.find(session =>
      modeMatches(session, workMode),
    )?.workspaceId;
    if (!currentWorkspaceId) return;
    setPreviews(current => ({
      ...current,
      [currentWorkspaceId]: mergeTasks(
        current[currentWorkspaceId] ?? [],
        sessions.filter(session => modeMatches(session, workMode)),
      ),
    }));
  }, [sessions, workMode]);

  const toggleExpanded = useCallback((workspaceId: string) => {
    setExpandedIds(current =>
      current.includes(workspaceId)
        ? current.filter(id => id !== workspaceId)
        : [...current, workspaceId],
    );
  }, []);
  const collapseTasks = useCallback(
    (workspaceId: string) =>
      setExpandedTaskIds(current => current.filter(id => id !== workspaceId)),
    [],
  );
  const loadMoreTasks = useCallback(
    async (workspaceId: string) => {
      setExpandedTaskIds(current =>
        current.includes(workspaceId) ? current : [...current, workspaceId],
      );
      const current = previews[workspaceId] ?? [];
      if (!hasMore[workspaceId]) return;
      await loadWorkspaceTasks(workspaceId, current.length, false);
    },
    [hasMore, loadWorkspaceTasks, previews],
  );
  const loadMoreScheduledTasks = useCallback(
    async (workspaceId: string) => {
      setScheduledExpandedTaskIds(current =>
        current.includes(workspaceId) ? current : [...current, workspaceId],
      );
      const current = previews[workspaceId] ?? [];
      if (!hasMore[workspaceId]) return;
      await loadWorkspaceTasks(workspaceId, current.length, false);
    },
    [hasMore, loadWorkspaceTasks, previews],
  );
  const retryLoadTasks = useCallback(
    (workspaceId: string) => loadWorkspaceTasks(workspaceId, 0, true),
    [loadWorkspaceTasks],
  );
  const patchTaskPreview = useCallback(
    (
      sessionId: string,
      updates: Partial<Pick<CoworkSessionSummary, 'title' | 'pinned' | 'pinOrder' | 'status'>>,
    ) => {
      setPreviews(current =>
        Object.fromEntries(
          Object.entries(current).map(([id, tasks]) => [
            id,
            tasks.map(task =>
              task.id === sessionId ? { ...task, ...updates, updatedAt: Date.now() } : task,
            ),
          ]),
        ),
      );
    },
    [],
  );
  const removeTaskPreview = useCallback((sessionId: string) => {
    setPreviews(current =>
      Object.fromEntries(
        Object.entries(current).map(([id, tasks]) => [
          id,
          tasks.filter(task => task.id !== sessionId),
        ]),
      ),
    );
  }, []);

  const buildWorkspaceNodes = useCallback(
    (scheduled: boolean, expandedWorkspaceIds: string[], expandedTaskListIds: string[]) =>
      workspaces.map(workspace => {
        const filtered = sortTasks(
          (previews[workspace.id] ?? []).filter(
            session =>
              modeMatches(session, workMode) &&
              isScheduledSessionTitle(session.title) === scheduled,
          ),
        );
        const expanded = expandedWorkspaceIds.includes(workspace.id);
        const taskExpanded = expandedTaskListIds.includes(workspace.id);
        const visible = taskExpanded ? filtered : filtered.slice(0, AgentSidebarPageSize.Preview);
        return {
          id: workspace.id,
          name: workspace.name,
          path: workspace.path,
          isExpanded: expanded,
          isTaskListExpanded: taskExpanded,
          canExpandTasks: !taskExpanded && (hasMore[workspace.id] ?? false),
          canCollapseTasks: taskExpanded && filtered.length > AgentSidebarPageSize.Preview,
          isLoadingTasks: loadingIds.includes(workspace.id),
          hasLoadError: failedIds.includes(workspace.id),
          tasks: visible.map(session => toTaskNode(session, currentSessionId, unreadSet)),
        } satisfies WorkspaceSidebarNode;
      }),
    [currentSessionId, failedIds, hasMore, loadingIds, previews, unreadSet, workMode, workspaces],
  );

  const workspaceNodes = useMemo<WorkspaceSidebarNode[]>(
    () => buildWorkspaceNodes(false, expandedIds, expandedTaskIds),
    [buildWorkspaceNodes, expandedIds, expandedTaskIds],
  );

  const scheduledWorkspaceNodes = useMemo<WorkspaceSidebarNode[]>(
    () =>
      buildWorkspaceNodes(true, scheduledExpandedIds, scheduledExpandedTaskIds).filter(
        workspace => workspace.tasks.length > 0,
      ),
    [buildWorkspaceNodes, scheduledExpandedIds, scheduledExpandedTaskIds],
  );

  const collapseScheduledTasks = useCallback((workspaceId: string) => {
    setScheduledExpandedTaskIds(current => current.filter(id => id !== workspaceId));
  }, []);
  const toggleScheduledExpanded = useCallback((workspaceId: string) => {
    setScheduledExpandedIds(current =>
      current.includes(workspaceId)
        ? current.filter(id => id !== workspaceId)
        : [...current, workspaceId],
    );
  }, []);

  return {
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
  };
};
