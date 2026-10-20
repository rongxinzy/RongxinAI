/**
 * Coding-mode preview fixture (`previewScenario=coding`). The generated
 * codingAgent surface is all stubs, so nothing dynamic renders. This fills a
 * synthetic workspace + room so the coding workbench can be walked through in
 * the browser: a running lane streaming reasoning + assistant markdown, a
 * waiting-elicitation lane with a clarification question, and one code
 * artifact anchoring to the streaming message. Shapes mirror the builders the
 * renderer tests already use (CodingWorkspaceSidebar.test.ts).
 */
import {
  CodingAgentDriverKind,
  CodingAgentProfileStatus,
  CodingAssignmentStatus,
  CodingElicitationStatus,
  CodingEventKind,
  CodingLaneStatus,
  CodingMissionStatus,
  CodingStreamUpdateMode,
  type CodingEvent,
  type CodingRoomSnapshot,
  type CodingWorkspaceSummary,
} from '../../shared/codingAgent';
import { CoworkArtifactRole, CoworkArtifactSource } from '../../shared/cowork/artifacts';
import type { BrowserMockRuntime } from './runtime';
import type { DeepPartial } from './scenarioTypes';

const NOW = Date.now();

type ElectronApi = Window['electron'];

const ROOT = '/home/user/projects/coding-demo';
const PROFILE_ID = 'builtin-zhiyuan';
const MISSION_ID = 'mission-1';
const STREAM_LANE_ID = 'session-stream';
const ELICIT_LANE_ID = 'session-elicit';
const STREAM_MESSAGE_ID = 'msg-1';

const PROFILE = {
  id: PROFILE_ID,
  name: '知远内置',
  description: 'Preview builtin coding agent',
  driverKind: CodingAgentDriverKind.Builtin,
  status: CodingAgentProfileStatus.Ready,
  capabilities: {
    supportsLoadSession: true,
    supportsResumeSession: true,
    supportsPlans: true,
    supportsPermissions: true,
    supportsFilesystem: true,
    supportsTerminal: true,
    supportsConfigOptions: true,
    supportsUsage: true,
    supportsElicitation: true,
  },
  authMethods: [],
  command: null,
  args: [],
  environment: {},
  isBuiltin: true,
};

const workspaceSummary = (): CodingWorkspaceSummary => ({
  id: 'room-1',
  name: 'coding-demo',
  primaryRoot: ROOT,
  defaultProfileId: PROFILE_ID,
  sources: [],
  activeSessionId: STREAM_LANE_ID,
  sessions: [
    {
      id: STREAM_LANE_ID,
      workspaceId: 'room-1',
      missionId: MISSION_ID,
      parentSessionId: null,
      title: '现状报告',
      profileId: PROFILE_ID,
      sourceRoot: ROOT,
      status: CodingLaneStatus.Running,
      createdAt: NOW - 100_000,
      updatedAt: NOW,
    },
    {
      id: ELICIT_LANE_ID,
      workspaceId: 'room-1',
      missionId: MISSION_ID,
      parentSessionId: null,
      title: '重构范围确认',
      profileId: PROFILE_ID,
      sourceRoot: ROOT,
      status: CodingLaneStatus.WaitingElicitation,
      createdAt: NOW - 90_000,
      updatedAt: NOW,
    },
  ],
});

const lane = (id: string, status: CodingLaneStatus) => ({
  id,
  missionId: MISSION_ID,
  profileId: PROFILE_ID,
  modelOverride: null,
  sourceRoot: ROOT,
  executionRoot: ROOT,
  configOptions: [],
  availableCommands: [],
  localSessionId: id,
  remoteSessionId: null,
  status,
  draft: '',
  scrollPosition: 0,
  pendingRecoveryPrompt: null,
  pendingRecoveryContext: null,
});

const assignment = (id: string, laneId: string, title: string, status: CodingAssignmentStatus) => ({
  id,
  missionId: MISSION_ID,
  laneId,
  title,
  instructions: '',
  workflowStage: null,
  previousAssignmentId: null,
  status,
  workbenchTaskId: null,
  workbenchRunId: null,
  createdAt: NOW - 100_000,
  updatedAt: NOW,
});

const STREAM_EVENTS: CodingEvent[] = [
  {
    id: 'ev-user',
    laneId: STREAM_LANE_ID,
    sequence: 1,
    kind: CodingEventKind.Message,
    payload: { role: 'user', content: '写一份 coding-demo 目录的现状报告，并列出重构建议。' },
    createdAt: NOW - 90_000,
  },
  {
    id: 'ev-reason',
    laneId: STREAM_LANE_ID,
    sequence: 2,
    kind: CodingEventKind.Reasoning,
    payload: {
      content: '先扫描目录结构，再按模块给出重构优先级。',
      streamUpdateMode: CodingStreamUpdateMode.Replace,
    },
    createdAt: NOW - 60_000,
  },
  {
    id: 'ev-msg',
    laneId: STREAM_LANE_ID,
    sequence: 3,
    kind: CodingEventKind.MessageDelta,
    payload: {
      messageId: STREAM_MESSAGE_ID,
      role: 'assistant',
      content: '正在分析 coding-demo 目录…',
      streamUpdateMode: CodingStreamUpdateMode.Replace,
    },
    createdAt: NOW - 30_000,
  },
];

