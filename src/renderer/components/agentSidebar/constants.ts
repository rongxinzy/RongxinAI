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

export const ScheduledSessionTitlePrefix = {
  Chinese: '[定时]',
  English: '[Cron]',
} as const;

export const isScheduledSessionTitle = (title: string): boolean => {
  const normalizedTitle = title.trim();
  return Object.values(ScheduledSessionTitlePrefix).some(prefix =>
    normalizedTitle.startsWith(prefix),
  );
};
