/** Cowork session IPC: start, continue and respond to Pi permissions. */
import {
  haveSameExpertIds,
  haveSameExpertSnapshots,
  resolveCoworkPromptLanguage,
  resolveSessionExpertSnapshots,
} from '../../appBootstrap/sessionExperts';
import { sanitizeCoworkSessionForIpc } from '../../appBootstrap/ipcPayloadSanitize';
import { composeCoworkSystemPrompt } from '../../coworkPrompt/composer';
import { handleIpcContract } from '../../ipc/handleIpcContract';
import { coworkSessionLifecycleContract } from '../../../shared/ipc/coworkContract';
import { projectCoworkSessionRuntimeState } from '../../coworkSessionRuntimeState';
import { t } from '../../i18n';
import { CoworkSessionMode, CoworkSubmissionErrorCode } from '../../../shared/cowork/constants';
import { resolveCoworkApprovalMode } from './approvalMode';

import {
  assertCoworkSubmissionOpen,
  startCoworkSession,
  type CoworkSessionIpcDeps,
} from './sessionStart';
export type { CoworkSessionIpcDeps } from './sessionStart';

export const registerCoworkSessionIpc = (deps: CoworkSessionIpcDeps): void => {
  // Cowork IPC handlers
  handleIpcContract(coworkSessionLifecycleContract, {
    startSession: (_event, options) => startCoworkSession(deps, options),

    respondToPermission: async (_event, options) => {
      try {
        deps.getPiRuntimeAdapter().respondToPermission(options.requestId, options.result);
        return { success: true as const };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to respond to permission',
        };
      }
    },

    continueSession: async (_event, options) => {
      try {
        assertCoworkSubmissionOpen();
        // Work sessions use Pi (SDK mode, instant availability).
        const runtime = deps.getPiRuntimeAdapter();
        if (runtime.isSessionReservedForDelivery(options.sessionId)) {
          return { success: false, error: t('modelPoolSessionBusy') };
        }
        if (runtime.isSessionCompacting(options.sessionId)) {
          return { success: false, code: CoworkSubmissionErrorCode.Compacting };
        }
        const localStore = deps.getCoworkStore();
        let existingSession = localStore.getSession(options.sessionId, 0, {
          includeArtifacts: false,
        });
        if (!existingSession) return { success: false, error: t('coworkSessionNotFound') };

        let replacement;
        if (
          options.expertIds !== undefined &&
          !haveSameExpertIds(existingSession.experts, options.expertIds)
        ) {
          replacement = await resolveSessionExpertSnapshots(options.expertIds);
          assertCoworkSubmissionOpen();
          if (runtime.isSessionReservedForDelivery(options.sessionId)) {
            return { success: false, error: t('modelPoolSessionBusy') };
          }
          existingSession = localStore.getSession(options.sessionId, 0, {
            includeArtifacts: false,
          });
          if (!existingSession) return { success: false, error: t('coworkSessionNotFound') };
        }
        const previousExpertSnapshots = existingSession.experts;
        if (runtime.isSessionCompacting(options.sessionId)) {
          return { success: false, code: CoworkSubmissionErrorCode.Compacting };
        }
        const expertSnapshots = replacement ?? previousExpertSnapshots.slice(0, 1);
        const nextSystemPrompt =
          existingSession.mode === CoworkSessionMode.Chat
            ? (options.systemPrompt ?? '').trim()
            : composeCoworkSystemPrompt({
                basePrompt: existingSession.systemPrompt || options.systemPrompt,
                expertSnapshots,
                previousExpertSnapshots,
                language: resolveCoworkPromptLanguage(),
              });
        const expertsChanged = !haveSameExpertSnapshots(previousExpertSnapshots, expertSnapshots);
        const systemPromptChanged = nextSystemPrompt !== existingSession.systemPrompt;
        if (expertsChanged || systemPromptChanged) {
          localStore.updateSessionPrompt(options.sessionId, {
            expertSnapshots: expertsChanged ? expertSnapshots : undefined,
            systemPrompt: systemPromptChanged ? nextSystemPrompt : undefined,
          });
          const refreshedSession = localStore.getSession(options.sessionId, 0, {
            includeArtifacts: false,
          });
          if (!refreshedSession) return { success: false, error: t('coworkSessionNotFound') };
          existingSession = refreshedSession;
        }
        const attachedSkillIds = options.activeSkillIds ?? [];
        let sessionSkillIds = [...existingSession.activeSkillIds, ...attachedSkillIds];
        if (attachedSkillIds.length) {
          try {
            sessionSkillIds = localStore.appendSessionSkills(options.sessionId, attachedSkillIds);
          } catch (error) {
            console.error('[Cowork:ContinueSession] failed to persist activeSkillIds:', error);
          }
        }
        const runtimeSkillIds = [
          ...new Set([
            ...sessionSkillIds,
            ...existingSession.experts.flatMap(expert => expert.skillIds),
          ]),
        ];

        if (options.prompt.trim()) {
          localStore.workspaces.touchWorkspace(existingSession.workspaceId);
        }

        runtime
          .continueSession(options.sessionId, options.prompt, {
            systemPrompt: existingSession.systemPrompt,
            skillIds: runtimeSkillIds,
            // The transcript shows only the skills attached to this input.
            attachedSkillIds: options.activeSkillIds,
            sessionMode: existingSession.mode,
            goalMode: options.goalMode,
            codemode: localStore.getConfig().codemodeEnabled === true,
            imageAttachments: options.imageAttachments,
            fileAttachments: options.fileAttachments,
            workspaceRoot: existingSession.cwd,
            agentId: existingSession.agentId,
            expertIds: existingSession.experts.map(expert => expert.expertId),
            modelOverride: existingSession.modelOverride,
            approvalMode: resolveCoworkApprovalMode(
              options.permissionMode ??
                localStore.getConfig().permissionModeBySession[options.sessionId] ??
                localStore.getConfig().permissionMode,
            ),
          })
          .catch(error => {
            console.error('[Cowork] continue error:', error);
            try {
              runtime.recovery.reportRejectedSubmission(options.sessionId, error);
            } catch (handlerError) {
              console.error(
                '[Cowork] failed to send error notification to renderer:',
                handlerError,
              );
            }
          });

        const session = localStore.getSession(options.sessionId, 0, { includeArtifacts: false });
        return {
          success: true,
          session:
            session &&
            sanitizeCoworkSessionForIpc(
              projectCoworkSessionRuntimeState(session, runtime.isSessionRunning(session.id)),
            ),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to continue session',
        };
      }
    },
  });
};
