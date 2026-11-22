/** Shared preparation and launch boundary for Work and companion entry points. */
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { AgentManager } from '../../agentManager';
import type { CoworkStore } from '../../coworkStore';
import type { PiRuntimeAdapter } from '../../libs/agentEngine/piRuntimeAdapter';
import type { WorkbenchTaskService } from '../../workbenchTask/taskService';
import { observeWorkbench } from '../../workbenchTask/observe';
import { CoworkSessionStartSchema } from '../../../shared/ipc/schemas';
import {
  CoworkSessionExpertSource,
  type CoworkSessionExpertInput,
} from '../../../shared/cowork/sessionExperts';
import {
  CoworkExecutionMode,
  CoworkSessionMode,
  CoworkSessionSource,
} from '../../../shared/cowork/constants';
import { resolveCoworkApprovalMode } from './approvalMode';
import {
  resolveCoworkPromptLanguage,
  resolveSessionExpertSnapshots,
} from '../../appBootstrap/sessionExperts';
import { sanitizeCoworkSessionForIpc } from '../../appBootstrap/ipcPayloadSanitize';
import { composeCoworkSystemPrompt } from '../../coworkPrompt/composer';
import {
  stageCoworkStartImages,
  publishCoworkStartImages,
  discardUncommittedCoworkStartImages,
  type PersistedCoworkImageAttachment,
} from '../../coworkImageAttachments';
import { lifecycleRuntime } from '../../appBootstrap/lifecycleRuntimeState';
import { buildSessionTitleFromInput } from '../../../common/sessionTitle';
import { projectCoworkSessionRuntimeState } from '../../coworkSessionRuntimeState';
import { generateCorrelationId, runWithCorrelationId } from '../../libs/logCorrelation';
import { createLogger } from '../../libs/structuredLog';
import { t } from '../../i18n';

export interface CoworkSessionIpcDeps {
  getCoworkImageRoot: () => string;
  getAgentManager: () => AgentManager;
  getCoworkStore: () => CoworkStore;
  getPiRuntimeAdapter: () => PiRuntimeAdapter;
  getWorkbenchTaskService: () => WorkbenchTaskService;
  resolveSessionWorkingDirectory: (options: { cwd?: string }) => string;
  resolveTaskWorkingDirectory: (workspaceRoot: string) => Promise<string>;
}
export type CoworkSessionStartInput = z.infer<typeof CoworkSessionStartSchema.input>;

export function assertCoworkSubmissionOpen(): void {
  if (lifecycleRuntime.isQuitting) throw new Error('The application is shutting down.');
}

export async function resolveCoworkStartExperts(
  deps: CoworkSessionIpcDeps,
  options: Pick<CoworkSessionStartInput, 'agentId' | 'expertIds'>,
) {
  const selectedAgent = deps.getAgentManager().getAgent(options.agentId || 'main');
  const defaultExpertIds =
    selectedAgent &&
    (selectedAgent.source === CoworkSessionExpertSource.Package ||
      selectedAgent.source === CoworkSessionExpertSource.Member)
      ? [selectedAgent.id]
      : [];
  const expertSnapshots = await resolveSessionExpertSnapshots(
    options.expertIds ?? defaultExpertIds,
  );
  return { selectedAgent, expertSnapshots };
}

export async function resolveCoworkStartWorkspace(
  deps: CoworkSessionIpcDeps,
  options: Pick<CoworkSessionStartInput, 'workspaceId' | 'cwd'>,
) {
  assertCoworkSubmissionOpen();
  const workspace = options.workspaceId
    ? deps.getCoworkStore().workspaces.getWorkspace(options.workspaceId)
    : null;
  const directory = deps.resolveSessionWorkingDirectory({ cwd: options.cwd || workspace?.path });
  if (!directory) throw new Error('Please select a task folder before submitting.');
  return { workspace, taskWorkingDirectory: await deps.resolveTaskWorkingDirectory(directory) };
}