const buildSnapshot = (activeLaneId: string | null): CodingRoomSnapshot => ({
  room: {
    id: 'room-1',
    name: 'coding-demo',
    workspaceRoot: ROOT,
    defaultProfileId: PROFILE_ID,
    activeMissionId: MISSION_ID,
    activeLaneId,
  },
  profiles: [PROFILE],
  missions: [
    {
      id: MISSION_ID,
      roomId: 'room-1',
      title: '现状报告',
      goal: '梳理目录并给出重构建议',
      gitBaseline: null,
      status: CodingMissionStatus.Running,
      createdAt: NOW - 100_000,
      updatedAt: NOW,
    },
  ],
  lanes: [
    lane(STREAM_LANE_ID, CodingLaneStatus.Running),
    lane(ELICIT_LANE_ID, CodingLaneStatus.WaitingElicitation),
  ],
  assignments: [
    assignment('asg-1', STREAM_LANE_ID, '现状报告', CodingAssignmentStatus.Running),
    assignment('asg-2', ELICIT_LANE_ID, '重构范围确认', CodingAssignmentStatus.WaitingElicitation),
  ],
  events: STREAM_EVENTS,
  eventWindows: [{ laneId: STREAM_LANE_ID, oldestSequence: 1, newestSequence: 3, hasMore: false }],
  elicitations: [
    {
      id: 'elicit-1',
      laneId: ELICIT_LANE_ID,
      question: '这次重构是只做目录梳理，还是把脚本也一并迁移到新的模块结构里？',
      status: CodingElicitationStatus.Pending,
      createdAt: NOW - 50_000,
      answer: null,
      cancelReason: null,
    },
  ],
});

const STREAM_STEPS = [
  '正在分析 coding-demo 目录…',
  '已读取 package.json 与入口脚本，识别出 12 个模块。',
  '核心结论：`services/` 与 `utils/` 存在循环依赖，建议拆分为独立的共享层。',
  '详见报告：目录共 87 个文件，其中 24 个脚本可归并到 6 个模块。',
];

export function createCodingPreview(runtime: BrowserMockRuntime): DeepPartial<ElectronApi> {
  let streamStep = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  const emitDelta = (): void => {
    if (streamStep >= STREAM_STEPS.length) {
      if (timer) clearInterval(timer);
      timer = null;
      return;
    }
    const content = STREAM_STEPS[streamStep];
    streamStep += 1;
    runtime.emit('codingAgent.onEventDelta', {
      workspaceRoot: ROOT,
      events: [
        {
          id: 'ev-msg',
          laneId: STREAM_LANE_ID,
          sequence: 3,
          kind: CodingEventKind.MessageDelta,
          payload: {
            messageId: STREAM_MESSAGE_ID,
            role: 'assistant',
            content,
            streamUpdateMode: CodingStreamUpdateMode.Replace,
          },
          createdAt: Date.now(),
        },
      ],
    });
  };

  return {
    codingAgent: {
      listProfiles: async () => ({ success: true, profiles: [PROFILE] }),
      listWorkspaces: async () => ({ success: true, workspaces: [workspaceSummary()] }),
      bootstrap: async () => {
        if (!timer) timer = setInterval(emitDelta, 1_200);
        return { success: true, snapshot: buildSnapshot(STREAM_LANE_ID) };
      },
      selectLane: async (input: { workspaceRoot: string; laneId: string }) => ({
        success: true,
        snapshot: buildSnapshot(input.laneId),
      }),
    },
    artifacts: {
      list: async (scopeId: string) => ({
        success: true,
        artifacts:
          scopeId === STREAM_LANE_ID
            ? [
                {
                  id: 'art-1',
                  messageId: STREAM_MESSAGE_ID,
                  runId: null,
                  toolCallId: null,
                  type: 'code',
                  title: '目录现状报告.md',
                  content: '# coding-demo 现状\n\n- 87 个文件\n- 24 个脚本可归并\n',
                  language: 'markdown',
                  fileName: '目录现状报告.md',
                  source: CoworkArtifactSource.Tool,
                  role: CoworkArtifactRole.Deliverable,
                  declared: true,
                  createdAt: 1,
                },
              ]
            : [],
      }),
    },
  };
}
