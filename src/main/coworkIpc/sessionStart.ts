/** Shared preparation and launch boundary for Work and companion entry points. */
import type { z } from 'zod';
import type { AgentManager } from '../agentManager';
import type { CoworkStore } from '../coworkStore';
import type { PiRuntimeAdapter } from '../libs/agentEngine/piRuntimeAdapter';
import { CoworkSessionStartSchema } from '../../shared/ipc/schemas';
import { CoworkSessionExpertSource } from '../../shared/cowork/sessionExperts';
import {
  CoworkExecutionMode,
  CoworkPermissionMode,
  CoworkSessionMode,
} from '../../shared/cowork/constants';
import { WorkbenchApprovalMode } from '../../shared/workbenchTask';
import {
  resolveCoworkPromptLanguage,
  resolveSessionExpertSnapshots,
} from '../appBootstrap/sessionExperts';
import { sanitizeCoworkSessionForIpc } from '../appBootstrap/ipcPayloadSanitize';
import { composeCoworkSystemPrompt } from '../coworkPrompt/composer';
import { persistCoworkImageAttachments } from '../coworkImageAttachments';
import { buildSessionTitleFromInput } from '../../common/sessionTitle';
import { reportPiSessionFailure } from '../piSessionFailure';
import { generateCorrelationId, runWithCorrelationId } from '../libs/logCorrelation';
import { createLogger } from '../libs/structuredLog';
import { t } from '../i18n';

export interface CoworkSessionIpcDeps {
  getCoworkImageRoot: () => string;
  getAgentManager: () => AgentManager;
  getCoworkStore: () => CoworkStore;
  getPiRuntimeAdapter: () => PiRuntimeAdapter;
  resolveSessionWorkingDirectory: (options: { cwd?: string }) => string;
  resolveTaskWorkingDirectory: (workspaceRoot: string) => string;
}
export type CoworkSessionStartInput = z.infer<typeof CoworkSessionStartSchema.input>;

/** Preparation is synchronous so the owner can atomically link its receipt before launch. */
export function prepareCoworkSession(
  deps: CoworkSessionIpcDeps,
  options: CoworkSessionStartInput,
  internal: { sessionId?: string; workbenchRunId?: string; onFailure?(error: unknown): void } = {},
) {
  const coworkStoreInstance = deps.getCoworkStore();
  const config = coworkStoreInstance.getConfig();
  const selectedAgent = deps.getAgentManager().getAgent(options.agentId || 'main');
  const fallbackExpertIds =
    selectedAgent &&
    (selectedAgent.source === CoworkSessionExpertSource.Package ||
      selectedAgent.source === CoworkSessionExpertSource.Member)
      ? [selectedAgent.id]
      : [];
  const expertSnapshots = resolveSessionExpertSnapshots(options.expertIds ?? fallbackExpertIds);
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
  const workspace = options.workspaceId
    ? coworkStoreInstance.getWorkspace(options.workspaceId)
    : null;
  const selectedTaskDirectory = deps.resolveSessionWorkingDirectory({
    cwd: options.cwd || workspace?.path,
  });

  if (!selectedTaskDirectory) {
    throw new Error('Please select a task folder before submitting.');
  }
  const selectedWorkspace = workspace || coworkStoreInstance.ensureWorkspace(selectedTaskDirectory);

  const fallbackTitle = buildSessionTitleFromInput(options.prompt, t('coworkDefaultSessionTitle'));
  const title = options.title?.trim() || fallbackTitle;
  const taskWorkingDirectory = deps.resolveTaskWorkingDirectory(selectedTaskDirectory);

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
  );

  if (options.modelOverride) {
    console.log(
      '[Cowork:StartSession] session created with modelOverride:',
      session.id,
      options.modelOverride,
    );
  }

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
  let storedImages: ReturnType<typeof persistCoworkImageAttachments> | undefined;
  if (options.imageAttachments?.length) {
    console.log('[Cowork:StartSession] imageAttachments received via IPC:', {
      count: options.imageAttachments.length,
      details: options.imageAttachments.map(img => ({
        name: img.name,
        mimeType: img.mimeType,
        base64Length: img.base64Data?.length ?? 0,
      })),
    });
    // Persist once at the IPC boundary; runtime receives paths only.
    storedImages = persistCoworkImageAttachments(
      deps.getCoworkImageRoot(),
      session.id,
      options.imageAttachments,
    );
    messageMetadata.imageAttachments = storedImages;
  }
  if (options.fileAttachments?.length) {
    messageMetadata.fileAttachments = options.fileAttachments;
  }
  coworkStoreInstance.addMessage(session.id, {
    type: 'user',
    content: options.prompt,
    metadata: Object.keys(messageMetadata).length > 0 ? messageMetadata : undefined,
  });
  coworkStoreInstance.touchWorkspace(session.workspaceId);

  // Start the session asynchronously (skip initial user message since we already added it)
  const runtime = deps.getPiRuntimeAdapter();
  const runtimeSkillIds = [
    ...new Set([
      ...(options.activeSkillIds || []),
      ...expertSnapshots.flatMap(expert => expert.skillIds),
    ]),
  ];
  const launch = () => {
    runtime
      .startSession(session.id, options.prompt, {
        skipInitialUserMessage: true,
        _workbenchRunId: internal.workbenchRunId,
        systemPrompt,
        skillIds: runtimeSkillIds,
        workspaceRoot: taskWorkingDirectory,
        confirmationMode: 'modal',
        sessionMode: options.mode ?? CoworkSessionMode.Work,
        goalMode: options.goalMode,
        codemode: config.codemodeEnabled === true,
        mcpNativeBridge: config.mcpNativeBridge === true,
        approvalMode:
          (options.permissionMode ?? config.permissionMode) === CoworkPermissionMode.AllowAll
            ? WorkbenchApprovalMode.AllowAll
            : WorkbenchApprovalMode.Ask,
        imageAttachments: storedImages,
        fileAttachments: options.fileAttachments,
        agentId: options.agentId,
        expertIds: expertSnapshots.map(expert => expert.expertId),
        modelOverride: options.modelOverride,
      })
      .catch(error => {
        console.error('[Cowork] session error:', error);
        try {
          internal.onFailure?.(error);
          const existing = coworkStoreInstance.getSession(session.id);
          reportPiSessionFailure(runtime, session.id, error, existing?.status);
        } catch (handlerError) {
          console.error('[Cowork] failed to send error notification to renderer:', handlerError);
        }
      });
  };
  return { session, launch };
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
    try {
      const prepared = prepareCoworkSession(deps, options);
      prepared.launch();
      return {
        success: true,
        session: sanitizeCoworkSessionForIpc(
          deps.getCoworkStore().getSession(prepared.session.id) || prepared.session,
        ),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start session',
      };
    }
  });
}
