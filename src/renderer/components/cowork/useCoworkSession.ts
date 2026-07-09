import { useCallback, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { buildSessionTitleFromInput } from '../../../common/sessionTitle';
import { apiService } from '../../services/api';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import {
  selectCoworkConfig,
  selectCurrentSession,
  selectIsStreaming,
} from '../../store/selectors/coworkSelectors';
import {
  addMessage,
  addSession,
  setCurrentSession,
  setStreaming,
  updateMessageContent,
  updateSessionStatus,
} from '../../store/slices/coworkSlice';
import type { CoworkImageAttachment, CoworkSession } from '../../types/cowork';
import { toOpenClawModelRef } from '../../utils/openclawModelRef';

interface UseCoworkSessionOptions {
  workMode: 'work' | 'chat';
  currentAgentWorkingDirectory: string;
  currentAgentId: string;
  currentAgentSelectedModel: { id: string; providerKey?: string; isServerModel?: boolean; model?: string } | null;
  activeSkillIds: string[];
  onClearQuickAction: () => void;
}

export function useCoworkSession({
  workMode,
  currentAgentWorkingDirectory,
  currentAgentId,
  currentAgentSelectedModel,
  activeSkillIds,
  onClearQuickAction,
}: UseCoworkSessionOptions) {
  const dispatch = useDispatch();
  const config = useSelector(selectCoworkConfig);
  const currentSession = useSelector(selectCurrentSession);
  const isStreaming = useSelector(selectIsStreaming);

  const isStartingRef = useRef(false);
  const isContinuingRef = useRef(false);
  const pendingStartRef = useRef<{
    requestId: number;
    cancelled: boolean;
    cancellationAction: 'stop' | 'delete' | null;
  } | null>(null);
  const startRequestIdRef = useRef(0);

  const isPendingStartCancelled = useCallback(() => {
    const pending = pendingStartRef.current;
    return !pending || pending.requestId !== startRequestIdRef.current || pending.cancelled;
  }, []);

  const getPendingCancellationAction = useCallback(() => {
    const pending = pendingStartRef.current;
    if (!pending || pending.requestId !== startRequestIdRef.current || !pending.cancelled) return null;
    return pending.cancellationAction;
  }, []);

  const handleStartSession = useCallback(async (
    prompt: string,
    skillPrompt?: string,
    imageAttachments?: CoworkImageAttachment[],
  ): Promise<boolean | void> => {
    if (isStartingRef.current) return;
    isStartingRef.current = true;
    const requestId = ++startRequestIdRef.current;
    pendingStartRef.current = { requestId, cancelled: false, cancellationAction: null };

    try {
      // Create a temporary session with user message to show immediately
      const tempSessionId = `temp-${Date.now()}`;
      const fallbackTitle = buildSessionTitleFromInput(prompt, i18nService.t('coworkDefaultSessionTitle'));
      const now = Date.now();
      const sessionSkillIds = [...activeSkillIds];

      const tempSession: CoworkSession = {
        id: tempSessionId,
        title: fallbackTitle,
        claudeSessionId: null,
        status: 'running',
        mode: workMode,
        pinned: false,
        createdAt: now,
        updatedAt: now,
        cwd: currentAgentWorkingDirectory,
        systemPrompt: '',
        modelOverride: currentAgentSelectedModel ? toOpenClawModelRef(currentAgentSelectedModel) : '',
        executionMode: config.executionMode || 'local',
        activeSkillIds: sessionSkillIds,
        agentId: currentAgentId,
        messages: [{ id: `msg-${now}`, type: 'user', content: prompt, timestamp: now, metadata: (sessionSkillIds.length > 0 || (imageAttachments?.length)) ? { ...(sessionSkillIds.length > 0 ? { skillIds: sessionSkillIds } : {}), ...(imageAttachments?.length ? { imageAttachments } : {}) } : undefined }],
        messagesOffset: 0,
        totalMessages: 1,
      };

      dispatch(setCurrentSession(tempSession));
      dispatch(setStreaming(true));
      onClearQuickAction();

      // ---- Chat mode ----
      if (workMode === 'chat') {
        await handleChatStart(prompt, tempSessionId, now, tempSession);
        return;
      }

      // ---- Work mode ----
      const combinedSystemPrompt = [skillPrompt, config.systemPrompt].filter(p => p?.trim()).join('\n\n') || undefined;
      const sessionModelOverride = currentAgentSelectedModel ? toOpenClawModelRef(currentAgentSelectedModel) : '';
      const { session: startedSession, error: startError } = await coworkService.startSession({
        prompt, title: fallbackTitle, cwd: currentAgentWorkingDirectory || undefined,
        systemPrompt: combinedSystemPrompt, activeSkillIds: sessionSkillIds,
        agentId: currentAgentId, modelOverride: sessionModelOverride, imageAttachments,
      });

      if (!startedSession && startError) {
        dispatch(addMessage({ sessionId: tempSessionId, message: { id: `error-${Date.now()}`, type: 'system', content: i18nService.t('coworkErrorSessionStartFailed').replace('{error}', startError), timestamp: Date.now() } }));
        dispatch(updateSessionStatus({ sessionId: tempSessionId, status: 'error' }));
        return;
      }

      if (isPendingStartCancelled() && startedSession) {
        await coworkService.stopSession(startedSession.id);
        if (getPendingCancellationAction() === 'delete') {
          await coworkService.deleteSession(startedSession.id);
        }
      }
    } finally {
      if (pendingStartRef.current?.requestId === requestId) pendingStartRef.current = null;
      isStartingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workMode, currentAgentWorkingDirectory, currentAgentId, currentAgentSelectedModel, activeSkillIds, config.executionMode, config.systemPrompt, dispatch, onClearQuickAction, isPendingStartCancelled, getPendingCancellationAction]);

  // ---- Chat mode helpers ----

  const handleChatStart = async (prompt: string, tempSessionId: string, now: number, tempSession: CoworkSession) => {
    const assistantMsgId = `msg-${now}-assistant`;
    const thinkingMsgId = `msg-${now}-thinking`;
    let assistantContent = '';
    let thinkingContent = '';
    let assistantMessageAdded = false;
    let thinkingMessageAdded = false;
    try {
      await apiService.chat(prompt, (content, reasoning) => {
        if (reasoning) {
          thinkingContent = reasoning;
          if (!thinkingMessageAdded) {
            dispatch(addMessage({ sessionId: tempSessionId, message: { id: thinkingMsgId, type: 'assistant', content: reasoning, timestamp: Date.now(), metadata: { isStreaming: true, isFinal: false, isThinking: true } } }));
            thinkingMessageAdded = true;
          } else {
            dispatch(updateMessageContent({ sessionId: tempSessionId, messageId: thinkingMsgId, content: reasoning, metadata: { isStreaming: true, isFinal: false, isThinking: true } }));
          }
        }
        if (content) {
          assistantContent = content;
          if (!assistantMessageAdded) {
            dispatch(addMessage({ sessionId: tempSessionId, message: { id: assistantMsgId, type: 'assistant', content, timestamp: Date.now(), metadata: { isStreaming: true, isFinal: false } } }));
            assistantMessageAdded = true;
          } else {
            dispatch(updateMessageContent({ sessionId: tempSessionId, messageId: assistantMsgId, content, metadata: { isStreaming: true, isFinal: false } }));
          }
        }
      }, []);
      if (isPendingStartCancelled()) { dispatch(updateSessionStatus({ sessionId: tempSessionId, status: 'idle' })); dispatch(setStreaming(false)); return; }
      const finalMessages = [
        { id: `msg-${now}`, type: 'user' as const, content: prompt, timestamp: now },
        ...(thinkingContent ? [{ id: thinkingMsgId, type: 'assistant' as const, content: thinkingContent, timestamp: Date.now(), metadata: { isStreaming: false, isFinal: true, isThinking: true } }] : []),
        ...(assistantContent ? [{ id: assistantMsgId, type: 'assistant' as const, content: assistantContent, timestamp: Date.now(), metadata: { isStreaming: false, isFinal: true } }] : []),
      ];
      const savedSession: CoworkSession = { ...tempSession, status: 'completed', updatedAt: Date.now(), messages: finalMessages, totalMessages: finalMessages.length };
      dispatch(updateSessionStatus({ sessionId: tempSessionId, status: 'completed' }));
      dispatch(addSession(savedSession));
      coworkService.saveChatSession(savedSession).catch(err => console.error('[CoworkView] Failed to persist:', err));
    } catch (error) {
      dispatch(updateSessionStatus({ sessionId: tempSessionId, status: 'error' }));
      dispatch(addMessage({ sessionId: tempSessionId, message: { id: `error-${Date.now()}`, type: 'system', content: i18nService.t('chatErrorMessage').replace('{error}', error instanceof Error ? error.message : 'Unknown error'), timestamp: Date.now() } }));
    } finally {
      dispatch(setStreaming(false));
      isStartingRef.current = false;
    }
  };

  const handleContinueSession = useCallback(async (prompt: string, skillPrompt?: string, imageAttachments?: CoworkImageAttachment[]) => {
    if (!currentSession) return;
    if (isContinuingRef.current) return;

    if (workMode === 'chat') {
      await handleChatContinue(prompt);
      return;
    }

    // Work mode
    isContinuingRef.current = true;
    try {
      const sessionSkillIds = [...activeSkillIds];
      const combinedSystemPrompt = [skillPrompt, config.systemPrompt].filter(p => p?.trim()).join('\n\n') || undefined;
      await coworkService.continueSession({ sessionId: currentSession.id, prompt, systemPrompt: combinedSystemPrompt, activeSkillIds: sessionSkillIds.length > 0 ? sessionSkillIds : undefined, imageAttachments });
    } finally {
      isContinuingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workMode, currentSession, activeSkillIds, config.systemPrompt, dispatch]);

  const handleChatContinue = async (prompt: string) => {
    if (!currentSession) return;
    isContinuingRef.current = true;
    const assistantMsgId = `msg-${Date.now()}-assistant`;
    const thinkingMsgId = `msg-${Date.now()}-thinking`;
    let assistantMessageAdded = false;
    let thinkingMessageAdded = false;
    try {
      const userMsgId = `msg-${Date.now()}`;
      dispatch(addMessage({ sessionId: currentSession.id, message: { id: userMsgId, type: 'user', content: prompt, timestamp: Date.now() } }));
      const history = (currentSession.messages || []).filter(m => m.type === 'user' || m.type === 'assistant').map(m => ({ role: m.type as 'user' | 'assistant', content: m.content || '' }));
      dispatch(setStreaming(true));
      await apiService.chat(prompt, (content, reasoning) => {
        if (reasoning) {
          if (!thinkingMessageAdded) {
            dispatch(addMessage({ sessionId: currentSession.id, message: { id: thinkingMsgId, type: 'assistant', content: reasoning, timestamp: Date.now(), metadata: { isStreaming: true, isFinal: false, isThinking: true } } }));
            thinkingMessageAdded = true;
          } else {
            dispatch(updateMessageContent({ sessionId: currentSession.id, messageId: thinkingMsgId, content: reasoning, metadata: { isStreaming: true, isFinal: false, isThinking: true } }));
          }
        }
        if (content) {
          if (!assistantMessageAdded) {
            dispatch(addMessage({ sessionId: currentSession.id, message: { id: assistantMsgId, type: 'assistant', content, timestamp: Date.now(), metadata: { isStreaming: true, isFinal: false } } }));
            assistantMessageAdded = true;
          } else {
            dispatch(updateMessageContent({ sessionId: currentSession.id, messageId: assistantMsgId, content, metadata: { isStreaming: true, isFinal: false } }));
          }
        }
      }, history);
      dispatch(updateSessionStatus({ sessionId: currentSession.id, status: 'completed' }));
    } catch (error) {
      dispatch(updateSessionStatus({ sessionId: currentSession.id, status: 'error' }));
      dispatch(addMessage({ sessionId: currentSession.id, message: { id: `error-${Date.now()}`, type: 'system', content: i18nService.t('chatErrorMessage').replace('{error}', error instanceof Error ? error.message : 'Unknown error'), timestamp: Date.now() } }));
    } finally {
      dispatch(setStreaming(false));
      isContinuingRef.current = false;
    }
  };

  const handleStopSession = useCallback(async () => {
    if (!currentSession) return;
    if (workMode === 'chat') { dispatch(setStreaming(false)); return; }
    if (currentSession.id.startsWith('temp-') && pendingStartRef.current) {
      pendingStartRef.current.cancelled = true;
      pendingStartRef.current.cancellationAction = 'stop';
    }
    await coworkService.stopSession(currentSession.id);
  }, [workMode, currentSession, dispatch]);

  return { handleStartSession, handleContinueSession, handleStopSession, isStreaming, currentSession };
}
