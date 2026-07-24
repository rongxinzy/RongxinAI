import type { CoworkSessionSummary } from '../../types/cowork';
import { CoworkSessionStatusValue } from '../../types/cowork';
import { AgentSidebarIndicator } from './constants';
import type { AgentSidebarTaskNode } from './types';

const normalizeAgentId = (agentId?: string) => agentId?.trim() || 'main';

export const deriveAgentSidebarIndicator = (
  session: CoworkSessionSummary,
  unreadSessionIds: Set<string>,
) => {
  if (session.status === CoworkSessionStatusValue.Running) {
    return AgentSidebarIndicator.Running;
  }
  if (session.status === CoworkSessionStatusValue.Completed && unreadSessionIds.has(session.id)) {
    return AgentSidebarIndicator.CompletedUnread;
  }
  return AgentSidebarIndicator.None;
};

export const sortAgentSidebarTasks = (
  tasks: CoworkSessionSummary[],
  streamingSessionIds?: string[],
): CoworkSessionSummary[] => {
  const streamingSet =
    streamingSessionIds && streamingSessionIds.length > 0
      ? new Set(streamingSessionIds)
      : null;
  return [...tasks].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.pinned && b.pinned) {
      const aPinOrder = a.pinOrder ?? a.updatedAt ?? a.createdAt;
      const bPinOrder = b.pinOrder ?? b.updatedAt ?? b.createdAt;
      if (aPinOrder !== bPinOrder) return aPinOrder - bPinOrder;
    }
    // When two sessions are both actively streaming, sort by creation time
    // (stable) instead of updatedAt (which keeps changing). Without this,
    // concurrent streaming sessions continuously swap positions as each
    // turn completes, making the sidebar unusable.
    if (streamingSet && streamingSet.has(a.id) && streamingSet.has(b.id)) {
      return b.createdAt - a.createdAt;
    }
    const aUpdatedAt = a.updatedAt || a.createdAt;
    const bUpdatedAt = b.updatedAt || b.createdAt;
    if (bUpdatedAt !== aUpdatedAt) return bUpdatedAt - aUpdatedAt;
    return b.createdAt - a.createdAt;
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
