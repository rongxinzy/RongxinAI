/**
 * PiRuntimeAdapter unit tests.
 *
 * Tests CoworkRuntime contract compliance using mocked Pi SDK modules.
 */

import * as fs from 'fs';
import * as os from 'os';
import path from 'path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CoworkToolActivityEventType,
  CoworkToolActivityPhase,
} from '../../../shared/cowork/toolActivity';
import {
  ModelCapabilityStatus,
  ProviderModelPiApi,
  ProviderModelPiMaxTokensField,
} from '../../../shared/providers';
import { AcademicResearchSkillIds } from '../../../shared/skills/constants';
import { CoworkInterruptionCause } from '../../../shared/cowork/interruption';
import {
  WorkbenchContractKind,
  WorkbenchRunTrigger,
  WorkbenchRunStatus,
  WorkbenchTaskStatus,
} from '../../../shared/workbenchTask';
import { ExpertProductionWorkflowHeading } from './piExpertProductionPrompt';

const hoisted = vi.hoisted(() => {
  const mockSession = {
    prompt: vi.fn().mockResolvedValue(undefined),
    sendUserMessage: vi.fn().mockResolvedValue(undefined),
    steer: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    abortBash: vi.fn(),
    reload: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
  };

  const mockSettingsManagerCreate = vi.fn((cwd: string, agentDir?: string) => ({
    cwd,
    agentDir,
    applyOverrides: vi.fn(),
    getShellPath: vi.fn(),
  }));
  const mockSettingsManagerInMemory = vi.fn(() => ({
    applyOverrides: vi.fn(),
    getShellPath: vi.fn(),
  }));

  return {
    mockSession,
    mockSettingsManagerCreate,
    mockSettingsManagerInMemory,
    mockCreateAgentSession: vi.fn().mockResolvedValue({ session: mockSession }),
    mockDefaultResourceLoader: vi.fn(function (this: { reload: () => Promise<void> }) {
      this.reload = vi.fn().mockResolvedValue(undefined);
    }),
    mockGetAgentDir: vi.fn(() => '/tmp/pi-agent'),
    mockApplyApplicationRuntimeEnv: vi.fn(),
    mockCompleteSimple: vi.fn().mockResolvedValue({ content: [{ text: 'Hello from Pi' }] }),
    mockGetModel: vi.fn((provider: string, modelId: string) => ({
      provider,
      id: modelId,
      baseUrl:
        provider === 'openai'
          ? 'https://api.openai.com/v1'
          : provider === 'moonshotai-cn'
            ? 'https://api.moonshot.cn/v1'
            : undefined,
    })),
    mockModelRuntime: {
      registerProvider: vi.fn(),
      setRuntimeApiKey: vi.fn().mockResolvedValue(undefined),
      getModel: vi.fn(),
    },
    mockModelRuntimeCreate: vi.fn(),
    mockRegisterPiOpenAICompatUpstream: vi.fn(
      async (providerId: string) => `http://127.0.0.1:19191/__pi_openai_compat/${providerId}/v1`,
    ),
    mockResolveRawApiConfig: vi.fn(() => ({
      config: {
        apiKey: 'sk-test',
        baseURL: 'http://127.0.0.1:11434/v1',
        model: 'qwen-local',
        apiType: 'openai' as const,
      },
      providerMetadata: {
        providerName: 'llamacpp',
        codingPlanEnabled: false,
        supportsImage: false,
        modelName: 'qwen-local',
        capabilities: { toolCalling: ModelCapabilityStatus.Supported },
        contextWindow: 32768,
        contextTokens: 32768,
        maxTokens: 4096,
      },
    })),
    mockResolveRawApiConfigForModelRef: vi.fn((modelRef: string) => {
      const [providerName = 'llamacpp', modelName = modelRef] = modelRef.includes('/')
        ? modelRef.split('/')
        : ['llamacpp', modelRef];

      if (providerName === 'openai') {
        return {
          config: {
            apiKey: 'sk-openai',
            baseURL: 'https://api.openai.com/v1',
            model: modelName,
            apiType: 'openai' as const,
          },
          providerMetadata: {
            providerName: 'openai',
            codingPlanEnabled: false,
            supportsImage: true,
            modelName,
            contextWindow: 272000,
            contextTokens: 272000,
            maxTokens: 16384,
          },
        };
      }

      if (providerName === 'moonshot') {
        return {
          config: {
            apiKey: 'sk-moonshot',
            baseURL: 'http://172.18.5.179:3000/v1',
            model: modelName,
            apiType: 'openai' as const,
          },
          providerMetadata: {
            providerName: 'moonshot',
            codingPlanEnabled: false,
            supportsImage: true,
            modelName,
            contextWindow: 262144,
            contextTokens: 262144,
            maxTokens: 32768,
          },
        };
      }

      return {
        config: {
          apiKey: 'sk-test',
          baseURL: 'http://127.0.0.1:11434/v1',
          model: modelName,
          apiType: 'openai' as const,
        },
        providerMetadata: {
          providerName,
          codingPlanEnabled: false,
          supportsImage: false,
          modelName,
          capabilities: { toolCalling: ModelCapabilityStatus.Supported },
          contextWindow: 32768,
          contextTokens: 32768,
          maxTokens: 4096,
        },
      };
    }),
  };
});

// ── Mocks ──

const mockSession = hoisted.mockSession;
const mockCreateAgentSession = hoisted.mockCreateAgentSession;
const mockDefaultResourceLoader = hoisted.mockDefaultResourceLoader;
const mockSettingsManagerCreate = hoisted.mockSettingsManagerCreate;
const mockSettingsManagerInMemory = hoisted.mockSettingsManagerInMemory;
const mockGetModel = hoisted.mockGetModel;
const mockModelRuntime = hoisted.mockModelRuntime;
const mockModelRuntimeCreate = hoisted.mockModelRuntimeCreate;
const mockResolveRawApiConfig = hoisted.mockResolveRawApiConfig;
const mockResolveRawApiConfigForModelRef = hoisted.mockResolveRawApiConfigForModelRef;
const mockRegisterPiOpenAICompatUpstream = hoisted.mockRegisterPiOpenAICompatUpstream;
const mockApplyApplicationRuntimeEnv = hoisted.mockApplyApplicationRuntimeEnv;

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: hoisted.mockCreateAgentSession,
  DefaultResourceLoader: hoisted.mockDefaultResourceLoader,
  SettingsManager: {
    create: hoisted.mockSettingsManagerCreate,
    inMemory: hoisted.mockSettingsManagerInMemory,
  },
  getAgentDir: hoisted.mockGetAgentDir,
  ModelRuntime: {
    create: hoisted.mockModelRuntimeCreate,
  },
}));

vi.mock('@earendil-works/pi-ai/compat', () => ({
  getModel: hoisted.mockGetModel,
  completeSimple: hoisted.mockCompleteSimple,
}));

vi.mock('../claudeSettings', () => ({
  resolveRawApiConfig: hoisted.mockResolveRawApiConfig,
  resolveRawApiConfigForModelRef: hoisted.mockResolveRawApiConfigForModelRef,
}));

vi.mock('./piOpenAICompatProxy', () => ({
  registerPiOpenAICompatUpstream: hoisted.mockRegisterPiOpenAICompatUpstream,
}));

vi.mock('../coworkUtil', async importOriginal => {
  const actual = await importOriginal<typeof import('../coworkUtil')>();
  return {
    ...actual,
    applyApplicationRuntimeEnv: hoisted.mockApplyApplicationRuntimeEnv,
    resolveGitBashPathForPi: vi.fn(() => undefined),
  };
});

import { PiRuntimeAdapter } from './piRuntimeAdapter';
import { PiAskUserQuestionSystemPrompt } from './piAskUserQuestion';
import { DeclareArtifactSystemPrompt } from '../../declareArtifact/tool';
import { PiAgentLoopAction, PiAgentLoopMode, PiAgentLoopToolName } from './piAgentLoop';
import { CoworkErrorKind, type CoworkError } from '../../../common/coworkError';
import { CONVERSATION_HISTORY_TOOL_NAME } from '../../conversationHistory/constants';
import type { CoworkStore } from '../../coworkStore';
import type { WorkbenchTaskService } from '../../workbenchTask/taskService';
import { WorkbenchTaskService as RealWorkbenchTaskService } from '../../workbenchTask/taskService';
import { initializeWorkbenchTaskSchema } from '../../workbenchTask/schema';
import { initializeProductionLoopSchema } from '../../productionLoop/schema';
import {
  PiAssistantStopReason,
  PiBuiltinFileToolName,
  PiContentBlockType,
} from './piWriteTokenLimit';