/** Preparation is synchronous so the owner can atomically link its receipt before launch. */
export function prepareCoworkSession(
  deps: CoworkSessionIpcDeps,
  options: Omit<CoworkSessionStartInput, 'imageAttachments'>,
  internal: {
    selectedAgent: ReturnType<AgentManager['getAgent']>;
    expertSnapshots: CoworkSessionExpertInput[];
    startWorkspace: Awaited<ReturnType<typeof resolveCoworkStartWorkspace>>;
    sessionId?: string;
    storedImages?: PersistedCoworkImageAttachment[];
    /** Model-visible user input may include attachment references kept as metadata in SQLite. */
    modelPrompt?: string;
  },
) {
  assertCoworkSubmissionOpen();
  const coworkStoreInstance = deps.getCoworkStore();
  const config = coworkStoreInstance.getConfig();
  const { selectedAgent, expertSnapshots } = internal;
  // The renderer already includes the selected non-expert agent prompt when
  // present. Treat that request value as the source prompt instead of
  // appending the same agent prompt again in the main process.
  const isChatSession = options.mode === CoworkSessionMode.Chat;
  const basePrompt = isChatSession
    ? (options.systemPrompt ?? '')
    : (options.systemPrompt ?? selectedAgent?.systemPrompt ?? config.systemPrompt);
  const systemPrompt = isChatSession
    ? basePrompt.trim()
    : composeCoworkSystemPrompt({
        basePrompt,
        expertSnapshots,
        language: resolveCoworkPromptLanguage(),
      });
  const { workspace, taskWorkingDirectory } = internal.startWorkspace;
  if (workspace) {
    const current = coworkStoreInstance.workspaces.getWorkspace(workspace.id);
    if (!current || current.path !== workspace.path || current.isHidden !== workspace.isHidden) {
      throw new Error(t('coworkTaskWorkspaceChanged'));
    }
  }

  const fallbackTitle = buildSessionTitleFromInput(options.prompt, t('coworkDefaultSessionTitle'));
  const title = options.title?.trim() || fallbackTitle;

  // Build metadata, include imageAttachments if present
  const messageMetadata: Record<string, unknown> = {};
  if (expertSnapshots.length > 0) {
    messageMetadata.experts = expertSnapshots.map(expert => ({
      expertId: expert.expertId,
      expertName: expert.expertName,
      presetId: expert.packageId,
    }));
  }
  if (options.activeSkillIds?.length) {
    messageMetadata.skillIds = options.activeSkillIds;
  }
  const { storedImages } = internal;
  if (storedImages?.length) messageMetadata.imageAttachments = storedImages;
  if (options.fileAttachments?.length) {
    messageMetadata.fileAttachments = options.fileAttachments;
  }
  const workbench = isChatSession ? undefined : deps.getWorkbenchTaskService();
  const admit = () => {
    const selectedWorkspace =
      workspace ?? coworkStoreInstance.workspaces.ensureWorkspace(taskWorkingDirectory);
    const session = coworkStoreInstance.createSession(
      title,
      taskWorkingDirectory,
      systemPrompt,
      config.executionMode || CoworkExecutionMode.Local,
      options.activeSkillIds || [],
      options.agentId || 'main',
      options.modelOverride || '',
      options.mode ?? CoworkSessionMode.Work,
      internal.sessionId,
      selectedWorkspace.id,
      expertSnapshots,
      CoworkSessionSource.Manual,
      {
        content: options.prompt,
        metadata: Object.keys(messageMetadata).length > 0 ? messageMetadata : undefined,
      },
    );
    return {
      session,
      workbenchReservation: workbench?.reserveRun({ sessionId: session.id, goal: options.prompt }),
    };
  };
  const { session, workbenchReservation } = workbench
    ? workbench.repository.transaction(admit)
    : admit();

  if (options.modelOverride) {
    console.log(
      '[Cowork:StartSession] session created with modelOverride:',
      session.id,
      options.modelOverride,
    );
  }

  // Start the session asynchronously (skip initial user message since we already added it)
  const failAdmission = (error: unknown) => {
    if (workbenchReservation) {
      const message = error instanceof Error ? error.message : String(error);
      observeWorkbench(session.id, () =>
        workbench?.failRun(session.id, { message }, workbenchReservation.runId),
      );
    }
  };
  let runtime: PiRuntimeAdapter;
  try {
    runtime = deps.getPiRuntimeAdapter();
  } catch (error) {
    failAdmission(error);
    throw error;
  }
  const runtimeSkillIds = [
    ...new Set([
      ...(options.activeSkillIds || []),
      ...expertSnapshots.flatMap(expert => expert.skillIds),
    ]),
  ];
  const launch = () => {
    try {
      // Startup can publish the staged files if the process exits after admission.
      if (storedImages?.length) publishCoworkStartImages(deps.getCoworkImageRoot(), session.id);
    } catch (error) {
      failAdmission(error);
      throw error;
    }
    runtime
      .startSession(session.id, internal.modelPrompt ?? options.prompt, {
        skipInitialUserMessage: true,
        workbenchReservation,
        systemPrompt,
        skillIds: runtimeSkillIds,
        workspaceRoot: taskWorkingDirectory,
        confirmationMode: 'modal',
        sessionMode: options.mode ?? CoworkSessionMode.Work,
        goalMode: options.goalMode,
        codemode: config.codemodeEnabled === true,
        approvalMode: resolveCoworkApprovalMode(options.permissionMode ?? config.permissionMode),
        imageAttachments: storedImages,
        fileAttachments: options.fileAttachments,
        agentId: options.agentId,
        expertIds: expertSnapshots.map(expert => expert.expertId),
        modelOverride: options.modelOverride,
      })
      .catch(error => {
        console.error('[Cowork] session error:', error);
        try {
          runtime.recovery.reportRejectedSubmission(session.id, error);
        } catch (handlerError) {
          console.error('[Cowork] failed to send error notification to renderer:', handlerError);
        }
      });
  };
  return { session, workbenchReservation, launch };
}

