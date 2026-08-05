import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import { CoworkSessionMode } from '../../../shared/cowork/constants';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { localStore } from '../../services/store';
import { RootState } from '../../store';
import {
  selectCoworkSessions,
  selectCurrentSessionId,
  selectStreamingSessionIds,
  selectUnreadSessionIds,
} from '../../store/selectors/coworkSelectors';
import { WorkMode, type WorkMode as WorkModeType } from '../../store/workMode/constants';
import type { CoworkSessionSummary } from '../../types/cowork';
import { CoworkSessionStatusValue } from '../../types/cowork';
import { isScratchWorkspacePath } from '../../utils/path';
import { AgentSidebarIndicator, AgentSidebarPageSize, isScheduledSessionTitle } from './constants';
import type {
  AgentSidebarTaskNode,
  WorkspaceSidebarNode,
  WorkspaceSidebarPreferenceState,
} from './types';
import {
  isSessionOwnedByWorkspace,
  mergeSessionSummaries,
  mergeSessionsIntoWorkspacePreviews,
} from './workspaceSessionPreviews';

const WORKSPACE_SIDEBAR_STATE_KEY = 'workspaceSidebar.state';

const modeMatches = (session: CoworkSessionSummary, workMode: WorkModeType) =>
  workMode === WorkMode.Chat
    ? session.mode === CoworkSessionMode.Chat
    : session.mode !== CoworkSessionMode.Chat;

