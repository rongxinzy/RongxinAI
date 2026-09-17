import type { CoworkSessionSummary } from '../../types/cowork';
import { CoworkSessionStatusValue } from '../../types/cowork';
import { AgentSidebarIndicator } from './constants';
import type { AgentSidebarTaskNode } from './types';

const normalizeAgentId = (agentId?: string) => agentId?.trim() || 'main';

/**
 * A session shows the running indicator while a task is executing: either the
 * persisted status says so, or the live stream registry still holds an open run.
 */
export const isSessionExecuting = (
  session: CoworkSessionSummary,
  streamingSessionIds?: ReadonlySet<string>,
): boolean =>
  session.status === CoworkSessionStatusValue.Running ||
  (streamingSessionIds?.has(session.id) ?? false);

export const deriveAgentSidebarIndicator = (
  session: CoworkSessionSummary,
  unreadSessionIds: Set<string>,
  streamingSessionIds?: ReadonlySet<string>,
) => {
  if (isSessionExecuting(session, streamingSessionIds)) return AgentSidebarIndicator.Running;
  if (session.status === CoworkSessionStatusValue.Completed && unreadSessionIds.has(session.id)) {
    return AgentSidebarIndicator.CompletedUnread;
  }
  return AgentSidebarIndicator.None;
};

export const toAgentSidebarTaskNode = (
  session: CoworkSessionSummary,
  currentSessionId: string | null,
  unreadSessionIds: Set<string>,
  streamingSessionIds?: ReadonlySet<string>,
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
    indicator: deriveAgentSidebarIndicator(session, unreadSessionIds, streamingSessionIds),
    isSelected: session.id === currentSessionId,
  };
};
