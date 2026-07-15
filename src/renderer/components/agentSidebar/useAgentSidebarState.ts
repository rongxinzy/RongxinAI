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
import {
  AgentSidebarIndicator,
  AgentSidebarPageSize,
  AgentSidebarPreferenceKey,
} from './constants';
import type {
  AgentSidebarAgentNode,
  AgentSidebarAgentSummary,
  AgentSidebarPreferenceState,
  AgentSidebarTaskNode,
} from './types';

interface UseAgentSidebarStateOptions {
  workMode?: 'work' | 'chat';
}

const normalizeAgentId = (agentId?: string) => agentId?.trim() || 'main';

const hasSessionChanged = (
  previous: CoworkSessionSummary,
  next: CoworkSessionSummary,
): boolean => {
  return previous.title !== next.title
    || previous.status !== next.status
    || previous.pinned !== next.pinned
    || previous.pinOrder !== next.pinOrder
    || previous.updatedAt !== next.updatedAt
    || previous.createdAt !== next.createdAt
    || normalizeAgentId(previous.agentId) !== normalizeAgentId(next.agentId);
};

const mergeSessions = (
  current: CoworkSessionSummary[],
  incoming: CoworkSessionSummary[],
): CoworkSessionSummary[] => {
  const byId = new Map<string, CoworkSessionSummary>();
  current.forEach((session) => byId.set(session.id, session));
  incoming.forEach((session) => byId.set(session.id, session));
  return Array.from(byId.values());
};

export const deriveAgentSidebarIndicator = (
  session: CoworkSessionSummary,
  unreadSessionIds: Set<string>,
) => {
  if (session.status === CoworkSessionStatusValue.Running) {
    return AgentSidebarIndicator.Running;
  }
  if (
    session.status === CoworkSessionStatusValue.Completed
    && unreadSessionIds.has(session.id)
  ) {
    return AgentSidebarIndicator.CompletedUnread;
  }
  return AgentSidebarIndicator.None;
};

export const sortAgentSidebarTasks = (
  tasks: CoworkSessionSummary[],
): CoworkSessionSummary[] => {
  return [...tasks].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.pinned && b.pinned) {
      const aPinOrder = a.pinOrder ?? a.updatedAt ?? a.createdAt;
      const bPinOrder = b.pinOrder ?? b.updatedAt ?? b.createdAt;
      if (aPinOrder !== bPinOrder) return aPinOrder - bPinOrder;
    }
    const aUpdatedAt = a.updatedAt || a.createdAt;
    const bUpdatedAt = b.updatedAt || b.createdAt;
    if (bUpdatedAt !== aUpdatedAt) return bUpdatedAt - aUpdatedAt;
    return b.createdAt - a.createdAt;
  });
};

export const sortAgentSidebarAgents = (
  agents: AgentSidebarAgentSummary[],
): AgentSidebarAgentSummary[] => {
  return [...agents].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.pinned && b.pinned) {
      const aPinOrder = a.pinOrder ?? Number.MAX_SAFE_INTEGER;
      const bPinOrder = b.pinOrder ?? Number.MAX_SAFE_INTEGER;
      if (aPinOrder !== bPinOrder) return aPinOrder - bPinOrder;
    }
    return 0;
  });
};

export const toAgentSidebarTaskNode = (
  session: CoworkSessionSummary,
  currentSessionId: string | null,
  unreadSessionIds: Set<string>,
): AgentSidebarTaskNode => {
  return {
    id: session.id,
    agentId: normalizeAgentId(session.agentId),
    title: session.title,
    status: session.status,
    pinned: session.pinned,
    pinOrder: session.pinOrder ?? null,
    updatedAt: session.updatedAt,
    createdAt: session.createdAt,
    indicator: deriveAgentSidebarIndicator(session, unreadSessionIds),
    isSelected: session.id === currentSessionId,
  };
};

