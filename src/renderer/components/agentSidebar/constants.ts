export const AgentSidebarIndicator = {
  None: 'none',
  Running: 'running',
  CompletedUnread: 'completed_unread',
} as const;

export type AgentSidebarIndicator =
  (typeof AgentSidebarIndicator)[keyof typeof AgentSidebarIndicator];

export const AgentSidebarPreferenceKey = {
  State: 'myAgentSidebar.state',
} as const;

export const AgentSidebarPageSize = {
  Preview: 6,
  AllBatch: 100,
} as const;

/**
 * Legacy title-prefix convention for scheduled sessions. New sessions carry
 * an explicit `source` column instead; this predicate is retained only for
 * backfilling pre-source databases (see the cowork_sessions migration) and
 * must stay in sync with that SQL.
 */
export const ScheduledSessionTitlePrefix = CoworkScheduledSessionTitlePrefix;

export const isScheduledSessionTitle = (title: string): boolean => {
  const normalizedTitle = title.trim();
  return Object.values(ScheduledSessionTitlePrefix).some(prefix =>
    normalizedTitle.startsWith(prefix),
  );
};
import { CoworkScheduledSessionTitlePrefix } from '../../../shared/cowork/constants';
