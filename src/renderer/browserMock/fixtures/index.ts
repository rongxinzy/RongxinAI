/**
 * Typed fixtures for the browser preview mock.
 * Every shape is derived from the preload contract (`Window['electron']`) so fixtures
 * cannot drift from what the renderer actually receives over IPC.
 */
import type { Agent } from '../../types/agent';
import type { Skill } from '../../types/skill';

type Api = Window['electron'];
type Resolved<F> = F extends (...args: never[]) => Promise<infer R> ? R : never;
type ItemOf<T> = T extends readonly (infer U)[] ? U : never;

export type MockSessionSummary = ItemOf<
  NonNullable<Resolved<Api['cowork']['listSessions']>['sessions']>
>;
export type MockSession = NonNullable<Resolved<Api['cowork']['getSession']>['session']>;
export type MockMessage = MockSession['messages'][number];
export type MockCoworkConfig = NonNullable<Resolved<Api['cowork']['getConfig']>['config']>;
export type MockWorkspace = ItemOf<
  NonNullable<Resolved<Api['cowork']['listWorkspaces']>['workspaces']>
>;
export type MockMcpServer = ItemOf<NonNullable<Resolved<Api['mcp']['list']>['servers']>>;
export type MockApiConfig = NonNullable<Resolved<Api['getApiConfig']>>;

const NOW = Date.UTC(2026, 9, 16, 7, 0, 0);
const HOUR = 3_600_000;

export const mockWorkspaces: MockWorkspace[] = [
  {
    id: 'workspace-1',
    name: 'Calculator',
    path: '/home/user/projects/calculator',
    folders: [],
    isHidden: false,
    pinned: true,
    createdAt: NOW - 48 * HOUR,
    updatedAt: NOW - HOUR,
  },
  {
    id: 'workspace-2',
    name: 'Sales Analysis',
    path: '/home/user/projects/sales',
    folders: [],
    isHidden: false,
    createdAt: NOW - 96 * HOUR,
    updatedAt: NOW - 2 * HOUR,
  },
];

export const mockSessionSummaries: MockSessionSummary[] = [
  {
    id: 'session-1',
    title: 'Build a React calculator app',
    status: 'completed',
    pinned: false,
    workspaceId: 'workspace-1',
    source: 'manual',
    createdAt: NOW - HOUR,
    updatedAt: NOW - HOUR / 2,
  },
  {
    id: 'session-2',
    title: 'Research TypeScript best practices',
    status: 'idle',
    pinned: true,
    source: 'manual',
    createdAt: NOW - 2 * HOUR,
    updatedAt: NOW - HOUR,
  },
  {
    id: 'session-3',
    title: 'Analyze sales data and create report',
    status: 'completed',
    pinned: false,
    workspaceId: 'workspace-2',
    source: 'manual',
    createdAt: NOW - 4 * HOUR,
    updatedAt: NOW - 2 * HOUR,
  },
];

export const mockMessages: MockMessage[] = [
  {
    id: 'msg-1',
    type: 'user',
    content: 'Build a React calculator app with basic operations.',
    timestamp: NOW - HOUR,
    sequence: 1,
  },
  {
    id: 'msg-2',
    type: 'assistant',
    content:
      "I'll build the calculator in three steps:\n\n1. Scaffold a `Calculator` component\n2. Implement `+ − × ÷` with keyboard support\n3. Add tests for edge cases such as division by zero\n\n```tsx\nexport function Calculator() {\n  const [display, setDisplay] = useState('0');\n  return <output>{display}</output>;\n}\n```",
    timestamp: NOW - HOUR + 10_000,
    sequence: 2,
  },
];

export function mockSession(id: string): MockSession | undefined {
  const summary = mockSessionSummaries.find(item => item.id === id);
  if (!summary) return undefined;
  const messages = id === 'session-1' ? mockMessages : [];
  return {
    id: summary.id,
    title: summary.title,
    status: summary.status,
    pinned: summary.pinned,
    cwd: mockWorkspaces.find(ws => ws.id === summary.workspaceId)?.path ?? '/home/user',
    systemPrompt: '',
    modelOverride: '',
    executionMode: 'auto',
    activeSkillIds: [],
    workspaceId: summary.workspaceId ?? '',
    agentId: 'main',
    source: summary.source,
    messages,
    messagesOffset: 0,
    totalMessages: messages.length,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
  };
}

export const mockCoworkConfig: MockCoworkConfig = {
  workingDirectory: '/home/user/projects',
  systemPrompt: '',
  executionMode: 'auto',
  permissionMode: 'ask',
  embeddingEnabled: false,
  embeddingProvider: '',
  embeddingModel: '',
  embeddingLocalModelPath: '',
  embeddingVectorWeight: 0.5,
  embeddingRemoteBaseUrl: '',
  embeddingRemoteApiKey: '',
  codemodeEnabled: false,
  mcpNativeBridge: true,
};

export const mockApiConfig: MockApiConfig = {
  apiKey: 'sk-preview',
  baseURL: 'https://api.example.com/v1',
  model: 'preview-model',
  apiType: 'openai',
};

export const mockSkills: Skill[] = [
  {
    id: 'docx',
    name: 'docx',
    description: 'Create and edit Word documents.',
    enabled: true,
    pinned: true,
    isOfficial: true,
    isBuiltIn: true,
    updatedAt: NOW - 24 * HOUR,
    prompt: '',
    skillPath: '/app/SKILLs/docx/SKILL.md',
    displayName: 'Word documents',
  },
  {
    id: 'xlsx',
    name: 'xlsx',
    description: 'Analyze and build spreadsheets.',
    enabled: true,
    pinned: false,
    isOfficial: true,
    isBuiltIn: true,
    updatedAt: NOW - 24 * HOUR,
    prompt: '',
    skillPath: '/app/SKILLs/xlsx/SKILL.md',
    displayName: 'Spreadsheets',
  },
  {
    id: 'web-research',
    name: 'web-research',
    description: 'Search the web and summarize sources.',
    enabled: false,
    pinned: false,
    isOfficial: false,
    isBuiltIn: false,
    updatedAt: NOW - 72 * HOUR,
    prompt: '',
    skillPath: '/home/user/.zhiyuan/skills/web-research/SKILL.md',
  },
];

export const mockMcpServers: MockMcpServer[] = [
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read and write files in allowed folders.',
    enabled: true,
    transportType: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/home/user/projects'],
    isBuiltIn: true,
    createdAt: NOW - 96 * HOUR,
    updatedAt: NOW - 96 * HOUR,
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Issues, pull requests and repositories.',
    enabled: false,
    transportType: 'http',
    url: 'https://api.example.com/mcp',
    isBuiltIn: false,
    createdAt: NOW - 48 * HOUR,
    updatedAt: NOW - 48 * HOUR,
  },
];

export const mockAgents: Agent[] = [
  {
    id: 'main',
    name: 'ZhiYuan Agent',
    description: 'General purpose assistant',
    systemPrompt: '',
    identity: '',
    model: '',
    workingDirectory: '',
    icon: '',
    skillIds: [],
    enabled: true,
    pinned: true,
    isDefault: true,
    source: 'preset',
    presetId: 'main',
    createdAt: NOW - 96 * HOUR,
    updatedAt: NOW - 96 * HOUR,
  },
];