export const collapseAgentSidebarTaskList = (
  expandedTaskListAgentIds: string[],
  agentId: string,
) => {
  return expandedTaskListAgentIds.includes(agentId)
    ? expandedTaskListAgentIds.filter((id) => id !== agentId)
    : expandedTaskListAgentIds;
};

export const useAgentSidebarState = (options?: UseAgentSidebarStateOptions) => {
  const workMode = options?.workMode ?? 'work';
  const agents = useSelector((state: RootState) => state.agent.agents);
  const currentAgentId = useSelector((state: RootState) => state.agent.currentAgentId);
  const currentSessionId = useSelector(selectCurrentSessionId);
  const allSessions = useSelector(selectCoworkSessions);
  // Filter sessions by workMode — existing sessions (no mode) default to work
  const sessions = workMode === 'chat'
    ? allSessions.filter(s => s.mode === 'chat')
    : allSessions.filter(s => s.mode !== 'chat');
  const unreadSessionIdsRaw = useSelector(selectUnreadSessionIds);
  // Defer tree recalculation caused by unread badge changes so the
  // conversation view renders uninterrupted — background cron-task
  // completions updating unreadSessionIds would otherwise trigger a
  // full sidebar tree rebuild that flickers the adjacent chat area.
  const unreadSessionIds = useDeferredValue(unreadSessionIdsRaw);

  const [expandedAgentIds, setExpandedAgentIds] = useState<string[]>([]);
  const [expandedTaskListAgentIds, setExpandedTaskListAgentIds] = useState<string[]>([]);
  const [taskPreviewsByAgentId, setTaskPreviewsByAgentId] = useState<Record<string, CoworkSessionSummary[]>>({});
  const [hasMoreTasksByAgentId, setHasMoreTasksByAgentId] = useState<Record<string, boolean>>({});
  const [loadingAgentIds, setLoadingAgentIds] = useState<string[]>([]);
  const [failedAgentIds, setFailedAgentIds] = useState<string[]>([]);
  const [preferenceLoaded, setPreferenceLoaded] = useState(false);

  const loadedAgentIdsRef = useRef(new Set<string>());
  const loadingKeysRef = useRef(new Set<string>());
  const initializedDefaultExpansionRef = useRef(false);

  const enabledAgents = useMemo(() => {
    return agents
      .filter((agent) => agent.enabled)
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        icon: agent.icon,
        enabled: agent.enabled,
        pinned: agent.pinned ?? false,
        pinOrder: agent.pinOrder ?? null,
      }));
  }, [agents]);

  const sortedEnabledAgents = useMemo(() => {
    return sortAgentSidebarAgents(enabledAgents);
  }, [enabledAgents]);

  const unreadSessionIdSet = useMemo(() => new Set(unreadSessionIds), [unreadSessionIds]);
  const expandedAgentIdSet = useMemo(() => new Set(expandedAgentIds), [expandedAgentIds]);
  const expandedTaskListAgentIdSet = useMemo(
    () => new Set(expandedTaskListAgentIds),
    [expandedTaskListAgentIds],
  );
  const loadingAgentIdSet = useMemo(() => new Set(loadingAgentIds), [loadingAgentIds]);
  const failedAgentIdSet = useMemo(() => new Set(failedAgentIds), [failedAgentIds]);

  useEffect(() => {
    let cancelled = false;
    void localStore.getItem<AgentSidebarPreferenceState>(AgentSidebarPreferenceKey.State)
      .then((preference) => {
        if (cancelled) return;
        setExpandedAgentIds(preference?.expandedAgentIds ?? []);
        setExpandedTaskListAgentIds(preference?.expandedTaskListAgentIds ?? []);
      })
      .finally(() => {
        if (!cancelled) {
          setPreferenceLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!preferenceLoaded) return;
    const preference: AgentSidebarPreferenceState = {
      expandedAgentIds,
      expandedTaskListAgentIds,
      selectedAgentId: currentAgentId,
      selectedTaskId: currentSessionId ?? undefined,
    };
    void localStore.setItem(AgentSidebarPreferenceKey.State, preference);
  }, [
    currentAgentId,
    currentSessionId,
    expandedAgentIds,
    expandedTaskListAgentIds,
    preferenceLoaded,
  ]);

  useEffect(() => {
    if (!preferenceLoaded || initializedDefaultExpansionRef.current) return;
    if (sortedEnabledAgents.length === 0) return;
    initializedDefaultExpansionRef.current = true;
    setExpandedAgentIds((previous) => {
      if (previous.length > 0) return previous;
      const currentAgentExists = sortedEnabledAgents.some((agent) => agent.id === currentAgentId);
      return [currentAgentExists ? currentAgentId : sortedEnabledAgents[0].id];
    });
  }, [currentAgentId, preferenceLoaded, sortedEnabledAgents]);

  const setAgentLoading = useCallback((agentId: string, isLoading: boolean) => {
    setLoadingAgentIds((previous) => {
      const exists = previous.includes(agentId);
      if (isLoading && !exists) return [...previous, agentId];
      if (!isLoading && exists) return previous.filter((id) => id !== agentId);
      return previous;
    });
  }, []);

  const setAgentFailed = useCallback((agentId: string, failed: boolean) => {
    setFailedAgentIds((previous) => {
      const exists = previous.includes(agentId);
      if (failed && !exists) return [...previous, agentId];
      if (!failed && exists) return previous.filter((id) => id !== agentId);
      return previous;
    });
  }, []);

  const loadAgentTasks = useCallback(async (
    agentId: string,
    options: { offset?: number; limit?: number; replace?: boolean } = {},
  ) => {
    const offset = options.offset ?? 0;
    const limit = options.limit ?? AgentSidebarPageSize.Preview;
    const replace = options.replace ?? offset === 0;
    const loadingKey = `${agentId}:${offset}:${limit}`;
    if (loadingKeysRef.current.has(loadingKey)) return;

    loadingKeysRef.current.add(loadingKey);
    setAgentLoading(agentId, true);
    setAgentFailed(agentId, false);

    try {
      const result = await coworkService.listSessionsForAgentPreview(agentId, limit, offset);
      if (!result.success) {
        setAgentFailed(agentId, true);
        return;
      }

      loadedAgentIdsRef.current.add(agentId);
      setTaskPreviewsByAgentId((previous) => {
        const current = replace ? [] : previous[agentId] ?? [];
        return {
          ...previous,
          [agentId]: mergeSessions(current, result.sessions ?? []),
        };
      });
      setHasMoreTasksByAgentId((previous) => ({
        ...previous,
        [agentId]: result.hasMore ?? false,
      }));
    } finally {
      loadingKeysRef.current.delete(loadingKey);
      setAgentLoading(agentId, false);
    }
  }, [setAgentFailed, setAgentLoading]);

  useEffect(() => {
    sortedEnabledAgents.forEach((agent) => {
      if (loadedAgentIdsRef.current.has(agent.id)) return;
      void loadAgentTasks(agent.id, { replace: true });
    });
  }, [loadAgentTasks, sortedEnabledAgents]);

  useEffect(() => {
    setTaskPreviewsByAgentId((previous) => {
      let changed = false;
      const next = { ...previous };

      sessions.forEach((session) => {
        const agentId = normalizeAgentId(session.agentId);
        const existingTasks = next[agentId];
        if (!existingTasks) return;

        const index = existingTasks.findIndex((item) => item.id === session.id);
        if (index === -1) {
          if (loadedAgentIdsRef.current.has(agentId)) {
            next[agentId] = [session, ...existingTasks];
            changed = true;
          }
          return;
        }

        if (hasSessionChanged(existingTasks[index], session)) {
          const updatedTasks = [...existingTasks];
          updatedTasks[index] = session;
          next[agentId] = updatedTasks;
          changed = true;
        }
      });

      // Prune task previews for sessions that were deleted from the
      // backend (e.g. via batch delete).  Redux sessions are scoped to
      // the active agent after a switch, so we only prune agents whose
      // task data has already been loaded via loadAgentTasks/loadMoreTasks.
      // When sessions is empty (all sessions of the current agent were
      // deleted), still prune the current agent so the sidebar reflects
      // the empty state immediately.
      const sessionIdSet = new Set(sessions.map((s) => s.id));
      const pruneAgent = (agentId: string) => {
        const tasks = next[agentId];
        if (!tasks || !loadedAgentIdsRef.current.has(agentId)) return;
        const filtered = tasks.filter((task) => sessionIdSet.has(task.id));
        if (filtered.length !== tasks.length) {
          next[agentId] = filtered;
          changed = true;
        }
      };

      // Prune the current agent only when sessions are consistent with it.
      // During agent switching, currentAgentId may have already updated while
      // sessions still reflect the previous agent (loadSessions is async).
      // Pruning against stale sessions would remove all cached task previews
      // for the new agent, causing a collapse/re-expand flicker.
      const sessionsMatchCurrentAgent = sessions.length === 0
        || normalizeAgentId(sessions[0].agentId) === currentAgentId;
      if (sessionsMatchCurrentAgent) {
        pruneAgent(currentAgentId);
      }

      // Prune the primary source agent of the Redux sessions.
      // When sessions is non-empty, the first session's agent is the one
      // that loadSessions(agentId) was called for.  Pruning this agent
      // covers the common case where batch delete removes sessions from
      // the currently filtered view.
      if (sessions.length > 0) {
        const primaryAgentId = normalizeAgentId(sessions[0].agentId);
        if (primaryAgentId !== currentAgentId) {
          pruneAgent(primaryAgentId);
        }
      }

      return changed ? next : previous;
    });
  }, [sessions, currentAgentId]);

  const toggleAgentExpanded = useCallback((agentId: string) => {
    setExpandedTaskListAgentIds((previous) => collapseAgentSidebarTaskList(previous, agentId));
    setExpandedAgentIds((previous) => {
      return previous.includes(agentId)
        ? previous.filter((id) => id !== agentId)
        : [...previous, agentId];
    });
  }, []);

  const loadMoreTasks = useCallback((agentId: string) => {
    const loadedTasks = taskPreviewsByAgentId[agentId] ?? [];
    setExpandedTaskListAgentIds((previous) => {
      return previous.includes(agentId) ? previous : [...previous, agentId];
    });
    if (
      loadedTasks.length > AgentSidebarPageSize.Preview
      && !(hasMoreTasksByAgentId[agentId] ?? false)
    ) {
      return Promise.resolve();
    }

    const loadingKey = `${agentId}:all`;
    if (loadingKeysRef.current.has(loadingKey)) return Promise.resolve();

    loadingKeysRef.current.add(loadingKey);
    setAgentLoading(agentId, true);
    setAgentFailed(agentId, false);

    const loadAll = async () => {
      const sessions: CoworkSessionSummary[] = [];
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const result = await coworkService.listSessionsForAgentPreview(
          agentId,
          AgentSidebarPageSize.AllBatch,
          offset,
        );
        if (!result.success) {
          setAgentFailed(agentId, true);
          return;
        }

        const batch = result.sessions ?? [];
        sessions.push(...batch);
        hasMore = result.hasMore ?? false;
        offset += batch.length;
        if (batch.length === 0) {
          break;
        }
      }

      loadedAgentIdsRef.current.add(agentId);
      setTaskPreviewsByAgentId((previous) => ({
        ...previous,
        [agentId]: mergeSessions([], sessions),
      }));
      setHasMoreTasksByAgentId((previous) => ({
        ...previous,
        [agentId]: false,
      }));
    };

    return loadAll().finally(() => {
      loadingKeysRef.current.delete(loadingKey);
      setAgentLoading(agentId, false);
    });
  }, [hasMoreTasksByAgentId, setAgentFailed, setAgentLoading, taskPreviewsByAgentId]);

  const collapseTasks = useCallback((agentId: string) => {
    setExpandedTaskListAgentIds((previous) => {
      return collapseAgentSidebarTaskList(previous, agentId);
    });
  }, []);

  const retryLoadTasks = useCallback((agentId: string) => {
    loadedAgentIdsRef.current.delete(agentId);
    return loadAgentTasks(agentId, { replace: true });
  }, [loadAgentTasks]);

  const patchTaskPreview = useCallback((
    sessionId: string,
    updates: Partial<Pick<CoworkSessionSummary, 'title' | 'pinned' | 'pinOrder' | 'status'>>,
    options: { preserveUpdatedAt?: boolean } = {},
  ) => {
    setTaskPreviewsByAgentId((previous) => {
      let changed = false;
      const next = { ...previous };
      Object.entries(previous).forEach(([agentId, tasks]) => {
        const index = tasks.findIndex((task) => task.id === sessionId);
        if (index === -1) return;
        const updatedTasks = [...tasks];
        updatedTasks[index] = {
          ...updatedTasks[index],
          ...updates,
          updatedAt: options.preserveUpdatedAt ? updatedTasks[index].updatedAt : Date.now(),
        };
        next[agentId] = updatedTasks;
        changed = true;
      });
      return changed ? next : previous;
    });
  }, []);

  const removeTaskPreview = useCallback((sessionId: string) => {
    setTaskPreviewsByAgentId((previous) => {
      let changed = false;
      const next = { ...previous };
      Object.entries(previous).forEach(([agentId, tasks]) => {
        if (!tasks.some((task) => task.id === sessionId)) return;
        next[agentId] = tasks.filter((task) => task.id !== sessionId);
        changed = true;
      });
      return changed ? next : previous;
    });
  }, []);

  const agentNodes = useMemo<AgentSidebarAgentNode[]>(() => {
    return sortedEnabledAgents.map((agent) => {
      const rawTaskPreviews = taskPreviewsByAgentId[agent.id] ?? [];
      const taskPreviews = rawTaskPreviews.filter(s =>
        workMode === 'chat' ? s.mode === 'chat' : s.mode !== 'chat'
      );
      const sortedTaskPreviews = sortAgentSidebarTasks(taskPreviews);
      const isTaskListExpanded = expandedTaskListAgentIdSet.has(agent.id);
      const hasMoreLoadedTasks = sortedTaskPreviews.length > AgentSidebarPageSize.Preview;
      const canExpandTasks =
        !isTaskListExpanded
        && ((hasMoreTasksByAgentId[agent.id] ?? false) || hasMoreLoadedTasks);
      const canCollapseTasks = isTaskListExpanded && hasMoreLoadedTasks;
      const visibleTaskPreviews = isTaskListExpanded
        ? sortedTaskPreviews
        : sortedTaskPreviews.slice(0, AgentSidebarPageSize.Preview);
      const tasks = visibleTaskPreviews.map((session) => {
        return toAgentSidebarTaskNode(session, currentSessionId, unreadSessionIdSet);
      });

      return {
        ...agent,
        isExpanded: expandedAgentIdSet.has(agent.id),
        isTaskListExpanded,
        canExpandTasks,
        canCollapseTasks,
        isLoadingTasks: loadingAgentIdSet.has(agent.id),
        hasLoadError: failedAgentIdSet.has(agent.id),
        tasks,
      };
    });
  }, [
    currentSessionId,
    expandedAgentIdSet,
    expandedTaskListAgentIdSet,
    failedAgentIdSet,
    hasMoreTasksByAgentId,
    loadingAgentIdSet,
    sortedEnabledAgents,
    taskPreviewsByAgentId,
    unreadSessionIdSet,
    workMode,
  ]);

  return {
    agentNodes,
    expandedTaskListAgentIdSet,
    patchTaskPreview,
    removeTaskPreview,
    retryLoadTasks,
    loadMoreTasks,
    collapseTasks,
    toggleAgentExpanded,
  };
};
