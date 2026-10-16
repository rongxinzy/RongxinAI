/**
 * Typed fixtures for the browser preview mock.
 * Every shape is derived from the preload contract (`Window['electron']`) so fixtures
 * cannot drift from what the renderer actually receives over IPC.
 */
import {
  DeliveryMode,
  PayloadKind,
  ScheduleKind,
  SessionTarget,
  TaskStatus,
  WakeMode,
} from '../../../scheduledTask/constants';
import type { ScheduledTask } from '../../../scheduledTask/types';
import { ActivitySource, ActivityStatus } from '../../../shared/activity/constants';
import type { ActivityRun } from '../../../shared/activity/types';
import type { MagpieModelCatalog } from '../../../shared/magpie/types';
import type { Agent } from '../../types/agent';
import type { Skill } from '../../types/skill';

type Api = Window['electron'];
type Resolved<F> = F extends (...args: never[]) => Promise<infer R> ? R : never;
type ItemOf<T> = T extends readonly (infer U)[] ? U : never;

export type MockSessionSummary = ItemOf<
  NonNullable<Resolved<Api['cowork']['listSessions']>['sessions']>
>;
export type MockSession = NonNullable<Resolved<Api['cowork']['getSession']>['session']>;
type MockMessage = MockSession['messages'][number];
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

const mockMessages: MockMessage[] = [
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

export const mockMagpieCatalog: MagpieModelCatalog = {
  status: { state: 'running', version: 'preview', enabled: true },
  defaultModelId: 'preview-model',
  models: [
    {
      id: 'preview-model',
      owned_by: 'preview',
      display_name: 'Preview model',
      context_window: 128000,
      reasoning: false,
      modalities: { input: ['text'], output: ['text'] },
    },
  ],
};

export const mockScheduledTasks: ScheduledTask[] = [
  {
    id: 'task-daily-report',
    name: 'Daily sales digest',
    description: 'Summarize yesterday’s sales and post the report.',
    enabled: true,
    schedule: { kind: ScheduleKind.Cron, expr: '0 9 * * 1-5', tz: 'Asia/Shanghai' },
    sessionTarget: SessionTarget.Isolated,
    wakeMode: WakeMode.Now,
    payload: {
      kind: PayloadKind.AgentTurn,
      message: 'Summarize yesterday’s sales from the Sales Analysis workspace.',
    },
    delivery: { mode: DeliveryMode.None },
    workspaceId: 'workspace-2',
    sessionKey: null,
    state: {
      nextRunAtMs: NOW + 20 * HOUR,
      lastRunAtMs: NOW - 4 * HOUR,
      lastStatus: TaskStatus.Success,
      lastError: null,
      lastDurationMs: 42_000,
      runningAtMs: null,
      consecutiveErrors: 0,
    },
    createdAt: new Date(NOW - 96 * HOUR).toISOString(),
    updatedAt: new Date(NOW - 4 * HOUR).toISOString(),
  },
  {
    id: 'task-weekly-research',
    name: 'Weekly research brief',
    description: 'Collect TypeScript release notes every Monday.',
    enabled: false,
    schedule: { kind: ScheduleKind.Every, everyMs: 7 * 24 * HOUR },
    sessionTarget: SessionTarget.Isolated,
    wakeMode: WakeMode.NextHeartbeat,
    payload: {
      kind: PayloadKind.AgentTurn,
      message: 'Summarize TypeScript releases from the past week.',
    },
    delivery: { mode: DeliveryMode.None },
    workspaceId: 'workspace-1',
    sessionKey: null,
    state: {
      nextRunAtMs: null,
      lastRunAtMs: NOW - 8 * 24 * HOUR,
      lastStatus: TaskStatus.Skipped,
      lastError: null,
      lastDurationMs: null,
      runningAtMs: null,
      consecutiveErrors: 0,
    },
    createdAt: new Date(NOW - 14 * 24 * HOUR).toISOString(),
    updatedAt: new Date(NOW - 24 * HOUR).toISOString(),
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

export const mockActivityRuns: ActivityRun[] = [
  {
    id: 'act-1',
    source: ActivitySource.Channel,
    status: ActivityStatus.Running,
    platform: 'weixin',
    startedAt: NOW - 10 * 60_000,
    updatedAt: NOW - 2 * 60_000,
    replyPreview: '正在查询最近30天的系统日志并统计异常分布...',
  },
  {
    id: 'act-2',
    source: ActivitySource.ScheduledTask,
    status: ActivityStatus.Completed,
    taskName: 'Daily sales digest',
    startedAt: NOW - 2 * HOUR,
    updatedAt: NOW - 2 * HOUR + 42_000,
    replyPreview:
      '已完成昨日销售数据汇总：总计成交 1,280 笔，营收环比增长 12.4%。报表已成功同步到销售工作区。',
  },
  {
    id: 'act-3',
    source: ActivitySource.Channel,
    status: ActivityStatus.Completed,
    platform: 'feishu',
    startedAt: NOW - 5 * HOUR,
    updatedAt: NOW - 5 * HOUR + 15_000,
    replyPreview: '已经为您创建了任务【Q3季度复盘】，并邀请了相关参与人员。',
  },
  {
    id: 'act-4',
    source: ActivitySource.Channel,
    status: ActivityStatus.Failed,
    platform: 'dingtalk',
    startedAt: NOW - 26 * HOUR,
    updatedAt: NOW - 26 * HOUR + 5_000,
    errorMessage: '网络连接超时：无法访问企业内部文档知识库服务。',
  },
  {
    id: 'act-5',
    source: ActivitySource.ScheduledTask,
    status: ActivityStatus.Completed,
    taskName: 'Weekly research brief',
    startedAt: NOW - 28 * HOUR,
    updatedAt: NOW - 28 * HOUR + 35_000,
    replyPreview:
      '已收集 TypeScript 5.8 发布的更新要点，包括类型检查性能优化与新的构建配置参数说明。',
  },
];
