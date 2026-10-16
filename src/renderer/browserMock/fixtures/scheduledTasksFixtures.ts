export const mockScheduledTasks = [
  {
    id: 'task-1',
    name: 'Daily News Briefing',
    description: 'Collect and summarize tech news every morning',
    enabled: true,
    cronExpression: '0 9 * * *',
    prompt: 'Search for the latest tech news and create a summary',
    workspaceId: null,
    agentId: null,
    deliveryChannels: ['email'],
    lastRunAt: Date.now() - 86400000,
    nextRunAt: Date.now() + 3600000,
    createdAt: Date.now() - 2592000000,
    updatedAt: Date.now() - 86400000,
  },
  {
    id: 'task-2',
    name: 'Weekly Report',
    description: 'Generate weekly sales report',
    enabled: true,
    cronExpression: '0 18 * * 5',
    prompt: 'Analyze sales data and create a weekly report',
    workspaceId: 'workspace-2',
    agentId: null,
    deliveryChannels: ['wecom'],
    lastRunAt: Date.now() - 604800000,
    nextRunAt: Date.now() + 172800000,
    createdAt: Date.now() - 5184000000,
    updatedAt: Date.now() - 604800000,
  },
];

export const mockScheduledTaskRuns = [
  {
    id: 'run-1',
    taskId: 'task-1',
    status: 'completed' as const,
    startedAt: Date.now() - 86400000,
    completedAt: Date.now() - 86300000,
    sessionId: 'session-scheduled-1',
    error: null,
  },
  {
    id: 'run-2',
    taskId: 'task-2',
    status: 'completed' as const,
    startedAt: Date.now() - 604800000,
    completedAt: Date.now() - 604700000,
    sessionId: 'session-scheduled-2',
    error: null,
  },
];

export const mockChannels = [
  {
    id: 'wecom',
    name: 'WeCom',
    enabled: true,
    accounts: 1,
  },
  {
    id: 'feishu',
    name: 'Feishu',
    enabled: false,
    accounts: 0,
  },
  {
    id: 'email',
    name: 'Email',
    enabled: true,
    accounts: 1,
  },
];