describe('PiRuntimeAdapter', () => {
  let adapter: PiRuntimeAdapter;
  const temporaryWorkspaceRoots = new Set<string>();
  const createTemporaryWorkspace = (): string => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-runtime-'));
    temporaryWorkspaceRoots.add(workspaceRoot);
    return workspaceRoot;
  };

  beforeEach(() => {
    mockApplyApplicationRuntimeEnv.mockClear();
    vi.clearAllMocks();
    mockModelRuntimeCreate.mockResolvedValue(mockModelRuntime);
    adapter = new PiRuntimeAdapter();
  });

  afterEach(() => {
    for (const workspaceRoot of temporaryWorkspaceRoots) {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
    temporaryWorkspaceRoots.clear();
  });

  // ── Session lifecycle ──

  describe('startSession', () => {
    it('should create a session and subscribe to events', async () => {
      await adapter.startSession('test', 'Hello Pi');
      await adapter.startSession('test-second', 'Hello again');
      expect(mockApplyApplicationRuntimeEnv).toHaveBeenCalledOnce();
      expect(mockApplyApplicationRuntimeEnv).toHaveBeenCalledWith(process.env);
      expect(mockSession.subscribe).toHaveBeenCalled();
      expect(mockSession.prompt).toHaveBeenCalledWith('Hello Pi');
    });

    it('rolls up session memory after a successful agent run', async () => {
      const rollup = vi.fn().mockResolvedValue(null);
      adapter.setSessionSummaryService({ rollup } as never);

      await adapter.startSession('summary-session', 'Remember this', {
        workspaceRoot: '/workspace/project',
      });
      const listener = mockSession.subscribe.mock.calls[0]?.[0] as (event: {
        type: string;
      }) => void;
      listener({ type: 'agent_end' });

      expect(rollup).toHaveBeenCalledWith({
        sessionId: 'summary-session',
        workingDirectory: '/workspace/project',
      });
    });

    it('registers raw conversation search as a separate tool', async () => {
      adapter.setConversationHistoryService({ search: vi.fn(() => []) } as never);

      await adapter.startSession('history-session', 'Find the previous decision');
      const sessionOptions = mockCreateAgentSession.mock.calls[0]?.[0] as {
        customTools: Array<{ name: string }>;
      };

      expect(sessionOptions.customTools.map(tool => tool.name)).toContain(
        CONVERSATION_HISTORY_TOOL_NAME,
      );
    });

    it('initializes a controlled persistent run for academic research', async () => {
      const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-academic-runtime-'));
      try {
        await adapter.startSession('academic-session', 'Research reliable agents', {
          workspaceRoot,
          skillIds: [...AcademicResearchSkillIds],
        });
        expect(mockSession.prompt).toHaveBeenCalledWith(
          expect.stringContaining('Academic research run initialized'),
        );
        expect(
          fs.existsSync(
            path.join(
              workspaceRoot,
              '.zhiyuan',
              'research',
              'academic-session',
              'state',
              'progress.json',
            ),
          ),
        ).toBe(true);
        const sessionOptions = mockCreateAgentSession.mock.calls[0]?.[0] as {
          customTools: Array<{ name: string }>;
        };
        expect(sessionOptions.customTools.map(tool => tool.name)).toEqual(
          expect.arrayContaining(['agent_loop', 'research_state', 'subagent']),
        );
      } finally {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
      }
    });

    it('keeps a sidebar PPT workflow alive when the model ends without a completion signal', async () => {
      const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-ppt-runtime-'));
      try {
        await adapter.startSession('ppt-session', 'Create a deck', {
          workspaceRoot,
          skillIds: ['presentation-studio'],
        });
        const sessionOptions = mockCreateAgentSession.mock.calls[0]?.[0] as {
          customTools: Array<{ name: string }>;
        };
        expect(sessionOptions.customTools.map(tool => tool.name)).toContain('workflow_state');
        expect(mockSession.prompt).toHaveBeenCalledWith(
          expect.stringContaining('Controlled PPT presentation workflow'),
        );

        const listener = mockSession.subscribe.mock.calls[0]?.[0] as (event: {
          type: string;
        }) => void;
        listener({ type: 'agent_end' });
        await Promise.resolve();

        expect(mockSession.prompt).toHaveBeenLastCalledWith(
          expect.stringContaining('workflow continuation'),
          { streamingBehavior: 'followUp' },
        );
      } finally {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
      }
    });

    it('runs an explicit production request through a durable acceptance loop', async () => {
      const onPermissionRequest = vi.fn();
      const onComplete = vi.fn();
      adapter.on('permissionRequest', onPermissionRequest);
      adapter.on('complete', onComplete);

      await adapter.startSession(
        'generic-work-skill',
        'Analyze this codebase, write a review report, and verify the findings',
        {
          skillIds: ['code-review'],
          sessionMode: 'work',
          workspaceRoot: createTemporaryWorkspace(),
        },
      );

      expect(mockSession.prompt).toHaveBeenCalledWith(
        expect.stringContaining('Loop started. Iteration 1. Goal:'),
      );

      const sessionOptions = mockCreateAgentSession.mock.calls[0]?.[0] as {
        customTools: Array<{
          name: string;
          execute(
            toolCallId: string,
            params: Record<string, unknown>,
          ): Promise<{ content: Array<{ text: string }> }>;
        }>;
      };
      const loopTool = sessionOptions.customTools.find(tool => tool.name === 'agent_loop');
      const acceptanceTool = sessionOptions.customTools.find(
        tool => tool.name === 'work_acceptance',
      );
      const skillScriptTool = sessionOptions.customTools.find(
        tool => tool.name === 'run_skill_script',
      );
      expect(loopTool).toBeDefined();
      expect(acceptanceTool).toBeDefined();
      expect(skillScriptTool).toBeDefined();

      const listener = mockSession.subscribe.mock.calls[0]?.[0] as (event: {
        type: string;
      }) => void;
      await loopTool!.execute('done-too-early', {
        action: 'done',
        reason: 'I think it is complete',
      });
      listener({ type: 'agent_end' });
      await Promise.resolve();
      expect(mockSession.prompt).toHaveBeenLastCalledWith(
        expect.stringContaining('has not received explicit user acceptance'),
        { streamingBehavior: 'followUp' },
      );
      expect(onComplete).not.toHaveBeenCalled();

      const acceptance = acceptanceTool!.execute('acceptance-call', {
        summary: 'Implementation and tests are complete.',
      });
      await vi.waitFor(() => expect(onPermissionRequest).toHaveBeenCalledTimes(1));
      const [, acceptanceRequest] = onPermissionRequest.mock.calls[0] as [
        string,
        { requestId: string; toolInput: { questions: Array<{ question: string }> } },
      ];
      const acceptanceQuestion = acceptanceRequest.toolInput.questions[0].question;
      adapter.respondToPermission(acceptanceRequest.requestId, {
        behavior: 'allow',
        updatedInput: { answers: { [acceptanceQuestion]: '验收通过' } },
      });
      await acceptance;
      await loopTool!.execute('done-after-acceptance', {
        action: 'done',
        reason: 'The user accepted the result',
      });
      listener({ type: 'agent_end' });
      expect(onComplete).toHaveBeenCalledOnce();
    });

    it('registers the production workflow only for nontrivial Work turns', async () => {
      const db = new Database(':memory:');
      initializeWorkbenchTaskSchema(db);
      initializeProductionLoopSchema(db);
      const service = new RealWorkbenchTaskService(db);
      adapter.setWorkbenchTaskService(service);

      try {
        await adapter.startSession('production-work', 'Create and validate a release report', {
          sessionMode: 'work',
          workspaceRoot: createTemporaryWorkspace(),
        });
        await adapter.startSession('production-simple', '为什么天空是蓝色的？', {
          sessionMode: 'work',
          workspaceRoot: createTemporaryWorkspace(),
        });
        await adapter.startSession('production-light', '你好', {
          sessionMode: 'work',
          skillIds: ['presentation-studio'],
          workspaceRoot: createTemporaryWorkspace(),
        });
        await adapter.startSession('production-chat', 'Create and validate a release report', {
          sessionMode: 'chat',
          workspaceRoot: createTemporaryWorkspace(),
        });

        const workOptions = mockCreateAgentSession.mock.calls[0]?.[0] as {
          customTools?: Array<{ name: string }>;
        };
        const simpleOptions = mockCreateAgentSession.mock.calls[1]?.[0] as {
          customTools?: Array<{ name: string }>;
        };
        const lightOptions = mockCreateAgentSession.mock.calls[2]?.[0] as {
          customTools?: Array<{ name: string }>;
        };
        const chatOptions = mockCreateAgentSession.mock.calls[3]?.[0] as {
          customTools?: Array<{ name: string }>;
        };
        expect(workOptions.customTools?.map(tool => tool.name)).toContain('production_loop');
        expect(simpleOptions.customTools?.map(tool => tool.name) || []).not.toContain(
          'production_loop',
        );
        expect(lightOptions.customTools?.map(tool => tool.name) || []).not.toContain(
          'production_loop',
        );
        expect(lightOptions.customTools?.map(tool => tool.name) || []).not.toContain(
          'workflow_state',
        );
        expect(chatOptions.customTools?.map(tool => tool.name) || []).not.toContain(
          'production_loop',
        );
        expect(
          db.prepare('SELECT COUNT(*) AS count FROM workbench_production_loops').get(),
        ).toEqual({ count: 1 });
        expect(
          service.getCurrent('production-work')?.task.contract.metadata?.productionWorkflowEnabled,
        ).toBe(true);
        expect(
          service.getCurrent('production-simple')?.task.contract.metadata
            ?.productionWorkflowEnabled,
        ).toBe(false);
      } finally {
        db.close();
      }
    });

    it('coordinates expert methods only inside an active production workflow', async () => {
      const db = new Database(':memory:');
      initializeWorkbenchTaskSchema(db);
      initializeProductionLoopSchema(db);
      const service = new RealWorkbenchTaskService(db);
      adapter.setWorkbenchTaskService(service);

      try {
        await adapter.startSession('expert-production', 'Create and validate a release report', {
          sessionMode: 'work',
          expertIds: ['release-expert'],
          workspaceRoot: createTemporaryWorkspace(),
        });
        await adapter.startSession('expert-direct', '为什么天空是蓝色的？', {
          sessionMode: 'work',
          expertIds: ['science-expert'],
          workspaceRoot: createTemporaryWorkspace(),
        });

        const productionPrompt = mockSession.prompt.mock.calls[0]?.[0] as string;
        const directPrompt = mockSession.prompt.mock.calls[1]?.[0] as string;
        const directOptions = mockCreateAgentSession.mock.calls[1]?.[0] as {
          customTools?: Array<{ name: string }>;
        };

        expect(productionPrompt).toContain(ExpertProductionWorkflowHeading);
        expect(productionPrompt).toContain('expert workflow only as the domain method');
        expect(directPrompt).not.toContain(ExpertProductionWorkflowHeading);
        expect(directOptions.customTools?.map(tool => tool.name) || []).not.toContain(
          'production_loop',
        );
        expect(
          service.getCurrent('expert-direct')?.task.contract.metadata?.productionWorkflowEnabled,
        ).toBe(false);
      } finally {
        db.close();
      }
    });

    it('records non-sensitive runtime context on initial and reused workbench runs', async () => {
      const db = new Database(':memory:');
      initializeWorkbenchTaskSchema(db);
      initializeProductionLoopSchema(db);
      const service = new RealWorkbenchTaskService(db);
      adapter.setWorkbenchTaskService(service);
      const workspaceRoot = createTemporaryWorkspace();

      try {
        await adapter.startSession('audited-runtime', 'Summarize the report', {
          sessionMode: 'chat',
          workspaceRoot,
          skillIds: ['documents'],
        });

        expect(service.getCurrent('audited-runtime')?.runs[0].context).toEqual({
          model: 'qwen-local',
          provider: 'llamacpp',
          reasoningProfile: 'default',
          workspaceRoot,
          skillIds: ['documents'],
        });

        service.pauseRun('audited-runtime', 'Paused for the next turn.');
        await adapter.continueSession('audited-runtime', 'Summarize the appendix', {
          sessionMode: 'chat',
          skillIds: ['documents'],
        });

        const tasks = service.listForSession('audited-runtime');
        expect(tasks).toHaveLength(2);
        for (const task of tasks) {
          expect(service.getDetail(task.id)?.runs[0].context).toEqual({
            model: 'qwen-local',
            provider: 'llamacpp',
            reasoningProfile: 'default',
            workspaceRoot,
            skillIds: ['documents'],
          });
        }
      } finally {
        db.close();
      }
    });

    it('restores the production gate from the owning task on an explicit resume', async () => {
      const db = new Database(':memory:');
      initializeWorkbenchTaskSchema(db);
      initializeProductionLoopSchema(db);
      const service = new RealWorkbenchTaskService(db);
      adapter.setWorkbenchTaskService(service);
      const workspaceRoot = createTemporaryWorkspace();

      try {
        await adapter.startSession('resume-production', 'Create and validate a release report', {
          sessionMode: 'work',
          workspaceRoot,
        });
        const originalTask = service.getCurrent('resume-production')!.task;
        await adapter.stopSession('resume-production');
        const prepared = service.prepareRun(originalTask.id, WorkbenchRunTrigger.Resume);

        await adapter.continueSession('resume-production', 'Continue', {
          sessionMode: 'work',
          workspaceRoot,
          _workbenchRunId: prepared.run.id,
          _productionWorkflowEnabled:
            originalTask.contract.metadata?.productionWorkflowEnabled === true,
          _skipUserMessage: true,
        });

        const resumedOptions = mockCreateAgentSession.mock.calls[1]?.[0] as {
          customTools?: Array<{ name: string }>;
        };
        expect(resumedOptions.customTools?.map(tool => tool.name)).toContain('production_loop');
        expect(service.getCurrent('resume-production')?.task.id).toBe(originalTask.id);
        expect(service.productionLoop.getState(prepared.run.id).goal).toBe(originalTask.goal);
        expect(mockSession.prompt).toHaveBeenLastCalledWith(
          expect.stringContaining('Persistent phase: plan'),
        );
      } finally {
        db.close();
      }
    });

    it('reinjects the production protocol when a reused runtime starts a new task', async () => {
      const db = new Database(':memory:');
      initializeWorkbenchTaskSchema(db);
      initializeProductionLoopSchema(db);
      const service = new RealWorkbenchTaskService(db);
      adapter.setWorkbenchTaskService(service);
      const workspaceRoot = createTemporaryWorkspace();

      try {
        await adapter.startSession('reused-production', 'Create and validate a release report', {
          sessionMode: 'work',
          workspaceRoot,
        });
        await adapter.continueSession(
          'reused-production',
          'Create and validate a second release report',
          {
            sessionMode: 'work',
            workspaceRoot,
          },
        );

        expect(mockCreateAgentSession).toHaveBeenCalledOnce();
        expect(mockSession.prompt).toHaveBeenLastCalledWith(
          expect.stringContaining('## Production workflow'),
        );
        expect(mockSession.prompt).toHaveBeenLastCalledWith(
          expect.stringContaining('Persistent phase: plan'),
        );
      } finally {
        db.close();
      }
    });

    it('does not continue after the owning workbench run is paused', async () => {
      const db = new Database(':memory:');
      initializeWorkbenchTaskSchema(db);
      initializeProductionLoopSchema(db);
      const service = new RealWorkbenchTaskService(db);
      adapter.setWorkbenchTaskService(service);
      const interruptions: Array<{ cause: string; recoverable: boolean }> = [];
      adapter.on('sessionInterrupted', event => interruptions.push(event));

      try {
        await adapter.startSession('paused-production', 'Create and validate a release report', {
          sessionMode: 'work',
          workspaceRoot: createTemporaryWorkspace(),
        });
        const listener = mockSession.subscribe.mock.calls[0]?.[0] as (event: {
          type: string;
        }) => void;
        service.pauseRun('paused-production', 'Paused for test.');

        listener({ type: 'agent_end' });

        expect(mockSession.prompt).toHaveBeenCalledTimes(1);
        expect(mockSession.abort).toHaveBeenCalledOnce();
        expect(adapter.isSessionRunning('paused-production')).toBe(false);
        expect(interruptions).toEqual([
          expect.objectContaining({
            cause: CoworkInterruptionCause.RuntimePaused,
            recoverable: true,
          }),
        ]);
      } finally {
        db.close();
      }
    });

    it('pauses production after three stale continuations', async () => {
      const db = new Database(':memory:');
      initializeWorkbenchTaskSchema(db);
      initializeProductionLoopSchema(db);
      const service = new RealWorkbenchTaskService(db);
      adapter.setWorkbenchTaskService(service);

      try {
        await adapter.startSession('stale-production', 'Create and validate a release report', {
          sessionMode: 'work',
          workspaceRoot: createTemporaryWorkspace(),
        });
        const listener = mockSession.subscribe.mock.calls[0]?.[0] as (event: {
          type: string;
        }) => void;

        listener({ type: 'agent_end' });
        listener({ type: 'agent_end' });
        listener({ type: 'agent_end' });

        expect(mockSession.prompt).toHaveBeenCalledTimes(3);
        expect(mockSession.abort).toHaveBeenCalledOnce();
        expect(service.getCurrent('stale-production')?.runs[0].status).toBe(
          WorkbenchRunStatus.Paused,
        );
        expect(adapter.isSessionRunning('stale-production')).toBe(false);
      } finally {
        db.close();
      }
    });

    it('rebuilds the production workflow topology when follow-up complexity changes', async () => {
      const db = new Database(':memory:');
      initializeWorkbenchTaskSchema(db);
      initializeProductionLoopSchema(db);
      adapter.setWorkbenchTaskService(new RealWorkbenchTaskService(db));

      try {
        await adapter.startSession('adaptive-gate', '你好', {
          sessionMode: 'work',
          workspaceRoot: createTemporaryWorkspace(),
        });
        await adapter.continueSession('adaptive-gate', '修复登录流程中的刷新问题', {
          sessionMode: 'work',
        });
        await adapter.continueSession('adaptive-gate', '解释一下事件循环', {
          sessionMode: 'work',
        });

        const simpleStart = mockCreateAgentSession.mock.calls[0]?.[0] as {
          customTools?: Array<{ name: string }>;
        };
        const complexFollowUp = mockCreateAgentSession.mock.calls[1]?.[0] as {
          customTools?: Array<{ name: string }>;
        };
        const simpleFollowUp = mockCreateAgentSession.mock.calls[2]?.[0] as {
          customTools?: Array<{ name: string }>;
        };
        expect(simpleStart.customTools?.map(tool => tool.name) || []).not.toContain(
          'production_loop',
        );
        expect(complexFollowUp.customTools?.map(tool => tool.name)).toContain('production_loop');
        expect(simpleFollowUp.customTools?.map(tool => tool.name) || []).not.toContain(
          'production_loop',
        );
        expect(mockSession.abort).toHaveBeenCalledTimes(2);
      } finally {
        db.close();
      }
    });

    it('reactivates a completed academic loop when the same session receives a follow-up', async () => {
      const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-academic-follow-up-'));
      try {
        await adapter.startSession('academic-follow-up', 'Research reliable agents', {
          workspaceRoot,
          skillIds: [...AcademicResearchSkillIds],
        });
        const activeSessions = (
          adapter as unknown as {
            activeSessions: Map<
              string,
              {
                agentLoop: {
                  stop(): void;
                  getState(): { active: boolean };
                };
              }
            >;
          }
        ).activeSessions;
        const active = activeSessions.get('academic-follow-up');
        expect(active).toBeDefined();
        active?.agentLoop.stop();
        mockSession.prompt.mockClear();

        await adapter.continueSession('academic-follow-up', 'Investigate a follow-up.', {
          skillIds: [...AcademicResearchSkillIds],
        });

        expect(active?.agentLoop.getState().active).toBe(true);
        expect(mockSession.prompt).toHaveBeenCalledWith(
          expect.stringContaining('Academic research run initialized'),
        );
      } finally {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
      }
    });

    it('should inject the session system prompt through Pi resource loading', async () => {
      await adapter.startSession('test', 'Hello Pi', {
        systemPrompt: 'You are the selected expert.',
      });

      expect(mockDefaultResourceLoader).toHaveBeenCalledWith(
        expect.objectContaining({
          agentDir: '/tmp/pi-agent',
          cwd: process.cwd(),
          noExtensions: true,
          noPromptTemplates: true,
          noSkills: true,
          noThemes: true,
          appendSystemPromptOverride: expect.any(Function),
          systemPromptOverride: expect.any(Function),
        }),
      );
      const loaderOptions = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
        systemPromptOverride: (base: string | undefined) => string | undefined;
      };
      expect(loaderOptions.systemPromptOverride('Pi default prompt')).toBe(
        'You are the selected expert.',
      );
      expect(mockCreateAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceLoader: expect.any(Object),
        }),
      );
      expect(mockCreateAgentSession.mock.calls[0]?.[0]).not.toHaveProperty('systemPrompt');
    });

    it('shares one isolated Pi SettingsManager with resource loading and the agent session', async () => {
      await adapter.startSession('settings-manager', 'Hello Pi');

      expect(mockSettingsManagerInMemory).toHaveBeenCalledOnce();
      expect(mockSettingsManagerCreate).not.toHaveBeenCalled();
      const settingsManager = mockSettingsManagerInMemory.mock.results[0]?.value;
      expect(mockDefaultResourceLoader.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({ settingsManager }),
      );
      expect(mockCreateAgentSession.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({ settingsManager }),
      );
    });

    it('should resolve the explicit model override for a new session', async () => {
      await adapter.startSession('test', 'Hello Pi', { modelOverride: 'llamacpp/qwen-local' });

      expect(mockResolveRawApiConfigForModelRef).toHaveBeenCalledWith('llamacpp/qwen-local');
      expect(mockCreateAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({
            provider: 'llamacpp',
            id: 'qwen-local',
            baseUrl: 'http://127.0.0.1:11434/v1',
          }),
        }),
      );
      expect(mockGetModel).not.toHaveBeenCalled();
      expect(mockModelRuntimeCreate).toHaveBeenCalledWith({ allowModelNetwork: false });
      expect(mockModelRuntime.registerProvider).toHaveBeenCalledWith(
        'llamacpp',
        expect.objectContaining({
          baseUrl: 'http://127.0.0.1:11434/v1',
          api: 'openai-completions',
          models: [expect.objectContaining({ id: 'qwen-local' })],
        }),
      );
      expect(mockModelRuntime.setRuntimeApiKey).toHaveBeenCalledWith('llamacpp', 'sk-test');
      expect(mockCreateAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({ modelRuntime: mockModelRuntime }),
      );
    });

    it('should keep supported remote models on the Pi built-in path', async () => {
      await adapter.startSession('test', 'Hello Pi', { modelOverride: 'openai/gpt-5.2' });

      expect(mockResolveRawApiConfigForModelRef).toHaveBeenCalledWith('openai/gpt-5.2');
      expect(mockGetModel).toHaveBeenCalledWith('openai', 'gpt-5.2');
      expect(mockCreateAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({
            provider: 'openai',
            id: 'gpt-5.2',
          }),
        }),
      );
      // The built-in model stays on Pi's catalog, but the user's API key must
      // still be registered under the built-in provider id — otherwise the
      // session fails with "No API key found for <provider>".
      expect(mockModelRuntimeCreate).toHaveBeenCalledWith({ allowModelNetwork: false });
      expect(mockModelRuntime.registerProvider).not.toHaveBeenCalled();
      expect(mockModelRuntime.setRuntimeApiKey).toHaveBeenCalledWith('openai', 'sk-openai');
      expect(mockCreateAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({ modelRuntime: mockModelRuntime }),
      );
    });

    it('should register the API key under the Pi built-in provider id for MiniMax', async () => {
      mockGetModel.mockImplementationOnce(() => ({
        provider: 'minimax-cn',
        id: 'MiniMax-M3',
        baseUrl: 'https://api.minimaxi.com/anthropic',
      }));
      mockResolveRawApiConfigForModelRef.mockReturnValueOnce({
        config: {
          apiKey: 'sk-cp-minimax',
          baseURL: 'https://api.minimaxi.com/anthropic',
          model: 'MiniMax-M3',
          apiType: 'anthropic' as const,
        },
        providerMetadata: {
          providerName: 'minimax',
          codingPlanEnabled: false,
          supportsImage: false,
          modelName: 'MiniMax-M3',
          contextWindow: 1000000,
          contextTokens: 1000000,
          maxTokens: 128000,
        },
      });

      await adapter.startSession('test', 'Hello Pi', { modelOverride: 'minimax/MiniMax-M3' });

      expect(mockGetModel).toHaveBeenCalledWith('minimax-cn', 'MiniMax-M3');
      expect(mockModelRuntime.registerProvider).not.toHaveBeenCalled();
      expect(mockModelRuntime.setRuntimeApiKey).toHaveBeenCalledWith('minimax-cn', 'sk-cp-minimax');
      expect(mockCreateAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({ provider: 'minimax-cn', id: 'MiniMax-M3' }),
          modelRuntime: mockModelRuntime,
        }),
      );
    });

    it('should register remote custom models with their configured endpoint and API key', async () => {
      mockGetModel.mockImplementationOnce(() => undefined);

      await adapter.startSession('test', 'Hello Pi', {
        modelOverride: 'moonshot/kimi-for-coding',
      });

      expect(mockResolveRawApiConfigForModelRef).toHaveBeenCalledWith('moonshot/kimi-for-coding');
      expect(mockModelRuntime.registerProvider).toHaveBeenCalledWith(
        'moonshot',
        expect.objectContaining({
          baseUrl: 'http://172.18.5.179:3000/v1',
          api: 'openai-completions',
          models: [
            expect.objectContaining({
              provider: 'moonshot',
              id: 'kimi-for-coding',
              baseUrl: 'http://172.18.5.179:3000/v1',
            }),
          ],
        }),
      );
      expect(mockModelRuntime.setRuntimeApiKey).toHaveBeenCalledWith('moonshot', 'sk-moonshot');
      expect(mockCreateAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({
            provider: 'moonshot',
            id: 'kimi-for-coding',
            baseUrl: 'http://172.18.5.179:3000/v1',
          }),
          modelRuntime: mockModelRuntime,
        }),
      );
    });

    it('should route custom OpenAI completions models through the compatibility proxy', async () => {
      mockGetModel.mockImplementationOnce(() => undefined);
      mockResolveRawApiConfigForModelRef.mockReturnValueOnce({
        config: {
          apiKey: 'sk-custom',
          baseURL: 'https://gateway.example',
          model: 'agent-model',
          apiType: 'openai' as const,
        },
        providerMetadata: {
          providerName: 'custom_1',
          codingPlanEnabled: false,
          supportsImage: false,
          modelName: 'Agent Model',
          contextWindow: 128000,
          maxTokens: 16000,
        },
      });

      await adapter.startSession('test', 'Hello Pi', {
        modelOverride: 'custom_1/agent-model',
      });

      expect(mockRegisterPiOpenAICompatUpstream).toHaveBeenCalledWith('custom_1', {
        baseURL: 'https://gateway.example',
        apiKey: 'sk-custom',
      });
      expect(mockModelRuntime.registerProvider).toHaveBeenCalledWith(
        'custom_1',
        expect.objectContaining({
          baseUrl: 'http://127.0.0.1:19191/__pi_openai_compat/custom_1/v1',
          api: ProviderModelPiApi.OpenAICompletions,
          models: [
            expect.objectContaining({
              provider: 'custom_1',
              id: 'agent-model',
              baseUrl: 'http://127.0.0.1:19191/__pi_openai_compat/custom_1/v1',
            }),
          ],
        }),
      );
      expect(mockCreateAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({
            provider: 'custom_1',
            id: 'agent-model',
            baseUrl: 'http://127.0.0.1:19191/__pi_openai_compat/custom_1/v1',
          }),
        }),
      );
    });

    it('should pass configured Pi runtime options to custom models', async () => {
      mockGetModel.mockImplementationOnce(() => undefined);
      mockResolveRawApiConfigForModelRef.mockReturnValueOnce({
        config: {
          apiKey: 'sk-custom',
          baseURL: 'https://custom.example/v1',
          model: 'agent-model',
          apiType: 'openai' as const,
        },
        providerMetadata: {
          providerName: 'custom_0',
          codingPlanEnabled: false,
          supportsImage: false,
          modelName: 'Agent Model',
          contextWindow: 128000,
          maxTokens: 16000,
          capabilities: {
            imageInput: ModelCapabilityStatus.Supported,
            reasoning: ModelCapabilityStatus.Supported,
          },
          piRuntime: {
            api: ProviderModelPiApi.OpenAIResponses,
            reasoning: true,
            compat: {
              supportsDeveloperRole: false,
              maxTokensField: ProviderModelPiMaxTokensField.MaxTokens,
              requiresToolResultName: true,
            },
          },
        },
      });

      await adapter.startSession('test', 'Hello Pi', {
        modelOverride: 'custom_0/agent-model',
      });

      expect(mockModelRuntime.registerProvider).toHaveBeenCalledWith(
        'custom_0',
        expect.objectContaining({
          baseUrl: 'https://custom.example/v1',
          api: ProviderModelPiApi.OpenAIResponses,
          models: [
            expect.objectContaining({
              provider: 'custom_0',
              id: 'agent-model',
              api: ProviderModelPiApi.OpenAIResponses,
              reasoning: true,
              input: ['text', 'image'],
              compat: {
                supportsDeveloperRole: false,
                maxTokensField: ProviderModelPiMaxTokensField.MaxTokens,
                requiresToolResultName: true,
              },
            }),
          ],
        }),
      );
      expect(mockModelRuntime.setRuntimeApiKey).toHaveBeenCalledWith('custom_0', 'sk-custom');
    });

    it('should not reuse a built-in model when the configured endpoint differs', async () => {
      await adapter.startSession('test', 'Hello Pi', {
        modelOverride: 'moonshot/kimi-k2.6',
      });

      expect(mockGetModel).toHaveBeenCalledWith('moonshotai-cn', 'kimi-k2.6');
      expect(mockModelRuntime.registerProvider).toHaveBeenCalledWith(
        'moonshot',
        expect.objectContaining({
          baseUrl: 'http://172.18.5.179:3000/v1',
          models: [expect.objectContaining({ id: 'kimi-k2.6' })],
        }),
      );
      expect(mockModelRuntime.setRuntimeApiKey).toHaveBeenCalledWith('moonshot', 'sk-moonshot');
      expect(mockCreateAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({ modelRuntime: mockModelRuntime }),
      );
    });

    it('should make session active after start', async () => {
      expect(adapter.isSessionActive('test')).toBe(false);
      await adapter.startSession('test', 'Hello');
      expect(adapter.isSessionActive('test')).toBe(true);
    });

    it('uses the cloud fallback when provider metadata has no capacity limits', async () => {
      mockResolveRawApiConfig.mockReturnValueOnce({
        config: {
          apiKey: 'sk-cloud',
          baseURL: 'https://example.com/v1',
          model: 'unknown-cloud-model',
          apiType: 'openai',
        },
        providerMetadata: {
          providerName: 'custom_0',
          codingPlanEnabled: false,
          supportsImage: false,
        },
      });

      await adapter.startSession('cloud-fallback', 'Hello Pi');

      expect(mockCreateAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({
            contextWindow: 256000,
            maxTokens: 32768,
          }),
        }),
      );
    });

    it('should throw on empty prompt with no images', async () => {
      await expect(adapter.startSession('test', '')).rejects.toThrow('Prompt is required.');
    });

    it('forwards image attachments to vision-capable models', async () => {
      mockResolveRawApiConfig.mockReturnValueOnce({
        config: {
          apiKey: 'sk-vision',
          baseURL: 'https://api.moonshot.cn/v1',
          model: 'kimi-k2.6',
          apiType: 'openai',
        },
        providerMetadata: {
          providerName: 'moonshot',
          codingPlanEnabled: false,
          supportsImage: true,
          capabilities: { imageInput: ModelCapabilityStatus.Supported },
        },
      });

      await adapter.startSession('vision', 'Describe this image', {
        imageAttachments: [{ name: 'example.png', mimeType: 'image/png', base64Data: 'aW1hZ2U=' }],
      });

      expect(mockSession.sendUserMessage).toHaveBeenCalledWith(
        [
          { type: 'text', text: 'Describe this image' },
          { type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' },
        ],
        undefined,
      );
    });

    it('keeps an image attachment as a text hint for non-vision models', async () => {
      await adapter.startSession('text-only', 'Describe this image', {
        imageAttachments: [{ name: 'example.png', mimeType: 'image/png', base64Data: 'aW1hZ2U=' }],
      });

      expect(mockSession.prompt).toHaveBeenCalledWith(
        'Describe this image\n\n[image attachments were not sent because the selected model has no confirmed image support]',
      );
    });

    it('should replace existing session with same id', async () => {
      await adapter.startSession('test', 'First');
      const staleListener = mockSession.subscribe.mock.calls[0]?.[0] as (event: {
        type: string;
      }) => void;
      await adapter.startSession('test', 'Second');
      // Old session aborted, new one created
      expect(mockSession.abort).toHaveBeenCalled();
      expect(mockSession.prompt).toHaveBeenCalledTimes(2);

      staleListener({ type: 'agent_end' });

      expect(adapter.isSessionRunning('test')).toBe(true);
      expect(mockSession.abort).toHaveBeenCalledTimes(1);
    });
  });

  describe('continueSession', () => {
    it('should fall back to startSession for unknown session', async () => {
      await adapter.continueSession('unknown', 'Hello');
      // Should not throw; falls back to creating new session
      expect(mockSession.subscribe).toHaveBeenCalled();
    });

    it('should reuse existing session for continuation', async () => {
      await adapter.startSession('test', 'First');
      await adapter.continueSession('test', 'Second');
      // prompt() called twice total (once for start, once for continue)
      expect(mockSession.prompt).toHaveBeenCalledTimes(2);
    });

    it('recreates the session after MCP discovery refreshes its tool topology', async () => {
      adapter.setMcpServerManager({
        toolManifest: [{ server: 'Supabase', name: 'list_projects', description: 'List projects' }],
      } as never);
      await adapter.startSession('test', 'First');

      adapter.refreshMcpTools();
      await adapter.continueSession('test', 'Use Supabase');

      expect(mockSession.abort).toHaveBeenCalledOnce();
      expect(mockCreateAgentSession).toHaveBeenCalledTimes(2);
      const replacementOptions = mockCreateAgentSession.mock.calls[1]?.[0] as {
        customTools?: Array<{ name: string }>;
      };
      expect(replacementOptions.customTools?.map(tool => tool.name)).toContain('mcp');
    });

    it('persists the selected expert on a continuation user message', async () => {
      const addMessage = vi.fn((_sessionId: string, message: Record<string, unknown>) => message);

      await adapter.startSession('test', 'First', { expertIds: ['expert-a'] });
      adapter.setCoworkStore({
        addMessage,
        getSession: vi.fn(() => ({
          experts: [
            {
              expertId: 'expert-a',
              expertName: 'Expert A',
              packageId: 'package-a',
            },
          ],
        })),
        updateSession: vi.fn(),
      } as unknown as CoworkStore);

      await adapter.continueSession('test', 'Second', { expertIds: ['expert-a'] });

      expect(addMessage).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({
          type: 'user',
          content: 'Second',
          metadata: {
            experts: [
              {
                expertId: 'expert-a',
                expertName: 'Expert A',
                presetId: 'package-a',
              },
            ],
          },
        }),
      );
    });

    it('should reload an active session when its system prompt changes', async () => {
      await adapter.startSession('test', 'First', { systemPrompt: 'You are the original expert.' });
      await adapter.continueSession('test', 'Second', {
        systemPrompt: 'You are the replacement expert.',
      });

      expect(mockSession.reload).toHaveBeenCalledOnce();
      expect(mockSession.abort).not.toHaveBeenCalled();
      expect(mockDefaultResourceLoader).toHaveBeenCalledOnce();
      expect(mockCreateAgentSession).toHaveBeenCalledOnce();
      expect(mockSession.prompt).toHaveBeenCalledTimes(2);
    });

    it('should not reload or recreate an active session when resources are unchanged', async () => {
      const options = { systemPrompt: 'Stable prompt', skillIds: ['skill-b', 'skill-a'] };
      await adapter.startSession('test', 'First', options);
      await adapter.continueSession('test', 'Second', options);
      await adapter.continueSession('test', 'Third', options);

      expect(mockSession.reload).not.toHaveBeenCalled();
      expect(mockCreateAgentSession).toHaveBeenCalledOnce();
      expect(mockSession.prompt).toHaveBeenCalledTimes(3);
    });

    it('should recreate the session when skill tool topology changes', async () => {
      await adapter.startSession('test', 'First', { skillIds: ['skill-a'] });
      await adapter.continueSession('test', 'Second', { skillIds: ['skill-b'] });

      expect(mockSession.reload).not.toHaveBeenCalled();
      expect(mockSession.abort).toHaveBeenCalledOnce();
      expect(mockCreateAgentSession).toHaveBeenCalledTimes(2);
      const replacementLoader = mockDefaultResourceLoader.mock.calls[1]?.[0] as {
        skillsOverride: (base: { skills: Array<{ id: string }>; diagnostics: unknown[] }) => {
          skills: Array<{ id: string }>;
        };
      };
      expect(
        replacementLoader.skillsOverride({
          skills: [{ id: 'skill-a' }, { id: 'skill-b' }],
          diagnostics: [],
        }).skills,
      ).toEqual([{ id: 'skill-b' }]);
    });

    it('creates only one workbench run when skill topology changes', async () => {
      const beginRun = vi.fn().mockImplementation((_input: unknown) => ({
        run: { id: `run-${beginRun.mock.calls.length}` },
      }));
      adapter.setWorkbenchTaskService({
        beginRun,
        updateRunContext: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as WorkbenchTaskService);

      await adapter.startSession('test', 'First', { skillIds: ['skill-a'] });
      await adapter.continueSession('test', 'Second', { skillIds: ['skill-b'] });

      expect(beginRun).toHaveBeenCalledTimes(2);
    });

    it('authorizes follow-up tool calls against the current workbench run', async () => {
      const beginRun = vi.fn().mockImplementation((_input: unknown) => ({
        run: { id: `run-${beginRun.mock.calls.length}` },
      }));
      const authorizeToolCall = vi.fn().mockResolvedValue({ allow: true });
      adapter.setWorkbenchTaskService({
        beginRun,
        authorizeToolCall,
        updateRunContext: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as WorkbenchTaskService);

      await adapter.startSession('test', 'First');
      const loaderOptions = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
        extensionFactories?: Array<
          (api: {
            on: (
              event: 'tool_call',
              handler: (toolCall: {
                toolCallId: string;
                toolName: string;
                input: Record<string, unknown>;
              }) => Promise<unknown>,
            ) => void;
          }) => void
        >;
      };
      let handleToolCall:
        | ((toolCall: {
            toolCallId: string;
            toolName: string;
            input: Record<string, unknown>;
          }) => Promise<unknown>)
        | undefined;
      loaderOptions.extensionFactories?.[0]({
        on: (_event, handler) => {
          handleToolCall = handler;
        },
      });

      await handleToolCall?.({
        toolCallId: 'first-call',
        toolName: 'write',
        input: { path: 'first.txt' },
      });
      await adapter.continueSession('test', 'Second');
      await handleToolCall?.({
        toolCallId: 'second-call',
        toolName: 'write',
        input: { path: 'second.txt' },
      });

      expect(authorizeToolCall).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ runId: 'run-1', toolCallId: 'first-call' }),
      );
      expect(authorizeToolCall).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ runId: 'run-2', toolCallId: 'second-call' }),
      );
    });

    it('starts the Goal loop only when Work explicitly enables goal mode', async () => {
      await adapter.startSession('goal-work', 'Finish the requested task', {
        sessionMode: 'work',
        goalMode: true,
      });

      expect(mockSession.prompt).toHaveBeenCalledWith(
        expect.stringContaining('Loop started. Iteration 1. Goal: Finish the requested task'),
      );
    });

    it('restarts a completed Goal loop with the full loop protocol prompt', async () => {
      await adapter.startSession('goal-restart', 'First goal', {
        sessionMode: 'work',
        goalMode: true,
      });
      const activeSessions = (
        adapter as unknown as {
          activeSessions: Map<string, { agentLoop: { stop(): void } }>;
        }
      ).activeSessions;
      activeSessions.get('goal-restart')?.agentLoop.stop();

      await adapter.continueSession('goal-restart', 'Second goal', {
        sessionMode: 'work',
        goalMode: true,
      });

      expect(mockSession.prompt).toHaveBeenLastCalledWith(
        expect.stringContaining('Loop started. Iteration 1. Goal: Second goal'),
      );
    });

    it('keeps a lightweight turn outside the durable loop when a skill is added', async () => {
      const workspaceRoot = createTemporaryWorkspace();
      await adapter.startSession('dynamic-skill', 'First', { sessionMode: 'work', workspaceRoot });

      await adapter.continueSession('dynamic-skill', 'Read package.json', {
        skillIds: ['code-review'],
        sessionMode: 'work',
        workspaceRoot,
      });
      expect(mockCreateAgentSession).toHaveBeenCalledTimes(2);
      expect(mockSession.abort).toHaveBeenCalledOnce();
      expect(mockSession.prompt).toHaveBeenLastCalledWith('Read package.json');
      const recreatedOptions = mockCreateAgentSession.mock.calls[1]?.[0] as {
        customTools?: Array<{ name: string }>;
      };
      expect(recreatedOptions.customTools?.map(tool => tool.name) || []).not.toContain(
        'work_acceptance',
      );
    });

    it('removes completed production controllers before a greeting in the same session', async () => {
      const workspaceRoot = createTemporaryWorkspace();
      await adapter.startSession('production-to-greeting', 'Create a 10-page PPT', {
        skillIds: ['presentation-studio'],
        sessionMode: 'work',
        workspaceRoot,
      });
      const activeSessions = (
        adapter as unknown as {
          activeSessions: Map<string, { agentLoop: { stop(): void } }>;
        }
      ).activeSessions;
      activeSessions.get('production-to-greeting')?.agentLoop.stop();

      await adapter.continueSession('production-to-greeting', '你好', {
        skillIds: ['presentation-studio'],
        sessionMode: 'work',
        workspaceRoot,
      });

      expect(mockCreateAgentSession).toHaveBeenCalledTimes(2);
      expect(mockSession.abort).toHaveBeenCalledOnce();
      const greetingOptions = mockCreateAgentSession.mock.calls[1]?.[0] as {
        customTools?: Array<{ name: string }>;
      };
      expect(greetingOptions.customTools?.map(tool => tool.name) || []).not.toContain(
        'production_loop',
      );
      expect(greetingOptions.customTools?.map(tool => tool.name) || []).not.toContain(
        'workflow_state',
      );
    });

    it('starts a fresh generic task after a shortcut approval is denied', async () => {
      const db = new Database(':memory:');
      initializeWorkbenchTaskSchema(db);
      initializeProductionLoopSchema(db);
      const service = new RealWorkbenchTaskService(db);
      adapter.setWorkbenchTaskService(service);
      const workspaceRoot = createTemporaryWorkspace();

      try {
        await adapter.startSession('denied-shortcut', 'Create a 10-page presentation', {
          skillIds: ['presentation-studio'],
          sessionMode: 'work',
          workspaceRoot,
        });
        const first = service.getCurrent('denied-shortcut')!;
        const authorization = service.authorizeToolCall({
          sessionId: 'denied-shortcut',
          runId: first.task.activeRunId!,
          toolCallId: 'write-call',
          toolName: 'write',
          toolInput: { path: 'slides.md', content: 'draft' },
          autoApprove: false,
        });
        const approval = service.getDetail(first.task.id)?.approvals[0];
        service.respondToApproval({ approvalId: approval!.id, approved: false });
        await authorization;

        await adapter.continueSession('denied-shortcut', 'Hello', {
          skillIds: ['presentation-studio'],
          sessionMode: 'work',
          workspaceRoot,
        });

        const current = service.getCurrent('denied-shortcut')!;
        expect(current.task.id).not.toBe(first.task.id);
        expect(current.task.contract.kind).toBe(WorkbenchContractKind.GenericWork);
        expect(service.getDetail(first.task.id)?.task.status).toBe(WorkbenchTaskStatus.Cancelled);
        const greetingOptions = mockCreateAgentSession.mock.calls[1]?.[0] as {
          customTools?: Array<{ name: string }>;
        };
        expect(greetingOptions.customTools?.map(tool => tool.name) || []).not.toContain(
          'production_loop',
        );
      } finally {
        db.close();
      }
    });

    it('should recreate the session when expert tool topology changes', async () => {
      await adapter.startSession('test', 'First', { expertIds: ['expert-a'] });
      await adapter.continueSession('test', 'Second', { expertIds: ['expert-b'] });

      expect(mockSession.abort).toHaveBeenCalledOnce();
      expect(mockCreateAgentSession).toHaveBeenCalledTimes(2);
      expect(mockSession.reload).not.toHaveBeenCalled();
    });
  });

  describe('stopSession', () => {
    it('keeps agent-backed chat interruptions on the normal continuation path', async () => {
      const db = new Database(':memory:');
      initializeWorkbenchTaskSchema(db);
      initializeProductionLoopSchema(db);
      const service = new RealWorkbenchTaskService(db);
      adapter.setWorkbenchTaskService(service);
      const interruptions: Array<{ taskId: string | null; recoverable: boolean }> = [];
      adapter.on('sessionInterrupted', event => interruptions.push(event));

      try {
        await adapter.startSession('chat-session', 'Hello', { sessionMode: 'chat' });
        adapter.stopSession('chat-session');

        expect(interruptions).toEqual([
          expect.objectContaining({ taskId: null, recoverable: false }),
        ]);
      } finally {
        db.close();
      }
    });

    it('cancels a session while the runtime is still initializing', async () => {
      let resolveCreateSession: ((value: { session: typeof mockSession }) => void) | undefined;
      mockCreateAgentSession.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveCreateSession = resolve;
          }),
      );
      const interruptions: Array<{ cause: string }> = [];
      adapter.on('sessionInterrupted', event => interruptions.push(event));

      const startPromise = adapter.startSession('initializing', 'Hello');
      await vi.waitFor(() => expect(mockCreateAgentSession).toHaveBeenCalledOnce());
      adapter.stopSession('initializing');
      resolveCreateSession?.({ session: mockSession });
      await startPromise;

      expect(mockSession.prompt).not.toHaveBeenCalled();
      expect(mockSession.abort).toHaveBeenCalledOnce();
      expect(adapter.isSessionActive('initializing')).toBe(false);
      expect(interruptions).toEqual([
        expect.objectContaining({ cause: CoworkInterruptionCause.UserStop }),
      ]);
    });

    it('should keep session entry active (preserves IM routing) but mark it aborted', async () => {
      await adapter.startSession('test', 'Hello');
      const addMessage = vi.fn(
        (_sessionId: string, message: Parameters<CoworkStore['addMessage']>[1]) => ({
          ...message,
          id: 'persisted-interruption',
          timestamp: Date.now(),
        }),
      );
      const updateSession = vi.fn();
      adapter.setCoworkStore({ addMessage, updateSession } as unknown as CoworkStore);
      const interruptions: Array<{ cause: string; recoverable: boolean }> = [];
      adapter.on('sessionInterrupted', event => interruptions.push(event));
      adapter.stopSession('test');
      adapter.stopSession('test');
      // Session entry stays active so isSessionActive still reports true for IM,
      // but the underlying Pi session is marked aborted.
      expect(adapter.isSessionActive('test')).toBe(true);
      expect(mockSession.abort).toHaveBeenCalled();
      expect(addMessage).toHaveBeenCalledOnce();
      expect(addMessage).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({
          type: 'system',
          metadata: {
            interruption: expect.objectContaining({
              cause: CoworkInterruptionCause.UserStop,
              recoverable: false,
            }),
          },
        }),
      );
      expect(updateSession).toHaveBeenCalledWith('test', { status: 'idle' });
      expect(interruptions).toEqual([
        expect.objectContaining({
          cause: CoworkInterruptionCause.UserStop,
          recoverable: false,
        }),
      ]);
    });

    it('should cause continueSession to reconstruct after stop', async () => {
      await adapter.startSession('test', 'Hello');
      adapter.stopSession('test');
      await adapter.continueSession('test', 'Next');
      // After stop, continueSession must not reuse the aborted Pi session.
      // It reconstructs from store history, creating a fresh Pi session.
      expect(mockSession.subscribe).toHaveBeenCalledTimes(2);
      expect(mockCreateAgentSession).toHaveBeenCalledTimes(2);
    });

    it('should be safe to call on unknown session', () => {
      adapter.stopSession('unknown');
      // Should not throw
    });
  });

  describe('stopAllSessions', () => {
    it('cancels sessions that are still initializing', async () => {
      let resolveCreateSession: ((value: { session: typeof mockSession }) => void) | undefined;
      mockCreateAgentSession.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveCreateSession = resolve;
          }),
      );

      const startPromise = adapter.startSession('initializing', 'Hello');
      await vi.waitFor(() => expect(mockCreateAgentSession).toHaveBeenCalledOnce());
      adapter.stopAllSessions();
      resolveCreateSession?.({ session: mockSession });
      await startPromise;

      expect(mockSession.prompt).not.toHaveBeenCalled();
      expect(mockSession.abort).toHaveBeenCalledOnce();
    });

    it('should keep all sessions active (preserves history)', async () => {
      await adapter.startSession('s1', 'A');
      await adapter.startSession('s2', 'B');
      adapter.stopAllSessions();
      // Sessions stay active so continueSession can find them
      expect(adapter.isSessionActive('s1')).toBe(true);
      expect(adapter.isSessionActive('s2')).toBe(true);
    });
  });

  // ── Session state ──

  describe('isSessionActive', () => {
    it('should return false for unknown session', () => {
      expect(adapter.isSessionActive('nope')).toBe(false);
    });
  });

  describe('getSessionConfirmationMode', () => {
    it('should return null for unknown session', () => {
      expect(adapter.getSessionConfirmationMode('nope')).toBeNull();
    });

    it('should return modal by default', async () => {
      await adapter.startSession('test', 'Hello');
      expect(adapter.getSessionConfirmationMode('test')).toBe('modal');
    });

    it('should return text when Chat mode is set', async () => {
      await adapter.startSession('test', 'Hello', { confirmationMode: 'text' });
      expect(adapter.getSessionConfirmationMode('test')).toBe('text');
      const loaderOptions = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
        appendSystemPromptOverride: () => string[];
      };
      expect(loaderOptions.appendSystemPromptOverride()).toEqual([
        PiAskUserQuestionSystemPrompt,
        DeclareArtifactSystemPrompt,
      ]);
    });
  });

  // ── Model updates ──

  describe('patchSession', () => {
    it('should update the model and reload its write budget when the output limit changes', async () => {
      await adapter.startSession('test', 'Hello');
      await adapter.patchSession('test', { model: 'openai/gpt-5.2' });
      expect(mockSession.setModel).toHaveBeenCalled();
      expect(mockResolveRawApiConfigForModelRef).toHaveBeenCalledWith('openai/gpt-5.2');
      expect(mockSession.reload).toHaveBeenCalledOnce();

      const loaderOptions = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
        appendSystemPromptOverride: () => string[];
      };
      expect(loaderOptions.appendSystemPromptOverride()[2]).toContain('8000 characters');
    });

    it('should not call setModel when no model in patch', async () => {
      await adapter.startSession('test', 'Hello');
      await adapter.patchSession('test', {});
      expect(mockSession.setModel).not.toHaveBeenCalled();
    });

    it('should be a no-op for unknown session', async () => {
      await expect(adapter.patchSession('nope', { model: 'x' })).resolves.not.toThrow();
    });
  });

  // ── Permission ──

  describe('respondToPermission', () => {
    it('should be a no-op for unknown request IDs', () => {
      expect(() => adapter.respondToPermission('unknown', { behavior: 'allow' })).not.toThrow();
      expect(() =>
        adapter.respondToPermission('unknown', { behavior: 'deny', message: 'no' }),
      ).not.toThrow();
    });

    it('aborts the active Pi turn when a workbench approval is denied', async () => {
      const db = new Database(':memory:');
      initializeWorkbenchTaskSchema(db);
      initializeProductionLoopSchema(db);
      const service = new RealWorkbenchTaskService(db);
      adapter.setWorkbenchTaskService(service);
      const requests: string[] = [];
      const interruptions: Array<{
        cause: string;
        taskId: string | null;
        recoverable: boolean;
      }> = [];
      adapter.on('permissionRequest', (_sessionId, request) => requests.push(request.requestId));
      adapter.on('sessionInterrupted', event => interruptions.push(event));

      try {
        await adapter.startSession('denied-workbench', 'Create and validate a release report', {
          sessionMode: 'work',
          workspaceRoot: createTemporaryWorkspace(),
        });
        const detail = service.getCurrent('denied-workbench');
        const authorization = service.authorizeToolCall({
          sessionId: 'denied-workbench',
          runId: detail!.task.activeRunId!,
          toolCallId: 'write-call',
          toolName: 'write',
          toolInput: { path: 'release.md', content: 'draft' },
          autoApprove: false,
        });
        await vi.waitFor(() => expect(requests).toHaveLength(1));

        adapter.respondToPermission(requests[0], {
          behavior: 'deny',
          message: 'Do not write this file.',
        });

        await expect(authorization).resolves.toEqual({
          allow: false,
          reason: 'Do not write this file.',
        });
        expect(mockSession.abortBash).toHaveBeenCalledOnce();
        expect(mockSession.abort).toHaveBeenCalledOnce();
        expect(adapter.isSessionRunning('denied-workbench')).toBe(false);
        expect(service.getCurrent('denied-workbench')?.runs[0].status).toBe(
          WorkbenchRunStatus.Paused,
        );
        expect(interruptions).toEqual([
          expect.objectContaining({
            cause: CoworkInterruptionCause.ApprovalDenied,
            taskId: detail!.task.id,
            recoverable: true,
          }),
        ]);
      } finally {
        db.close();
      }
    });

    it('appends the AskUserQuestion policy when a custom system prompt is configured', async () => {
      await adapter.startSession('test', 'Hello Pi', { systemPrompt: 'Custom instructions' });

      const loaderOptions = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
        appendSystemPromptOverride: () => string[];
      };
      expect(loaderOptions.appendSystemPromptOverride()).toEqual([
        PiAskUserQuestionSystemPrompt,
        expect.stringContaining('## Local document reading'),
        expect.stringContaining('## Large File Writes'),
        DeclareArtifactSystemPrompt,
      ]);
    });

    it('resolves a Pi AskUserQuestion tool call with the renderer response', async () => {
      const permissionRequests: Array<{ requestId: string; toolInput: Record<string, unknown> }> =
        [];
      const dismissals: string[] = [];
      adapter.on('permissionRequest', (_sessionId, request) => {
        permissionRequests.push({ requestId: request.requestId, toolInput: request.toolInput });
      });
      adapter.on('permissionDismiss', requestId => dismissals.push(requestId));

      await adapter.startSession('test', 'Ask me something');
      const sessionOptions = mockCreateAgentSession.mock.calls[0]?.[0] as {
        customTools?: Array<{
          name: string;
          execute: (
            toolCallId: string,
            params: Record<string, unknown>,
          ) => Promise<{
            content: Array<{ text: string }>;
          }>;
        }>;
      };
      const askUserTool = sessionOptions.customTools?.find(tool => tool.name === 'AskUserQuestion');
      expect(askUserTool).toBeDefined();

      const toolResult = askUserTool!.execute('tool-call-1', {
        questions: [
          {
            question: 'Continue?',
            options: [{ label: 'Yes' }, { label: 'No' }],
          },
        ],
      });
      await vi.waitFor(() => expect(permissionRequests).toHaveLength(1));

      adapter.respondToPermission(permissionRequests[0].requestId, {
        behavior: 'allow',
        updatedInput: { answers: { 'Continue?': 'Yes' } },
      });

      await expect(toolResult).resolves.toMatchObject({
        content: [{ text: 'Continue?: Yes' }],
      });
      expect(dismissals).toEqual([permissionRequests[0].requestId]);
    });

    it('keeps AskUserQuestion waits isolated to their owning Pi session', async () => {
      const permissionRequests: Array<{ sessionId: string; requestId: string }> = [];
      adapter.on('permissionRequest', (sessionId, request) => {
        permissionRequests.push({ sessionId, requestId: request.requestId });
      });

      await adapter.startSession('session-a', 'Ask A');
      await adapter.startSession('session-b', 'Ask B');

      const getAskUserTool = (callIndex: number) => {
        const sessionOptions = mockCreateAgentSession.mock.calls[callIndex]?.[0] as {
          customTools?: Array<{
            name: string;
            execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>;
          }>;
        };
        const tool = sessionOptions.customTools?.find(item => item.name === 'AskUserQuestion');
        expect(tool).toBeDefined();
        return tool!;
      };

      const question = {
        questions: [
          {
            question: 'Continue?',
            options: [{ label: 'Yes' }, { label: 'No' }],
          },
        ],
      };
      let sessionAResolved = false;
      const sessionAResult = getAskUserTool(0)
        .execute('tool-call-a', question)
        .then(result => {
          sessionAResolved = true;
          return result;
        });
      const sessionBResult = getAskUserTool(1).execute('tool-call-b', question);
      await vi.waitFor(() => expect(permissionRequests).toHaveLength(2));

      const sessionBRequest = permissionRequests.find(request => request.sessionId === 'session-b');
      expect(sessionBRequest).toBeDefined();
      adapter.respondToPermission(sessionBRequest!.requestId, {
        behavior: 'allow',
        updatedInput: { answers: { 'Continue?': 'Yes' } },
      });

      await expect(sessionBResult).resolves.toMatchObject({
        content: [{ text: 'Continue?: Yes' }],
      });
      expect(sessionAResolved).toBe(false);

      const sessionARequest = permissionRequests.find(request => request.sessionId === 'session-a');
      expect(sessionARequest).toBeDefined();
      adapter.respondToPermission(sessionARequest!.requestId, { behavior: 'deny' });
      await expect(sessionAResult).resolves.toMatchObject({
        content: [{ text: 'The user denied the operation.' }],
      });
    });
  });

  // ── Cleanup ──

  it('dismisses pending workbench approvals when a session stops', async () => {
    const dismissals: string[] = [];
    adapter.on('permissionDismiss', requestId => dismissals.push(requestId));
    await adapter.startSession('test', 'Hello');
    const approvalSessionMap = (adapter as unknown as { approvalSessionMap: Map<string, string> })
      .approvalSessionMap;
    approvalSessionMap.set('approval-1', 'test');

    adapter.stopSession('test');

    expect(approvalSessionMap.has('approval-1')).toBe(false);
    expect(dismissals).toEqual(['approval-1']);
  });

  describe('onSessionDeleted', () => {
    it('should stop the session', async () => {
      await adapter.startSession('test', 'Hello');
      adapter.onSessionDeleted('test');
      expect(adapter.isSessionActive('test')).toBe(false);
    });
  });

  // ── Event mapping: tool execution ──

  describe('tool execution event mapping', () => {
    // Capture the Pi event listener so we can drive events manually.
    let listener: ((event: unknown) => void) | null = null;

    beforeEach(() => {
      listener = null;
      mockSession.subscribe.mockImplementation((cb: (event: unknown) => void) => {
        listener = cb;
        return () => {};
      });
    });

    it('should emit a tool_use message on tool_execution_start', async () => {
      const messages: Array<{ type: string; metadata?: Record<string, unknown> }> = [];
      adapter.on('message', (_sid, msg) => messages.push(msg as never));
      await adapter.startSession('test', 'Do something');

      listener!({
        type: 'tool_execution_start',
        toolCallId: 'call-1',
        toolName: 'Bash',
        args: { command: 'ls' },
      });

      const toolUse = messages.find(m => m.type === 'tool_use');
      expect(toolUse).toBeDefined();
      expect(toolUse!.metadata?.toolName).toBe('Bash');
      expect(toolUse!.metadata?.toolUseId).toBe('call-1');
      expect(toolUse!.metadata?.toolInput).toEqual({ command: 'ls' });
    });

    it('emits a bounded Write summary while arguments are still streaming', async () => {
      const events: Array<{ kind: string; payload: unknown }> = [];
      adapter.on('toolActivity', (_sessionId, event) => {
        events.push({ kind: 'activity', payload: event });
      });
      adapter.on('message', (_sessionId, message) => {
        if (message.type === 'tool_use') events.push({ kind: 'tool_use', payload: message });
      });
      await adapter.startSession('test', 'Write a file');

      listener!({ type: 'turn_start' });
      listener!({
        type: 'message_update',
        message: {
          id: 'assistant-1',
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 'write-1',
              name: 'Write',
              arguments: { path: 'src/app.ts', content: 'x'.repeat(10_000) },
            },
          ],
        },
        assistantMessageEvent: {
          type: 'toolcall_delta',
          contentIndex: 0,
          partial: {
            content: [
              {
                type: 'toolCall',
                id: 'write-1',
                name: 'Write',
                arguments: { path: 'src/app.ts', content: 'x'.repeat(10_000) },
              },
            ],
          },
        },
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        kind: 'activity',
        payload: {
          type: CoworkToolActivityEventType.Upsert,
          activity: {
            toolCallId: 'write-1',
            phase: CoworkToolActivityPhase.Preparing,
            toolName: 'Write',
            toolInput: { path: 'src/app.ts' },
          },
        },
      });

      listener!({
        type: 'tool_execution_start',
        toolCallId: 'write-1',
        toolName: 'Write',
        args: { path: 'src/app.ts', content: 'x'.repeat(10_000) },
      });

      expect(events.at(-1)?.kind).toBe('tool_use');
    });

    it('should emit a linked tool_result message on tool_execution_end', async () => {
      const messages: Array<{ type: string; content: string; metadata?: Record<string, unknown> }> =
        [];
      adapter.on('message', (_sid, msg) => messages.push(msg as never));
      await adapter.startSession('test', 'Do something');

      listener!({ type: 'tool_execution_start', toolCallId: 'call-1', toolName: 'Bash', args: {} });
      listener!({
        type: 'tool_execution_end',
        toolCallId: 'call-1',
        toolName: 'Bash',
        result: 'file1.txt\nfile2.txt',
        isError: false,
      });

      const toolResult = messages.find(m => m.type === 'tool_result');
      expect(toolResult).toBeDefined();
      expect(toolResult!.metadata?.toolUseId).toBe('call-1');
      expect(toolResult!.metadata?.isError).toBe(false);
      expect(toolResult!.content).toContain('file1.txt');
    });

    it('should not emit duplicate tool_result for the same call', async () => {
      const results: unknown[] = [];
      adapter.on('message', (_sid, msg) => {
        if ((msg as { type: string }).type === 'tool_result') results.push(msg);
      });
      await adapter.startSession('test', 'Do something');

      const endEvent = {
        type: 'tool_execution_end',
        toolCallId: 'call-1',
        toolName: 'Bash',
        result: 'x',
        isError: false,
      };
      listener!(endEvent);
      listener!(endEvent);

      expect(results).toHaveLength(1);
    });

    it('should flag tool_result as error when isError is true', async () => {
      const messages: Array<{ type: string; metadata?: Record<string, unknown> }> = [];
      adapter.on('message', (_sid, msg) => messages.push(msg as never));
      await adapter.startSession('test', 'Do something');

      listener!({
        type: 'tool_execution_end',
        toolCallId: 'call-err',
        toolName: 'Bash',
        result: 'command not found',
        isError: true,
      });

      const toolResult = messages.find(m => m.type === 'tool_result');
      expect(toolResult!.metadata?.isError).toBe(true);
    });
  });

  // ── Event mapping: assistant streaming (duplicate-render regression) ──

  describe('assistant streaming event mapping', () => {
    let listener: ((event: unknown) => void) | null = null;

    beforeEach(() => {
      listener = null;
      mockSession.subscribe.mockImplementation((cb: (event: unknown) => void) => {
        listener = cb;
        return () => {};
      });
    });

    /**
     * Drive a full assistant turn. message_update carries the FULL accumulating
     * snapshot (blocks of {type:'text',text}), matching real Pi behavior.
     */
    const driveAssistantTurn = (text: string) => {
      listener!({ type: 'turn_start' });
      listener!({
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text }] },
      });
      listener!({
        type: 'message_end',
        message: { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' },
      });
    };

    it('should emit exactly ONE assistant message event per turn (no duplicate bubble)', async () => {
      const assistantMessages: Array<{ id: string; type: string }> = [];
      const updates: Array<{ messageId: string; content: string }> = [];
      adapter.on('message', (_sid, msg) => {
        if ((msg as { type: string }).type === 'assistant') assistantMessages.push(msg as never);
      });
      adapter.on('messageUpdate', (_sid, messageId, content) =>
        updates.push({ messageId, content }),
      );

      await adapter.startSession('test', 'Hi');
      driveAssistantTurn('Hello world');

      // Exactly one 'message' event (the streaming seed), finalized via messageUpdate —
      // NOT a second 'message' event, which is what caused duplicate rendering.
      expect(assistantMessages).toHaveLength(1);
      // The final content is delivered on the same message id.
      const finalUpdate = updates[updates.length - 1];
      expect(finalUpdate.messageId).toBe(assistantMessages[0].id);
      expect(finalUpdate.content).toBe('Hello world');
    });

    it('should keep the same message id across stream and finalize', async () => {
      const ids = new Set<string>();
      adapter.on('message', (_sid, msg) => {
        if ((msg as { type: string }).type === 'assistant') ids.add((msg as { id: string }).id);
      });
      adapter.on('messageUpdate', (_sid, messageId) => ids.add(messageId));

      await adapter.startSession('test', 'Hi');
      driveAssistantTurn('One two three');

      // Streaming updates and the seeded message must all share a single id.
      expect(ids.size).toBe(1);
    });

    it('should SET content from snapshots, never append (no repeated content)', async () => {
      const updates: string[] = [];
      adapter.on('messageUpdate', (_sid, _id, content) => updates.push(content));
      await adapter.startSession('test', 'Hi');

      // Three accumulating snapshots (as Pi sends them), not deltas.
      listener!({ type: 'turn_start' });
      listener!({
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Hel' }] },
      });
      listener!({
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
      });
      listener!({
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Hello world' }] },
      });
      listener!({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello world' }],
          stopReason: 'stop',
        },
      });

      // The final content must be exactly the last snapshot — NOT "HelHelloHello world".
      expect(updates[updates.length - 1]).toBe('Hello world');
      // No emitted content should ever contain a duplicated prefix.
      expect(updates.some(c => c.includes('HelHello') || c.includes('HelloHello'))).toBe(false);
    });

    it('should steer a truncated built-in write into the chunked workflow', async () => {
      await adapter.startSession('test', 'Write a large file');

      listener!({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: PiAssistantStopReason.Length,
          content: [
            {
              type: PiContentBlockType.ToolCall,
              id: 'write-1',
              name: PiBuiltinFileToolName.Write,
              arguments: { path: 'large.md', content: 'partial' },
            },
          ],
        },
      });

      expect(mockSession.steer).toHaveBeenCalledOnce();
      expect(mockSession.steer).toHaveBeenCalledWith(expect.stringContaining('2048 characters'));
    });

    it('should mark an answer as final only after the agent run ends', async () => {
      const updates: Array<{ content: string; metadata?: Record<string, unknown> }> = [];
      adapter.on('messageUpdate', (_sid, _id, content, metadata) =>
        updates.push({ content, metadata }),
      );

      await adapter.startSession('test', 'Hi');
      driveAssistantTurn('Intermediate or final answer');

      expect(updates.some(update => update.metadata?.isFinalAnswer === true)).toBe(false);

      listener!({ type: 'agent_end' });

      expect(updates[updates.length - 1]).toEqual({
        content: 'Intermediate or final answer',
        metadata: {
          isStreaming: false,
          isFinal: true,
          isFinalAnswer: true,
        },
      });
    });

    it('does not mark intermediate loop answers as final', async () => {
      const updates: Array<{
        messageId: string;
        content: string;
        metadata?: Record<string, unknown>;
      }> = [];
      adapter.on('messageUpdate', (_sid, messageId, content, metadata) =>
        updates.push({ messageId, content, metadata }),
      );

      await adapter.startSession('test', 'Produce two iterations');
      const sessionOptions = mockCreateAgentSession.mock.calls[0]?.[0] as {
        customTools?: Array<{
          name: string;
          execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>;
        }>;
      };
      const loopTool = sessionOptions.customTools?.find(tool => tool.name === PiAgentLoopToolName);
      await loopTool!.execute('loop-start', {
        action: PiAgentLoopAction.Start,
        mode: PiAgentLoopMode.Passes,
        passes: 2,
      });

      driveAssistantTurn('First iteration answer');
      await loopTool!.execute('loop-next-1', {
        action: PiAgentLoopAction.Next,
        summary: 'First iteration complete',
      });
      listener!({ type: 'agent_end' });

      expect(
        updates.some(
          update =>
            update.content === 'First iteration answer' && update.metadata?.isFinalAnswer === true,
        ),
      ).toBe(false);

      driveAssistantTurn('Second iteration answer');
      await loopTool!.execute('loop-next-2', {
        action: PiAgentLoopAction.Next,
        summary: 'Second iteration complete',
      });
      listener!({ type: 'agent_end' });

      const finalAnswers = updates.filter(update => update.metadata?.isFinalAnswer === true);
      expect(finalAnswers).toHaveLength(1);
      expect(finalAnswers[0].content).toBe('Second iteration answer');
      expect(
        new Set(
          updates
            .filter(update => update.content.endsWith('iteration answer'))
            .map(update => update.messageId),
        ).size,
      ).toBe(2);
    });

    it('should preserve the latest answer across a trailing thinking-only internal turn', async () => {
      const updates: Array<{
        messageId: string;
        content: string;
        metadata?: Record<string, unknown>;
      }> = [];
      adapter.on('messageUpdate', (_sid, messageId, content, metadata) =>
        updates.push({ messageId, content, metadata }),
      );

      await adapter.startSession('test', 'Hi');
      driveAssistantTurn('Answer before trailing reasoning');
      listener!({ type: 'turn_start' });
      listener!({
        type: 'message_update',
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'Checking completion.' }],
        },
      });
      listener!({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'Checking completion.' }],
          stopReason: 'length',
        },
      });
      listener!({ type: 'agent_end' });

      expect(
        updates.some(
          update =>
            update.content === 'Answer before trailing reasoning' &&
            update.metadata?.isFinalAnswer === true,
        ),
      ).toBe(true);
    });

    it('should render thinking as a separate isThinking message, not as the answer', async () => {
      const messages: Array<{ id: string; metadata?: Record<string, unknown> }> = [];
      adapter.on('message', (_sid, msg) => messages.push(msg as never));
      const updates: Array<{ messageId: string; metadata?: Record<string, unknown> }> = [];
      adapter.on('messageUpdate', (_sid, messageId, _c, metadata) =>
        updates.push({ messageId, metadata }),
      );

      await adapter.startSession('test', 'Think then answer');
      listener!({ type: 'turn_start' });
      // A snapshot containing both thinking and answer blocks.
      listener!({
        type: 'message_update',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Let me reason...' },
            { type: 'text', text: 'The answer is 42.' },
          ],
        },
      });
      listener!({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Let me reason...' },
            { type: 'text', text: 'The answer is 42.' },
          ],
          stopReason: 'stop',
        },
      });

      // Two distinct assistant messages: one thinking, one answer — with different ids.
      const thinkingMsg = messages.find(m => m.metadata?.isThinking === true);
      const answerMsg = messages.find(
        m =>
          m.metadata?.isThinking !== true &&
          (m.metadata as Record<string, unknown>)?.isStreaming !== undefined,
      );
      expect(thinkingMsg).toBeDefined();
      expect(answerMsg).toBeDefined();
      expect(thinkingMsg!.id).not.toBe(answerMsg!.id);

      // The thinking message must be finalized WITH isThinking:true (never as a plain answer).
      const thinkingFinal = updates.filter(u => u.messageId === thinkingMsg!.id).pop();
      expect(thinkingFinal?.metadata?.isThinking).toBe(true);
      expect(thinkingFinal?.metadata?.isFinal).toBe(true);
    });

    it('should persist runtime-measured duration for each thinking message', async () => {
      vi.useFakeTimers();
      try {
        const updates: Array<{ metadata?: Record<string, unknown> }> = [];
        adapter.on('messageUpdate', (_sid, _messageId, _content, metadata) =>
          updates.push({ metadata }),
        );

        await adapter.startSession('test', 'Measure thinking');
        listener!({ type: 'turn_start' });
        listener!({
          type: 'message_update',
          assistantMessageEvent: { type: 'thinking_delta', delta: 'Inspecting' },
          message: {
            role: 'assistant',
            content: [{ type: 'thinking', thinking: 'Inspecting' }],
          },
        });
        vi.advanceTimersByTime(2400);
        listener!({
          type: 'message_update',
          assistantMessageEvent: { type: 'thinking_end' },
          message: {
            role: 'assistant',
            content: [{ type: 'thinking', thinking: 'Inspecting' }],
          },
        });
        listener!({
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [{ type: 'thinking', thinking: 'Inspecting' }],
            stopReason: 'stop',
          },
        });

        const finalThinkingUpdate = updates.find(
          update => update.metadata?.isThinking === true && update.metadata?.isFinal === true,
        );
        expect(finalThinkingUpdate?.metadata?.thinkingDurationMs).toBe(2400);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should stream the answer when text starts without a thinking_end event', async () => {
      const messages: Array<{
        id: string;
        type: string;
        content: string;
        metadata?: Record<string, unknown>;
      }> = [];
      adapter.on('message', (_sid, msg) => messages.push(msg as never));
      const updates: Array<{
        messageId: string;
        content: string;
        metadata?: Record<string, unknown>;
      }> = [];
      adapter.on('messageUpdate', (_sid, messageId, content, metadata) =>
        updates.push({ messageId, content, metadata }),
      );

      await adapter.startSession('test', 'Think before answering');
      listener!({ type: 'turn_start' });
      listener!({
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', delta: 'Inspecting context' },
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'Inspecting context' }],
        },
      });
      listener!({
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', delta: 'Still inspecting' },
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Inspecting context further' },
            { type: 'text', text: 'Visible answer' },
          ],
        },
      });

      const thinkingMessage = messages.find(message => message.metadata?.isThinking === true);
      const answerMessage = messages.find(
        message => message.type === 'assistant' && message.metadata?.isThinking !== true,
      );
      expect(answerMessage).toMatchObject({
        content: 'Visible answer',
        metadata: { isStreaming: true, isFinal: false },
      });
      expect(
        updates.some(
          update =>
            update.messageId === thinkingMessage?.id &&
            update.metadata?.isStreaming === false &&
            update.metadata?.isFinal === true,
        ),
      ).toBe(true);
    });

    it('should not turn a thinking-only message into an answer', async () => {
      const messages: Array<{ type: string; metadata?: Record<string, unknown> }> = [];
      adapter.on('message', (_sid, msg) => messages.push(msg as never));

      await adapter.startSession('test', 'Think before using a tool');
      listener!({ type: 'turn_start' });
      listener!({
        type: 'message_update',
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'I need to inspect the files first.' }],
        },
      });
      listener!({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'I need to inspect the files first.' }],
          stopReason: 'stop',
        },
      });

      const assistantMessages = messages.filter(message => message.type === 'assistant');
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0].metadata?.isThinking).toBe(true);
    });

    it('should finalize active thinking when the user stops the turn', async () => {
      const messages: Array<{ id: string; metadata?: Record<string, unknown> }> = [];
      const updates: Array<{ messageId: string; metadata?: Record<string, unknown> }> = [];
      adapter.on('message', (_sid, message) => messages.push(message as never));
      adapter.on('messageUpdate', (_sid, messageId, _content, metadata) =>
        updates.push({ messageId, metadata }),
      );

      await adapter.startSession('test', 'Stop after thinking');
      listener!({ type: 'turn_start' });
      listener!({
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', delta: 'Inspecting' },
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'Inspecting' }],
        },
      });

      adapter.stopSession('test');

      const thinkingMessage = messages.find(message => message.metadata?.isThinking === true);
      expect(
        updates.some(
          update =>
            update.messageId === thinkingMessage?.id &&
            update.metadata?.isStreaming === false &&
            update.metadata?.isFinal === true,
        ),
      ).toBe(true);
    });

    it('should finalize active thinking when the assistant ends with an error', async () => {
      const messages: Array<{ id: string; metadata?: Record<string, unknown> }> = [];
      const updates: Array<{ messageId: string; metadata?: Record<string, unknown> }> = [];
      adapter.on('message', (_sid, message) => messages.push(message as never));
      adapter.on('messageUpdate', (_sid, messageId, _content, metadata) =>
        updates.push({ messageId, metadata }),
      );
      adapter.on('error', () => undefined);

      await adapter.startSession('test', 'Fail after thinking');
      listener!({ type: 'turn_start' });
      listener!({
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', delta: 'Inspecting' },
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'Inspecting' }],
        },
      });
      listener!({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'Inspecting before failure' }],
          stopReason: 'error',
          errorMessage: 'Model failed',
        },
      });

      const thinkingMessage = messages.find(message => message.metadata?.isThinking === true);
      expect(
        updates.some(
          update =>
            update.messageId === thinkingMessage?.id &&
            update.metadata?.isStreaming === false &&
            update.metadata?.isFinal === true,
        ),
      ).toBe(true);
    });

    it('should not lose intermediate updates during a fast stream (no burst-freeze)', async () => {
      vi.useFakeTimers();
      try {
        const updates: string[] = [];
        adapter.on('messageUpdate', (_sid, _id, content) => updates.push(content));
        await adapter.startSession('test', 'Hi');

        listener!({ type: 'turn_start' });
        // Rapid snapshots 50ms apart (faster than the 200ms throttle window).
        const snaps = ['a', 'ab', 'abc', 'abcd', 'abcde'];
        for (const s of snaps) {
          listener!({
            type: 'message_update',
            message: { role: 'assistant', content: [{ type: 'text', text: s }] },
          });
          vi.advanceTimersByTime(50);
        }
        // Let any trailing throttle timer fire.
        vi.advanceTimersByTime(250);

        // Leading emit fires immediately; a trailing emit must deliver the latest
        // content — the timer must NOT be perpetually re-armed (which would freeze
        // the UI until the stream paused).
        expect(updates.length).toBeGreaterThanOrEqual(2);
        expect(updates[updates.length - 1]).toBe('abcde');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ── Auto-retry error storm (deferred error surfacing) ──

  describe('auto-retry error storm', () => {
    let listener: ((event: unknown) => void) | null = null;
    let mockStore: {
      updateSession: ReturnType<typeof vi.fn>;
      updateMessage: ReturnType<typeof vi.fn>;
      addMessage: ReturnType<typeof vi.fn>;
      getSession: ReturnType<typeof vi.fn>;
      getAgent: ReturnType<typeof vi.fn>;
      listAgents: ReturnType<typeof vi.fn>;
    };
    let errors: CoworkError[];
    let completes: string[];

    const failedAttempt = (errorMessage: string) => {
      listener!({
        type: 'message_end',
        message: { role: 'assistant', content: '', stopReason: 'error', errorMessage },
      });
      listener!({ type: 'turn_end' });
      listener!({ type: 'agent_end' });
    };

    const successfulTurn = (text: string) => {
      listener!({ type: 'turn_start' });
      listener!({
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text }] },
      });
      listener!({
        type: 'message_end',
        message: { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' },
      });
      listener!({ type: 'agent_end' });
    };

    const systemErrorMessages = () =>
      mockStore.addMessage.mock.calls.filter(
        ([, message]) => (message as { type: string }).type === 'system',
      );

    beforeEach(() => {
      listener = null;
      mockSession.subscribe.mockImplementation((cb: (event: unknown) => void) => {
        listener = cb;
        return () => {};
      });
      mockStore = {
        updateSession: vi.fn(),
        updateMessage: vi.fn(),
        addMessage: vi.fn((_sessionId: string, message: Record<string, unknown>) => ({
          ...message,
          id: (message.id as string) ?? 'stored-id',
        })),
        getSession: vi.fn(() => undefined),
        getAgent: vi.fn(() => undefined),
        listAgents: vi.fn(() => []),
      };
      adapter.setCoworkStore(mockStore as unknown as CoworkStore);
      errors = [];
      completes = [];
      adapter.on('error', (_sid, error) => errors.push(error as CoworkError));
      adapter.on('complete', sessionId => completes.push(sessionId));
    });

    it('surfaces no error when an auto-retry succeeds', async () => {
      await adapter.startSession('test', 'Hi');

      listener!({ type: 'turn_start' });
      failedAttempt('429 Too Many Requests: overloaded');
      listener!({ type: 'auto_retry_start' });
      successfulTurn('Recovered answer');
      listener!({ type: 'auto_retry_end', success: true, attempt: 1 });
      listener!({ type: 'agent_settled' });

      expect(errors).toHaveLength(0);
      expect(systemErrorMessages()).toHaveLength(0);
      expect(mockStore.updateSession).not.toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ status: 'error' }),
      );
      expect(completes).toEqual(['test']);
      expect(mockStore.updateSession).toHaveBeenCalledWith('test', { status: 'idle' });
    });

    it('surfaces the error exactly once when auto-retries are exhausted', async () => {
      await adapter.startSession('test', 'Hi');

      for (let attempt = 0; attempt < 3; attempt++) {
        listener!({ type: 'turn_start' });
        failedAttempt('429 Too Many Requests: overloaded');
        if (attempt < 2) {
          listener!({ type: 'auto_retry_start', attempt: attempt + 1 });
        } else {
          listener!({
            type: 'auto_retry_end',
            success: false,
            attempt: attempt + 1,
            finalError: '429 Too Many Requests: overloaded',
          });
        }
      }
      listener!({ type: 'agent_settled' });

      expect(errors).toHaveLength(1);
      expect(errors[0].kind).toBe(CoworkErrorKind.RateLimited);
      expect(systemErrorMessages()).toHaveLength(1);
      expect(mockStore.updateSession).toHaveBeenCalledWith('test', { status: 'error' });
      expect(mockStore.updateSession).not.toHaveBeenCalledWith('test', { status: 'completed' });
      expect(completes).toHaveLength(0);
    });

    it('surfaces a non-retryable error once on agent_settled', async () => {
      await adapter.startSession('test', 'Hi');

      listener!({ type: 'turn_start' });
      failedAttempt('401 Unauthorized: invalid api key');
      listener!({ type: 'agent_settled' });

      expect(errors).toHaveLength(1);
      expect(errors[0].kind).toBe(CoworkErrorKind.AuthExpired);
      expect(systemErrorMessages()).toHaveLength(1);
      expect(completes).toHaveLength(0);
    });

    it('does not complete or continue the agent loop on a failed turn', async () => {
      await adapter.startSession('test', 'Hi');
      const sessionOptions = mockCreateAgentSession.mock.calls[0]?.[0] as {
        customTools?: Array<{
          name: string;
          execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>;
        }>;
      };
      const loopTool = sessionOptions.customTools?.find(tool => tool.name === PiAgentLoopToolName);
      expect(loopTool).toBeDefined();
      // Arm the loop so agent_end would normally continue with iteration 2.
      await loopTool!.execute('call-1', {
        action: PiAgentLoopAction.Start,
        mode: PiAgentLoopMode.Passes,
        passes: 3,
      });
      await loopTool!.execute('call-2', { action: PiAgentLoopAction.Next, summary: 'iter 1 done' });

      listener!({ type: 'turn_start' });
      failedAttempt('429 Too Many Requests: overloaded');
      listener!({
        type: 'auto_retry_end',
        success: false,
        attempt: 3,
        finalError: '429 Too Many Requests: overloaded',
      });

      // No continuation prompt beyond the initial startSession prompt.
      expect(mockSession.prompt).toHaveBeenCalledTimes(1);
      expect(completes).toHaveLength(0);
      expect(mockStore.updateSession).not.toHaveBeenCalledWith('test', { status: 'completed' });
    });
  });

  describe('pending Work messages', () => {
    it('queues follow-ups during a running Work session and steers on demand', async () => {
      await adapter.startSession('queue-session', 'Start work', { sessionMode: 'work' });

      const queued = adapter.enqueuePendingMessage('queue-session', 'Change direction');
      expect(queued.success).toBe(true);
      expect(adapter.listPendingMessages('queue-session')).toHaveLength(1);

      const steered = await adapter.steerPendingMessage('queue-session', queued.item!.id);
      expect(steered.success).toBe(true);
      expect(mockSession.prompt).toHaveBeenCalledWith('Change direction', {
        streamingBehavior: 'steer',
      });
      expect(adapter.listPendingMessages('queue-session')).toEqual([]);
    });

    it('preserves Allow All across internal follow-up continuations', async () => {
      await adapter.startSession('allow-all-session', 'Start work', {
        sessionMode: 'work',
        autoApprove: true,
      });

      await adapter.continueSession('allow-all-session', 'Continue work', {
        sessionMode: 'work',
      });

      const activeSessions = (
        adapter as unknown as {
          activeSessions: Map<string, { autoApprove: boolean }>;
        }
      ).activeSessions;
      expect(activeSessions.get('allow-all-session')?.autoApprove).toBe(true);
    });

    it('delivers queued follow-ups in order after Pi settles', async () => {
      let listener: ((event: { type: string }) => void) | null = null;
      mockSession.subscribe.mockImplementation((callback: (event: { type: string }) => void) => {
        listener = callback;
        return () => {};
      });
      await adapter.startSession('queue-session', 'Start work', { sessionMode: 'work' });
      const first = adapter.enqueuePendingMessage('queue-session', 'First follow-up');
      adapter.enqueuePendingMessage('queue-session', 'Second follow-up');

      listener!({ type: 'agent_end' });
      listener!({ type: 'agent_settled' });
      await vi.waitFor(() => {
        expect(mockSession.prompt).toHaveBeenCalledTimes(3);
      });
      expect(mockSession.prompt.mock.calls.slice(1)).toEqual([
        ['First follow-up', { streamingBehavior: 'followUp' }],
        ['Second follow-up', { streamingBehavior: 'followUp' }],
      ]);
      expect(adapter.listPendingMessages('queue-session')).toEqual([]);
      expect(first.success).toBe(true);
    });

    it('drains the next follow-up after its predecessor finishes while the queue flush is active', async () => {
      let listener: ((event: { type: string }) => void) | null = null;
      mockSession.subscribe.mockImplementation((callback: (event: { type: string }) => void) => {
        listener = callback;
        return () => {};
      });
      await adapter.startSession('queue-session', 'Start work', { sessionMode: 'work' });

      let resolveFirstFollowUp: () => void = () => {};
      mockSession.prompt.mockImplementationOnce(
        () =>
          new Promise<void>(resolve => {
            resolveFirstFollowUp = resolve;
          }),
      );
      adapter.enqueuePendingMessage('queue-session', 'First follow-up');
      adapter.enqueuePendingMessage('queue-session', 'Second follow-up');

      listener!({ type: 'agent_end' });
      await vi.waitFor(() => {
        expect(mockSession.prompt).toHaveBeenLastCalledWith('First follow-up', {
          streamingBehavior: 'followUp',
        });
      });

      // The first queued turn ends while the first queue flush still awaits
      // prompt(). The second item must be picked up once that flush completes.
      listener!({ type: 'agent_end' });
      resolveFirstFollowUp();

      await vi.waitFor(() => {
        expect(mockSession.prompt).toHaveBeenLastCalledWith('Second follow-up', {
          streamingBehavior: 'followUp',
        });
      });
    });

    it('keeps the replacement session when a stopped turn rejects after its queued follow-up starts', async () => {
      let rejectInitialPrompt: (error: Error) => void = () => {};
      mockSession.prompt
        .mockImplementationOnce(
          () =>
            new Promise<void>((_resolve, reject) => {
              rejectInitialPrompt = reject;
            }),
        )
        .mockResolvedValueOnce(undefined);

      const initialRun = adapter.startSession('queue-session', 'Start work', {
        sessionMode: 'work',
      });
      await vi.waitFor(() => expect(mockSession.prompt).toHaveBeenCalledTimes(1));

      const queued = adapter.enqueuePendingMessage('queue-session', 'Queued follow-up');
      expect(queued.success).toBe(true);

      adapter.stopSession('queue-session');
      await vi.waitFor(() => expect(mockCreateAgentSession).toHaveBeenCalledTimes(2));

      rejectInitialPrompt(new Error('The stopped prompt rejected.'));
      await initialRun;

      expect(adapter.isSessionActive('queue-session')).toBe(true);
    });

    it('rejects queue controls for Chat sessions', async () => {
      await adapter.startSession('chat-session', 'Hello', { sessionMode: 'chat' });

      expect(adapter.enqueuePendingMessage('chat-session', 'Not allowed')).toMatchObject({
        success: false,
      });
    });
  });
});
