/** Cowork session IPC: Start and Continue (prompt composition, experts, Pi handoff). */
import { ipcMain } from 'electron';

import { rt } from './runtimeState';
import { getCoworkImageRoot } from './coworkSessionImages';
import { getAgentManager, getCoworkStore } from './runtimeServices';
import { getPiRuntimeAdapter } from './sessionServices';
import {
  haveSameExpertIds,
  haveSameExpertSnapshots,
  resolveCoworkPromptLanguage,
  resolveSessionExpertSnapshots,
} from './sessionExperts';
import { applyMessageTriageRouting } from './messageTriage';
import { resolveSessionWorkingDirectory, resolveTaskWorkingDirectory } from './workspacePaths';
import { sanitizeCoworkMessageForIpc, sanitizeCoworkSessionForIpc } from './ipcPayloadSanitize';
import { composeCoworkSystemPrompt } from '../coworkPrompt/composer';
import { generateCorrelationId, runWithCorrelationId } from '../libs/logCorrelation';
import { createLogger } from '../libs/structuredLog';
import { CoworkSessionContinueSchema, CoworkSessionStartSchema } from '../../shared/ipc/schemas';
import {
  CoworkSessionExpertSource,
  normalizeSingleExpertIds,
} from '../../shared/cowork/sessionExperts';
import { persistCoworkImageAttachments } from '../coworkImageAttachments';
import { buildSessionTitleFromInput } from '../../common/sessionTitle';
import { reportPiSessionFailure } from '../piSessionFailure';
import { resolveCoworkContinuationSkillState } from '../coworkSessionSkills';
import { WorkbenchApprovalMode } from '../../shared/workbenchTask';
import { t } from '../i18n';
import { parseCoworkExecutionMode } from '../../shared/cowork/executionMode';
import {
  CoworkExecutionMode,
  CoworkPermissionMode,
  CoworkSessionMode,
  CoworkSessionSource,
  COWORK_MESSAGE_PAGE_SIZE,
  COWORK_SESSION_PAGE_SIZE,
  normalizeRenamedSessionTitle,
  type CoworkCompactResult,
  CoworkCompactFailure,
} from '../../shared/cowork/constants';
import { CoworkSessionIpc } from '../../shared/ipc/channels';

