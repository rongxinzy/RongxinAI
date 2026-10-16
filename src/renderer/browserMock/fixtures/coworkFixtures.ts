import type { CoworkRunSnapshot } from '@shared/cowork/runState';

export const mockCoworkSessions = [
  {
    id: 'session-1',
    title: 'Build a React calculator app',
    mode: 'work' as const,
    source: 'app' as const,
    createdAt: Date.now() - 3600000,
    updatedAt: Date.now() - 1800000,
    pinned: false,
    workspaceId: 'workspace-1',
    modelOverride: null,
  },
  {
    id: 'session-2',
    title: 'Research TypeScript best practices',
    mode: 'chat' as const,
    source: 'app' as const,
    createdAt: Date.now() - 7200000,
    updatedAt: Date.now() - 3600000,
    pinned: true,
    workspaceId: null,
    modelOverride: null,
  },
  {
    id: 'session-3',
    title: 'Analyze sales data and create report',
    mode: 'work' as const,
    source: 'app' as const,
    createdAt: Date.now() - 14400000,
    updatedAt: Date.now() - 7200000,
    pinned: false,
    workspaceId: 'workspace-2',
    modelOverride: 'gpt-4',
  },
];

export const mockCoworkMessages = [
  {
    id: 'msg-1',
    sessionId: 'session-1',
    role: 'user',
    content: 'Build a React calculator app with basic operations',
    createdAt: Date.now() - 3600000,
  },
  {
    id: 'msg-2',
    sessionId: 'session-1',
    role: 'assistant',
    content:
      "I'll help you build a React calculator app. Let me create the component structure and implement the basic operations.",
    createdAt: Date.now() - 3590000,
  },
];

export const mockRunSnapshot: CoworkRunSnapshot = {
  sessionId: 'session-1',
  runId: 'run-1',
  sequence: 0,
  phase: 'waiting' as const,
  running: false,
  startedAt: Date.now() - 60000,
  confirmedAt: Date.now() - 59000,
  lastProgressAt: Date.now() - 1000,
};

export const mockCoworkConfig = {
  workingDirectory: '/home/user/projects',
  executionMode: 'auto' as const,
  permissionMode: 'ask' as const,
  permissionModeBySession: {},
  embeddingEnabled: false,
  embeddingProvider: null,
  embeddingModel: null,
  embeddingLocalModelPath: null,
  embeddingVectorWeight: 0.5,
  embeddingRemoteBaseUrl: null,
  embeddingRemoteApiKey: null,
  codemodeEnabled: false,
  mcpNativeBridge: true,
};

export const mockWorkspaces = [
  {
    id: 'workspace-1',
    name: 'Calculator Project',
    primaryPath: '/home/user/projects/calculator',
    folders: ['/home/user/projects/calculator'],
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now() - 3600000,
  },
  {
    id: 'workspace-2',
    name: 'Sales Analysis',
    primaryPath: '/home/user/projects/sales',
    folders: ['/home/user/projects/sales'],
    createdAt: Date.now() - 172800000,
    updatedAt: Date.now() - 7200000,
  },
];