export function startCoworkSession(deps: CoworkSessionIpcDeps, options: CoworkSessionStartInput) {
  const cid = generateCorrelationId();
  createLogger('CoworkSession')
    .withContext({ cid })
    .info('session start requested', {
      prompt: options.prompt.slice(0, 80),
      agentId: options.agentId,
      systemPromptLen: options.systemPrompt?.length ?? 0,
    });
  return runWithCorrelationId(cid, async () => {
    const sessionId = options.imageAttachments?.length ? randomUUID() : undefined;
    let imageRoot: string | undefined;
    try {
      let storedImages: PersistedCoworkImageAttachment[] | undefined;
      if (sessionId) {
        imageRoot = deps.getCoworkImageRoot();
        storedImages = await stageCoworkStartImages(
          imageRoot,
          sessionId,
          options.imageAttachments,
          {
            isCurrent: () => !lifecycleRuntime.isQuitting,
          },
        );
      }
      assertCoworkSubmissionOpen();
      const experts = await resolveCoworkStartExperts(deps, options);
      const startWorkspace = await resolveCoworkStartWorkspace(deps, options);
      const prepared = prepareCoworkSession(deps, options, {
        sessionId,
        storedImages,
        startWorkspace,
        ...experts,
      });
      prepared.launch();
      const session = deps.getCoworkStore().getSession(prepared.session.id) || prepared.session;
      return {
        success: true,
        session: sanitizeCoworkSessionForIpc(
          projectCoworkSessionRuntimeState(
            session,
            deps.getPiRuntimeAdapter().isSessionRunning(session.id),
          ),
        ),
      };
    } catch (error) {
      if (sessionId && imageRoot !== undefined) {
        try {
          await discardUncommittedCoworkStartImages(imageRoot, sessionId, deps.getCoworkStore());
        } catch (cleanupError) {
          console.warn(`[CoworkImages] failed to clean images for ${sessionId}:`, cleanupError);
        }
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start session',
      };
    }
  });
}
