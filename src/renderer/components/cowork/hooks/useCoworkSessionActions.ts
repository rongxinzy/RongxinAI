import { useRef } from 'react';
import { useDispatch } from 'react-redux';
import { buildSessionTitleFromInput } from '../../../../common/sessionTitle';
import {
  CoworkExecutionMode,
  CoworkPermissionMode,
  CoworkSessionMode,
  CoworkSessionSource,
} from '../../../../shared/cowork/constants';
import { CoworkSessionExpertSource } from '../../../../shared/cowork/sessionExperts';
import { configService } from '../../../services/config';
import { coworkService } from '../../../services/cowork';
import { coworkQueueService } from '../../../services/coworkQueue';
import { i18nService } from '../../../services/i18n';
import { normalizeError } from '../../../services/errorNormalization';
import { showAppToast } from '../../../services/toastNotification';
import { store, type RootState } from '../../../store';
import { addMessage, addSession, clearCurrentSession } from '../../../store/slices/coworkSlice';
import { clearSelection } from '../../../store/slices/quickActionSlice';
import { WorkMode } from '../../../store/workMode/constants';
import type {
  CoworkConfig,
  CoworkSession,
  CoworkImageAttachment,
  CoworkOutgoingImageAttachment,
  CoworkFileAttachment,
} from '../../../types/cowork';
import { toAgentModelRef } from '../../../utils/agentModelRef';
import {
  isChatSkillShortcutSelection,
  resolveChatSkillShortcutPermissionMode,
} from '../../chat/constants';
import type { SettingsOpenOptions } from '../../settings/types';
import type { useAgentSelectedModel } from '../agentModelSelection';
import type { useTaskResumeContext } from './useTaskResumeContext';

interface Options {
  currentSession: CoworkSession | null;
  workMode: WorkMode;
  currentAgent: RootState['agent']['agents'][number] | undefined;
  currentAgentId: RootState['agent']['currentAgentId'];
  currentAgentSelectedModel: ReturnType<typeof useAgentSelectedModel>;
  currentWorkspacePath: string;
  currentWorkspaceId: string | null;
  activeSkillIds: string[];
  isStreaming: boolean;
  config: CoworkConfig;
  sessionPermissionMode: CoworkPermissionMode;
  taskResume: ReturnType<typeof useTaskResumeContext>;
  clearUnmanagedWorkingDirectory(): void;
  onRequestAppSettings?(options?: SettingsOpenOptions): void;
}

