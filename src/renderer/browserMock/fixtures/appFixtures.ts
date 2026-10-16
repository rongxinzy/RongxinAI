export const mockAppInfo = {
  version: '2026.7.16',
  isDev: true,
  isEnterprise: false,
  systemLocale: 'en-US',
  platform: 'darwin' as const,
  arch: 'arm64' as const,
};

export const mockApiConfig = {
  apiKey: 'mock-api-key',
  baseURL: 'https://api.openai.com/v1',
  model: 'gpt-4',
  apiType: 'openai' as const,
};

export const mockRecentCwds = [
  '/home/user/projects/calculator',
  '/home/user/projects/sales',
  '/home/user/projects/website',
];

export const mockAgents = [
  {
    id: 'agent-1',
    name: 'Code Assistant',
    description: 'Helps with coding tasks',
    systemPrompt: 'You are a helpful coding assistant',
    identity: 'assistant',
    model: 'gpt-4',
    workingDirectory: '/home/user/projects',
    icon: '💻',
    skillIds: ['web-search', 'file-operations'],
    enabled: true,
    pinned: true,
    source: 'user',
    createdAt: Date.now() - 2592000000,
    updatedAt: Date.now() - 86400000,
  },
  {
    id: 'agent-2',
    name: 'Research Assistant',
    description: 'Helps with research and analysis',
    systemPrompt: 'You are a helpful research assistant',
    identity: 'assistant',
    model: 'gpt-4',
    workingDirectory: null,
    icon: '📚',
    skillIds: ['web-search'],
    enabled: true,
    pinned: false,
    source: 'user',
    createdAt: Date.now() - 1296000000,
    updatedAt: Date.now() - 432000000,
  },
];

export const mockMemoryLinks = [
  {
    id: 'mem-1',
    scope: 'project',
    content: 'Project uses React 19 and TypeScript 7',
    tags: ['react', 'typescript'],
    createdAt: Date.now() - 604800000,
    confirmedAt: Date.now() - 604800000,
    archived: false,
  },
  {
    id: 'mem-2',
    scope: 'personal',
    content: 'User prefers functional components and hooks',
    tags: ['preference', 'react'],
    createdAt: Date.now() - 1209600000,
    confirmedAt: Date.now() - 1209600000,
    archived: false,
  },
];

export const mockTodos = [
  {
    id: 'todo-1',
    listId: 'list-1',
    title: 'Review pull request',
    description: 'Check the calculator app PR',
    status: 'pending',
    priority: 'high',
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now() - 86400000,
  },
  {
    id: 'todo-2',
    listId: 'list-1',
    title: 'Update documentation',
    description: 'Add examples to README',
    status: 'pending',
    priority: 'medium',
    createdAt: Date.now() - 172800000,
    updatedAt: Date.now() - 172800000,
  },
];

export const mockTodoLists = [
  {
    id: 'list-1',
    name: 'Work Tasks',
    color: '#3b82f6',
    createdAt: Date.now() - 2592000000,
    updatedAt: Date.now() - 86400000,
  },
  {
    id: 'list-2',
    name: 'Personal',
    color: '#10b981',
    createdAt: Date.now() - 2592000000,
    updatedAt: Date.now() - 432000000,
  },
];
