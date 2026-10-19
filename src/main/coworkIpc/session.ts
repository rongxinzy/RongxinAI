/** Cowork session IPC: Start and Continue (prompt composition, experts, Pi handoff). */
import {
  haveSameExpertIds,
  haveSameExpertSnapshots,
  resolveCoworkPromptLanguage,
  resolveSessionExpertSnapshots,
} from '../appBootstrap/sessionExperts';
import { sanitizeCoworkSessionForIpc } from '../appBootstrap/ipcPayloadSanitize';
import { composeCoworkSystemPrompt } from '../coworkPrompt/composer';
import { generateCorrelationId, runWithCorrelationId } from '../libs/logCorrelation';
import { createLogger } from '../libs/structuredLog';
import type { AgentManager } from '../agentManager';
import type { CoworkStore } from '../coworkStore';
import type { PiRuntimeAdapter } from '../libs/agentEngine/piRuntimeAdapter';
import { handleIpcContract } from '../ipc/handleIpcContract';
import { coworkSessionLifecycleContract } from '../../shared/ipc/coworkContract';
import { CoworkSessionExpertSource } from '../../shared/cowork/sessionExperts';
import { persistCoworkImageAttachments } from '../coworkImageAttachments';
import { buildSessionTitleFromInput } from '../../common/sessionTitle';
import { reportPiSessionFailure } from '../piSessionFailure';
import { resolveCoworkContinuationSkillState } from '../coworkSessionSkills';
import { WorkbenchApprovalMode } from '../../shared/workbenchTask';
import { t } from '../i18n';
import {
  CoworkExecutionMode,
  CoworkPermissionMode,
  CoworkSessionMode,
} from '../../shared/cowork/constants';

export interface CoworkSessionIpcDeps {
  getCoworkImageRoot: () => string;
  getAgentManager: () => AgentManager;
  getCoworkStore: () => CoworkStore;
  getPiRuntimeAdapter: () => PiRuntimeAdapter;
  resolveSessionWorkingDirectory: (options: { cwd?: string }) => string;
  resolveTaskWorkingDirectory: (workspaceRoot: string) => string;
}

export const registerCoworkSessionIpc = (deps: CoworkSessionIpcDeps): void => {
  // Cowork IPC handlers
  handleIpcContract(coworkSessionLifecycleContract, {
    startSession: async (_event, options) => {
      const cid = generateCorrelationId();
      const log = createLogger('CoworkSession').withContext({ cid });
      log.info('session start requested', {
        prompt: options.prompt.slice(0, 80),
        agentId: options.agentId,
        systemPromptLen: options.systemPrompt?.length ?? 0,
      });
      return runWithCorrelationId(cid, async () => {
        try {
          // Work sessions use Pi (SDK mode, instant availability). No need to wait
          // for channel delivery; that gate applies only to IM/Cron paths.
          const coworkStoreInstance = deps.getCoworkStore();
          const config = coworkStoreInstance.getConfig();
          const selectedAgent = deps.getAgentManager().getAgent(options.agentId || 'main');
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
          const selectedTaskDirectory = deps.resolveSessionWorkingDirectory({
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
    },

    continueSession: async (_event, options) => {
      try {
        // Work sessions use Pi (SDK mode, instant availability).
        const runtime = deps.getPiRuntimeAdapter();
        const localStore = deps.getCoworkStore();
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
            deps.getCoworkImageRoot(),
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
              const existing = deps.getCoworkStore().getSession(options.sessionId, 0, {
                includeArtifacts: false,
              });
              reportPiSessionFailure(
                deps.getPiRuntimeAdapter(),
                options.sessionId,
                error,
                existing?.status,
              );
            } catch (handlerError) {
              console.error(
                '[Cowork] failed to send error notification to renderer:',
                handlerError,
              );
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
    },
  });
};