/** Session actions share one admission/cancellation state across home and the task view. */
export function useCoworkSessionActions({
  currentSession,
  workMode,
  currentAgent,
  currentAgentId,
  currentAgentSelectedModel,
  currentWorkspacePath,
  currentWorkspaceId,
  activeSkillIds,
  isStreaming,
  config,
  sessionPermissionMode,
  taskResume,
  clearUnmanagedWorkingDirectory,
  onRequestAppSettings,
}: Options) {
  const dispatch = useDispatch();
  const startingSessionIdsRef = useRef(new Set<string>());
  const continuingSessionIdsRef = useRef(new Set<string>());
  // Track pending start request so stop can cancel delayed startup.
  const pendingStartRef = useRef<{
    requestId: number;
    cancelled: boolean;
    cancellationAction: 'stop' | 'delete' | null;
  } | null>(null);
  const startRequestIdRef = useRef(0);

  const buildApiConfigNotice = (
    error?: string,
  ): { noticeI18nKey: string; noticeExtra?: string } => {
    const key = 'coworkModelSettingsRequired';
    if (!error) {
      return { noticeI18nKey: key };
    }
    const normalizedError = error.trim();
    if (
      normalizedError.startsWith('No enabled provider found for model:') ||
      normalizedError === 'No available model configured in enabled providers.'
    ) {
      return { noticeI18nKey: key };
    }
    return { noticeI18nKey: key, noticeExtra: error };
  };

  const handleStartSession = async (
    prompt: string,
    imageAttachments?: CoworkOutgoingImageAttachment[],
    fileAttachments?: CoworkFileAttachment[],
    expertIds: string[] = [],
    goalMode = false,
  ): Promise<boolean | void> => {
    console.log('[CoworkView] handleStartSession: imageAttachments diagnosis', {
      hasImageAttachments: !!imageAttachments,
      count: imageAttachments?.length ?? 0,
      details:
        imageAttachments?.map(a => ({
          name: a.name,
          mimeType: a.mimeType,
          base64Length: a.base64Data?.length ?? 0,
        })) ?? [],
    });
    // Prevent duplicate submissions for the same session context.
    // Use currentSession.id so a second chat/work window can submit in parallel.
    const startSessionKey = currentSession?.id ?? `new-${workMode}`;
    if (startingSessionIdsRef.current.has(startSessionKey)) return;
    startingSessionIdsRef.current.add(startSessionKey);
    const requestId = ++startRequestIdRef.current;
    pendingStartRef.current = { requestId, cancelled: false, cancellationAction: null };
    const isPendingStartCancelled = () => {
      const pending = pendingStartRef.current;
      return !pending || pending.requestId !== requestId || pending.cancelled;
    };
    const getPendingCancellationAction = () => {
      const pending = pendingStartRef.current;
      if (!pending || pending.requestId !== requestId || !pending.cancelled) {
        return null;
      }
      return pending.cancellationAction;
    };

    try {
      try {
        // Finish configuration repair before main-process availability checks.
        await configService.init();
        const apiConfig = await coworkService.checkApiConfig();
        if (apiConfig && !apiConfig.hasConfig) {
          onRequestAppSettings?.({
            initialTab: 'model',
            ...buildApiConfigNotice(apiConfig.error),
          });
          startingSessionIdsRef.current.delete(startSessionKey);
          return false;
        }
      } catch (error) {
        console.error('Failed to check cowork API config:', error);
      }

      // Create a temporary session with user message to show immediately
      const tempSessionId = `temp-${Date.now()}`;
      const fallbackTitle = buildSessionTitleFromInput(
        prompt,
        i18nService.t('coworkDefaultSessionTitle'),
      );
      const now = Date.now();

      // Capture active skill IDs before clearing them
      const sessionSkillIds = [...activeSkillIds];

      // Chat sessions stay tagged as chat sessions while every turn executes
      // through the Pi agent runtime.
      const isChatAgentExecution = workMode === WorkMode.Chat;

      const tempSession: CoworkSession = {
        id: tempSessionId,
        title: fallbackTitle,
        status: 'idle',
        mode: workMode,
        pinned: false,
        createdAt: now,
        updatedAt: now,
        cwd: currentWorkspacePath,
        systemPrompt: '',
        modelOverride: currentAgentSelectedModel ? toAgentModelRef(currentAgentSelectedModel) : '',
        executionMode: config.executionMode || CoworkExecutionMode.Local,
        activeSkillIds: sessionSkillIds,
        workspaceId: currentWorkspaceId || '',
        agentId: currentAgentId,
        source: CoworkSessionSource.Manual,
        messages: [
          {
            id: `msg-${now}`,
            type: 'user',
            content: prompt,
            timestamp: now,
            metadata:
              sessionSkillIds.length > 0 ||
              (imageAttachments && imageAttachments.length > 0) ||
              (fileAttachments && fileAttachments.length > 0)
                ? {
                    ...(sessionSkillIds.length > 0 ? { skillIds: sessionSkillIds } : {}),
                    ...(imageAttachments && imageAttachments.length > 0
                      ? { imageAttachments }
                      : {}),
                    ...(fileAttachments && fileAttachments.length > 0 ? { fileAttachments } : {}),
                  }
                : undefined,
          },
        ],
        messagesOffset: 0,
        totalMessages: 1,
      };

      // Keep the temporary session in the list while the backend creates its
      // persistent Pi session, so attachments and the initial prompt remain
      // visible if startup takes time or fails.
      dispatch(addSession(tempSession));
      // Clear quick action selection after starting session
      dispatch(clearSelection());

      // Engine path: Work and Chat sessions. The engine loads skills natively via
      // skills.load.extraDirs, so skip the auto-routing prompt to avoid
      // injecting Claude SDK tool-calling instructions that confuse non-Claude
      // models (e.g. kimi-k2.5 falls back to text-based tool calls, producing
      // empty tool names and err=true failures).
      const isExpertAgent =
        currentAgent?.source === CoworkSessionExpertSource.Package ||
        currentAgent?.source === CoworkSessionExpertSource.Member;
      const agentSystemPrompt = isExpertAgent ? undefined : currentAgent?.systemPrompt?.trim();
      // Chat uses Pi's agent kernel without inheriting the complete Work
      // system prompt. Explicitly selected skills still travel as the prompt
      // fragment assembled below.
      const baseSystemPrompt = isChatAgentExecution
        ? ''
        : agentSystemPrompt || config.systemPrompt || '';
      // Skills are capabilities of the session, not text of the prompt: Pi
      // renders them into the system prompt from their directories, so nothing
      // from a skill is merged into the session prompt here.
      const sessionSystemPrompt = baseSystemPrompt;

      // Chat hides the folder selector, so the engine relies on
      // the configured default working directory. Bail out early with a toast
      // when no working directory is available at all.
      if (isChatAgentExecution && !currentWorkspacePath) {
        showAppToast(i18nService.t('chatAgentWorkingDirectoryRequired'));
        dispatch(clearCurrentSession());
        return;
      }

      // Start the actual session immediately with fallback title
      const sessionModelOverride = currentAgentSelectedModel
        ? toAgentModelRef(currentAgentSelectedModel)
        : '';
      const shouldAutoAllowChatSkill =
        workMode === WorkMode.Chat &&
        isChatAgentExecution &&
        isChatSkillShortcutSelection(sessionSkillIds);
      const sessionPermissionMode = shouldAutoAllowChatSkill
        ? resolveChatSkillShortcutPermissionMode(sessionSkillIds, config.permissionMode)
        : config.permissionMode;
      console.log('[CoworkView] creating session:', {
        modelId: currentAgentSelectedModel?.id,
        providerKey: currentAgentSelectedModel?.providerKey,
        agentId: currentAgentId,
        agentName: currentAgent?.name,
        agentSource: currentAgent?.source,
        agentSystemPrompt: agentSystemPrompt ? `${agentSystemPrompt.slice(0, 80)}...` : '(empty)',
        sessionSystemPrompt: sessionSystemPrompt
          ? `${sessionSystemPrompt.slice(0, 120)}...`
          : '(undefined)',
      });
      const { session: startedSession, error: startError } = await coworkService.startSession(
        {
          prompt,
          title: fallbackTitle,
          cwd: currentWorkspacePath || undefined,
          // An empty base prompt must stay undefined so main can fall back to the
          // agent's/default system prompt instead of composing from ''.
          systemPrompt: sessionSystemPrompt || undefined,
          // Chat stays tagged as a chat session so it remains in the Chat
          // sidebar list; Work sessions keep the default work mode.
          mode: isChatAgentExecution ? CoworkSessionMode.Chat : CoworkSessionMode.Work,
          activeSkillIds: sessionSkillIds,
          workspaceId: currentWorkspaceId || undefined,
          agentId: currentAgentId,
          expertIds,
          goalMode,
          modelOverride: sessionModelOverride,
          permissionMode: sessionPermissionMode,
          imageAttachments,
          fileAttachments,
        },
        tempSessionId,
      );

      if (!startedSession && startError) {
        // Show the error as a system message in the temp session
        dispatch(
          addMessage({
            sessionId: tempSessionId,
            message: {
              id: `error-${Date.now()}`,
              type: 'system',
              content: i18nService
                .t('coworkErrorSessionStartFailed')
                .replace('{error}', startError),
              timestamp: Date.now(),
            },
          }),
        );
        return;
      }

      if (startedSession) {
        if (shouldAutoAllowChatSkill) {
          await coworkService.updateConfig({
            permissionModeBySession: {
              ...(store.getState().cowork.config.permissionModeBySession ?? {}),
              [startedSession.id]: CoworkPermissionMode.AllowAll,
            },
          });
        }
        clearUnmanagedWorkingDirectory();
      }

      // Stop immediately if user cancelled while startup request was in flight.
      if (isPendingStartCancelled() && startedSession) {
        await coworkService.stopSession(startedSession.id);
        if (getPendingCancellationAction() === 'delete') {
          await coworkService.deleteSession(startedSession.id);
        }
      }
    } finally {
      if (pendingStartRef.current?.requestId === requestId) {
        pendingStartRef.current = null;
      }
      startingSessionIdsRef.current.delete(startSessionKey);
    }
  };

  const handleContinueSession = async (
    prompt: string,
    imageAttachments?: CoworkOutgoingImageAttachment[],
    fileAttachments?: CoworkFileAttachment[],
    expertIds: string[] = [],
    goalMode = false,
  ) => {
    if (!currentSession) return;
    if (taskResume.interruption) {
      return taskResume.resume({
        amendment: prompt,
        skillIds: [...activeSkillIds],
        expertIds,
        goalMode,
        imageAttachments: imageAttachments
          ?.filter(
            (image): image is CoworkImageAttachment & { base64Data: string } =>
              typeof image.base64Data === 'string',
          )
          .map(image => ({
            name: image.name,
            mimeType: image.mimeType,
            base64Data: image.base64Data,
          })),
        fileAttachments,
      });
    }
    if (continuingSessionIdsRef.current.has(currentSession.id)) return;

    // Work keeps the prompt editable while Pi is running. Normal input during
    // a live Work turn becomes an ordered Follow-up item; Chat uses Pi's
    // regular continuation path.
    if (
      workMode === WorkMode.Work &&
      isStreaming &&
      (currentSession.mode ?? CoworkSessionMode.Work) === CoworkSessionMode.Work
    ) {
      const result = await coworkQueueService.enqueue(
        currentSession.id,
        prompt,
        imageAttachments,
        fileAttachments,
        [...activeSkillIds],
      );
      if (!result.success) {
        showAppToast({
          message: normalizeError(result.error || i18nService.t('coworkQueueEnqueueFailed')),
          isError: true,
        });
        return false;
      }
      return true;
    }

    // Pi continuation path for Work and Chat sessions.
    continuingSessionIdsRef.current.add(currentSession.id);
    try {
      const sessionSkillIds = [...activeSkillIds];
      const isExpertAgent =
        currentAgent?.source === CoworkSessionExpertSource.Package ||
        currentAgent?.source === CoworkSessionExpertSource.Member;
      const agentSystemPrompt = isExpertAgent ? undefined : currentAgent?.systemPrompt?.trim();
      const isChatMode = workMode === WorkMode.Chat;
      const baseSystemPrompt = isChatMode ? '' : agentSystemPrompt || config.systemPrompt || '';

      await coworkService.continueSession({
        sessionId: currentSession.id,
        prompt,
        systemPrompt: isChatMode
          ? baseSystemPrompt || undefined
          : currentSession.systemPrompt || baseSystemPrompt,
        activeSkillIds: sessionSkillIds,
        expertIds,
        permissionMode: sessionPermissionMode,
        goalMode,
        imageAttachments,
        fileAttachments,
      });
    } finally {
      continuingSessionIdsRef.current.delete(currentSession.id);
    }
  };

  const handleStopSession = async () => {
    if (!currentSession) return;
    if (currentSession.id.startsWith('temp-') && pendingStartRef.current) {
      pendingStartRef.current.cancelled = true;
      pendingStartRef.current.cancellationAction = 'stop';
    }
    await coworkService.stopSession(currentSession.id);
  };

  return { handleStartSession, handleContinueSession, handleStopSession };
}