export const registerCoworkSessionIpc = (): void => {
  // Cowork IPC handlers
  ipcMain.handle(CoworkSessionIpc.Start, async (_event, rawOptions: unknown) => {
    const cid = generateCorrelationId();
    const log = createLogger('CoworkSession').withContext({ cid });
    const options = CoworkSessionStartSchema.input.parse(rawOptions);
    log.info('session start requested', {
      prompt: options.prompt.slice(0, 80),
      agentId: options.agentId,
      systemPromptLen: options.systemPrompt?.length ?? 0,
    });
    return runWithCorrelationId(cid, async () => {
      try {
        // Work sessions use Pi (SDK mode, instant availability). No need to wait
        // for channel delivery; that gate applies only to IM/Cron paths.
        const coworkStoreInstance = getCoworkStore();
        const config = coworkStoreInstance.getConfig();
        const selectedAgent = getAgentManager().getAgent(options.agentId || 'main');
        const fallbackExpertIds =
          selectedAgent &&
          (selectedAgent.source === CoworkSessionExpertSource.Package ||
            selectedAgent.source === CoworkSessionExpertSource.Member)
            ? [selectedAgent.id]
            : [];
        const expertSnapshots = resolveSessionExpertSnapshots(
          options.expertIds ?? fallbackExpertIds,
        );
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
        const selectedTaskDirectory = resolveSessionWorkingDirectory({
          cwd: options.cwd || workspace?.path,
        });

        if (!selectedTaskDirectory) {
          return {
            success: false,
            error: 'Please select a task folder before submitting.',
          };
        }
        const selectedWorkspace =
          workspace || coworkStoreInstance.ensureWorkspace(selectedTaskDirectory);

        const fallbackTitle = buildSessionTitleFromInput(
          options.prompt,
          t('coworkDefaultSessionTitle'),
        );
        const title = options.title?.trim() || fallbackTitle;
        const taskWorkingDirectory = resolveTaskWorkingDirectory(selectedTaskDirectory);

        const session = coworkStoreInstance.createSession(
          title,
          taskWorkingDirectory,
          systemPrompt,
          config.executionMode || CoworkExecutionMode.Local,
          options.activeSkillIds || [],
          options.agentId || 'main',
          options.modelOverride || '',
          options.mode ?? CoworkSessionMode.Work,
          undefined,
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
            getCoworkImageRoot(),
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
        const runtime = getPiRuntimeAdapter();
        const runtimeSkillIds = [
          ...new Set([
            ...(options.activeSkillIds || []),
            ...expertSnapshots.flatMap(expert => expert.skillIds),
          ]),
        ];
        runtime
          .startSession(session.id, options.prompt, {
            skipInitialUserMessage: true,
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
              const existing = coworkStoreInstance.getSession(session.id);
              reportPiSessionFailure(runtime, session.id, error, existing?.status);
            } catch (handlerError) {
              console.error(
                '[Cowork] failed to send error notification to renderer:',
                handlerError,
              );
            }
          });

        const sessionWithMessages = coworkStoreInstance.getSession(session.id) || {
          ...session,
          status: 'idle' as const,
        };
        return { success: true, session: sanitizeCoworkSessionForIpc(sessionWithMessages) };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to start session',
        };
      }
    });
  });

  ipcMain.handle(CoworkSessionIpc.Continue, async (_event, rawOptions: unknown) => {
    try {
      const options = CoworkSessionContinueSchema.input.parse(rawOptions);
      // Work sessions use Pi (SDK mode, instant availability).
      const runtime = getPiRuntimeAdapter();
      const localStore = getCoworkStore();
      let existingSession = localStore.getSession(options.sessionId, 0, {
        includeArtifacts: false,
      });
      if (existingSession) {
        const previousExpertSnapshots = existingSession.experts;
        const expertSnapshots =
          options.expertIds === undefined ||
          haveSameExpertIds(previousExpertSnapshots, options.expertIds)
            ? previousExpertSnapshots.slice(0, 1)
            : resolveSessionExpertSnapshots(options.expertIds);
        const isChatSession = existingSession?.mode === CoworkSessionMode.Chat;
        const nextSystemPrompt = isChatSession
          ? (options.systemPrompt ?? '').trim()
          : composeCoworkSystemPrompt({
              basePrompt: existingSession.systemPrompt || options.systemPrompt,
              expertSnapshots,
              previousExpertSnapshots,
              language: resolveCoworkPromptLanguage(),
            });
        const expertsChanged = !haveSameExpertSnapshots(previousExpertSnapshots, expertSnapshots);
        if (expertsChanged) {
          localStore.replaceSessionExperts(options.sessionId, expertSnapshots);
        }
        if (nextSystemPrompt !== existingSession.systemPrompt) {
          localStore.updateSession(options.sessionId, { systemPrompt: nextSystemPrompt });
        }
        if (expertsChanged || nextSystemPrompt !== existingSession.systemPrompt) {
          existingSession = localStore.getSession(options.sessionId, 0, {
            includeArtifacts: false,
          });
        }
      }
      let storedImages: ReturnType<typeof persistCoworkImageAttachments> | undefined;
      if (options.imageAttachments?.length) {
        console.log('[Cowork:ContinueSession] imageAttachments received via IPC:', {
          sessionId: options.sessionId,
          count: options.imageAttachments.length,
          details: options.imageAttachments.map(img => ({
            name: img.name,
            mimeType: img.mimeType,
            base64Length: img.base64Data?.length ?? 0,
          })),
        });
        // Persist once at the IPC boundary; runtime receives paths only.
        storedImages = persistCoworkImageAttachments(
          getCoworkImageRoot(),
          options.sessionId,
          options.imageAttachments,
        );
      }

      const continuationSkillState = resolveCoworkContinuationSkillState({
        activeSkillIds: options.activeSkillIds,
        savedSkillIds: existingSession?.activeSkillIds,
        expertSkillIds: (existingSession?.experts || []).flatMap(expert => expert.skillIds),
      });

      // The session keeps a skill until the user removes it, so this turn's
      // picks are added to the persisted capability set rather than replacing it.
      try {
        localStore.updateSession(
          options.sessionId,
          { activeSkillIds: continuationSkillState.sessionSkillIds },
          { touchUpdatedAt: false },
        );
      } catch (error) {
        console.error('[Cowork:ContinueSession] failed to persist activeSkillIds:', error);
      }

      const runtimeSkillIds = continuationSkillState.runtimeSkillIds;
      const sessionMode = existingSession?.mode ?? CoworkSessionMode.Work;

      const runtimeSystemPrompt = existingSession
        ? existingSession.systemPrompt
        : sessionMode === CoworkSessionMode.Chat
          ? (options.systemPrompt ?? '').trim()
          : composeCoworkSystemPrompt({
              basePrompt: options.systemPrompt,
              language: resolveCoworkPromptLanguage(),
            });

      if (existingSession && options.prompt.trim()) {
        localStore.touchWorkspace(existingSession.workspaceId);
      }

      try {
        await applyMessageTriageRouting(options.sessionId, options.prompt);
      } catch (triageError) {
        console.warn('[Triage] routing failed; continuing with the current model:', triageError);
      }

      runtime
        .continueSession(options.sessionId, options.prompt, {
          systemPrompt: runtimeSystemPrompt,
          skillIds: runtimeSkillIds,
          // The user's per-input selection (empty when they attached none) is
          // what the transcript shows; runtimeSkillIds also carries the expert
          // preset bundle and must not reappear as chips on this turn.
          attachedSkillIds: options.activeSkillIds,
          sessionMode,
          goalMode: options.goalMode,
          codemode: localStore.getConfig().codemodeEnabled === true,
          mcpNativeBridge: localStore.getConfig().mcpNativeBridge === true,
          imageAttachments: storedImages,
          fileAttachments: options.fileAttachments,
          workspaceRoot: existingSession?.cwd,
          agentId: existingSession?.agentId,
          expertIds: existingSession?.experts.map(expert => expert.expertId),
          modelOverride: existingSession?.modelOverride,
          approvalMode:
            (options.permissionMode ??
              localStore.getConfig().permissionModeBySession[options.sessionId] ??
              localStore.getConfig().permissionMode) === CoworkPermissionMode.AllowAll
              ? WorkbenchApprovalMode.AllowAll
              : WorkbenchApprovalMode.Ask,
        })
        .catch(error => {
          console.error('[Cowork] continue error:', error);
          try {
            const existing = getCoworkStore().getSession(options.sessionId, 0, {
              includeArtifacts: false,
            });
            reportPiSessionFailure(
              getPiRuntimeAdapter(),
              options.sessionId,
              error,
              existing?.status,
            );
          } catch (handlerError) {
            console.error('[Cowork] failed to send error notification to renderer:', handlerError);
          }
        });

      const session = localStore.getSession(options.sessionId, 0, { includeArtifacts: false });
      return { success: true, session: session ? sanitizeCoworkSessionForIpc(session) : session };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to continue session',
      };
    }
  });
};
