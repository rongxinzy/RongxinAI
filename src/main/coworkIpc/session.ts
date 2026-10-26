/** Cowork session IPC: Start and Continue (prompt composition, experts, Pi handoff). */
import {
  haveSameExpertIds,
  haveSameExpertSnapshots,
  resolveCoworkPromptLanguage,
  resolveSessionExpertSnapshots,
} from '../appBootstrap/sessionExperts';
import { sanitizeCoworkSessionForIpc } from '../appBootstrap/ipcPayloadSanitize';
import { composeCoworkSystemPrompt } from '../coworkPrompt/composer';
import { handleIpcContract } from '../ipc/handleIpcContract';
import { coworkSessionLifecycleContract } from '../../shared/ipc/coworkContract';
import { persistCoworkImageAttachments } from '../coworkImageAttachments';
import { reportPiSessionFailure } from '../piSessionFailure';
import { resolveCoworkContinuationSkillState } from '../coworkSessionSkills';
import { WorkbenchApprovalMode } from '../../shared/workbenchTask';
import { CoworkPermissionMode, CoworkSessionMode } from '../../shared/cowork/constants';

import { startCoworkSession, type CoworkSessionIpcDeps } from './sessionStart';
export type { CoworkSessionIpcDeps } from './sessionStart';

export const registerCoworkSessionIpc = (deps: CoworkSessionIpcDeps): void => {
  // Cowork IPC handlers
  handleIpcContract(coworkSessionLifecycleContract, {
    startSession: (_event, options) => startCoworkSession(deps, options),

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