const toTaskNode = (
  session: CoworkSessionSummary,
  currentSessionId: string | null,
  unread: Set<string>,
  streamingSessionIds: Set<string>,
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
    session.status === CoworkSessionStatusValue.Running || streamingSessionIds.has(session.id)
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

export const useWorkspaceSidebarState = (
  workMode: WorkModeType = WorkMode.Work,
  searchQuery = '',
  searchCorpus: CoworkSessionSummary[] = [],
) => {
  const workspaces = useSelector((state: RootState) => state.workspace.workspaces);
  const currentSessionId = useSelector(selectCurrentSessionId);
  const sessions = useSelector(selectCoworkSessions);
  const streamingSessionIds = useSelector(selectStreamingSessionIds);
  const unreadSessionIds = useDeferredValue(useSelector(selectUnreadSessionIds));
  const unreadSet = useMemo(() => new Set(unreadSessionIds), [unreadSessionIds]);
  const streamingSessionIdSet = useMemo(
    () => new Set(streamingSessionIds),
    [streamingSessionIds],
  );
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [expandedTaskIds, setExpandedTaskIds] = useState<string[]>([]);
  const [scheduledExpandedIds, setScheduledExpandedIds] = useState<string[]>([]);
  const [scheduledExpandedTaskIds, setScheduledExpandedTaskIds] = useState<string[]>([]);
  const [preferencesHydrated, setPreferencesHydrated] = useState(false);
  const [previews, setPreviews] = useState<Record<string, CoworkSessionSummary[]>>({});
  const [hasMore, setHasMore] = useState<Record<string, boolean>>({});
  const [loadingIds, setLoadingIds] = useState<string[]>([]);
  const [failedIds, setFailedIds] = useState<string[]>([]);
  const loadingKeysRef = useRef(new Set<string>());
  const hasStoredPreferenceRef = useRef(false);

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
        hasStoredPreferenceRef.current = state !== null && state !== undefined;
        setExpandedIds(state?.expandedWorkspaceIds ?? []);
        setExpandedTaskIds(state?.expandedTaskListWorkspaceIds ?? []);
        setScheduledExpandedIds(state?.scheduledExpandedWorkspaceIds ?? []);
        setScheduledExpandedTaskIds(state?.scheduledExpandedTaskListWorkspaceIds ?? []);
        setPreferencesHydrated(true);
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
    if (
      !preferencesHydrated ||
      hasStoredPreferenceRef.current ||
      expandedIds.length ||
      !workspaces.length ||
      autoExpandInitializedRef.current
    ) {
      return;
    }
    autoExpandInitializedRef.current = true;
    setExpandedIds([workspaces[0].id]);
  }, [expandedIds.length, preferencesHydrated, workspaces]);

  useEffect(() => {
    if (!preferencesHydrated) return;
    void localStore.setItem(WORKSPACE_SIDEBAR_STATE_KEY, {
      expandedWorkspaceIds: expandedIds,
      expandedTaskListWorkspaceIds: expandedTaskIds,
      scheduledExpandedWorkspaceIds: scheduledExpandedIds,
      scheduledExpandedTaskListWorkspaceIds: scheduledExpandedTaskIds,
    } satisfies WorkspaceSidebarPreferenceState);
  }, [
    expandedIds,
    expandedTaskIds,
    preferencesHydrated,
    scheduledExpandedIds,
    scheduledExpandedTaskIds,
  ]);

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
            : mergeSessionSummaries(current[workspaceId] ?? [], result.sessions ?? []),
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
    setPreviews(current =>
      mergeSessionsIntoWorkspacePreviews(
        current,
        sessions.filter(session => modeMatches(session, workMode)),
      ),
    );
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
      workspaces.filter(workspace => !workspace.isHidden).map(workspace => {
        const filtered = sortTasks(
          (previews[workspace.id] ?? []).filter(
            session =>
              isSessionOwnedByWorkspace(session, workspace.id) &&
              modeMatches(session, workMode) &&
              isScheduledSessionTitle(session.title) === scheduled,
          ),
        );
        const expanded = expandedWorkspaceIds.includes(workspace.id);
        const taskExpanded = expandedTaskListIds.includes(workspace.id);
        const visible = taskExpanded ? filtered : filtered.slice(0, AgentSidebarPageSize.Preview);
        return {
          id: workspace.id,
          // The scratch workspace (「不使用文件夹」) displays as 默认对话 instead
          // of its folder basename.
          name: isScratchWorkspacePath(workspace.path)
            ? i18nService.t('defaultConversation')
            : workspace.name,
          path: workspace.path,
          isExpanded: expanded,
          isTaskListExpanded: taskExpanded,
          canExpandTasks:
            !taskExpanded &&
            ((hasMore[workspace.id] ?? false) || filtered.length > AgentSidebarPageSize.Preview),
          canCollapseTasks: taskExpanded && filtered.length > AgentSidebarPageSize.Preview,
          isLoadingTasks: loadingIds.includes(workspace.id),
          hasLoadError: failedIds.includes(workspace.id),
          tasks: visible.map(session =>
            toTaskNode(session, currentSessionId, unreadSet, streamingSessionIdSet),
          ),
        } satisfies WorkspaceSidebarNode;
      }),
    [
      currentSessionId,
      failedIds,
      hasMore,
      loadingIds,
      previews,
      streamingSessionIdSet,
      unreadSet,
      workMode,
      workspaces,
    ],
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

  const searching = searchQuery.trim().length > 0;
  const searchSource = useMemo<Record<string, CoworkSessionSummary[]>>(() => {
    if (!searching) return {};
    const byWorkspace = new Map<string, CoworkSessionSummary[]>();
    for (const session of searchCorpus) {
      if (!modeMatches(session, workMode)) continue;
      const key = session.workspaceId ?? '__none__';
      const list = byWorkspace.get(key);
      if (list) list.push(session);
      else byWorkspace.set(key, [session]);
    }
    return Object.fromEntries(byWorkspace);
  }, [searchCorpus, searching, workMode]);

  const searchedWorkspaceNodes = useMemo(() => {
    if (!searching) return { workspaceNodes, scheduledWorkspaceNodes };
    const query = searchQuery.trim().toLowerCase();
    const buildSearchNodes = (nodes: WorkspaceSidebarNode[], scheduled: boolean) =>
      nodes.flatMap(node => {
        const tasks = sortTasks(
          (searchSource[node.id] ?? []).filter(
            session =>
              isScheduledSessionTitle(session.title) === scheduled &&
              session.title.toLowerCase().includes(query),
          ),
        );
        if (tasks.length === 0) return [];
        return [
          {
            ...node,
            isExpanded: true,
            isTaskListExpanded: true,
            canExpandTasks: false,
            canCollapseTasks: false,
            tasks: tasks.map(session =>
              toTaskNode(session, currentSessionId, unreadSet, streamingSessionIdSet),
            ),
          },
        ];
      });
    return {
      workspaceNodes: buildSearchNodes(workspaceNodes, false),
      scheduledWorkspaceNodes: buildSearchNodes(scheduledWorkspaceNodes, true),
    };
  }, [
    currentSessionId,
    searchQuery,
    searchSource,
    searching,
    streamingSessionIdSet,
    unreadSet,
    workspaceNodes,
    scheduledWorkspaceNodes,
  ]);

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
    workspaceNodes: searchedWorkspaceNodes.workspaceNodes,
    scheduledWorkspaceNodes: searchedWorkspaceNodes.scheduledWorkspaceNodes,
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
