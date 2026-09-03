import {
  type CoworkError,
  CoworkErrorKind,
  ENGINE_NOT_READY_CODE,
  getUserErrorI18nKey,
} from '../../common/coworkError';
import { classifyErrorKey } from '../../common/coworkErrorClassify';
import {
  COWORK_MESSAGE_HISTORY_PAGE_SIZE,
  COWORK_SESSION_PAGE_SIZE,
  CoworkPermissionOrigin,
  CoworkSessionMode,
  type CoworkSessionSource,
} from '../../shared/cowork/constants';
import { store } from '../store';
import { setCurrentAgentId } from '../store/slices/agentSlice';
import {
  addMessage,
  addSession,
  appendSessions,
  clearCurrentSession,
  clearPendingPermissionsForSession,
  deleteSession as deleteSessionAction,
  deleteSessions as deleteSessionsAction,
  dequeuePendingPermission,
  enqueuePendingPermission,
  prependMessages,
  setConfig,
  setChatSessions,
  setCurrentSession,
  setHasMoreSessions,
  setRemoteManaged,
  setSessions,
  updateMessageContents,
  updateToolActivity,
  updateSessionPinned,
  updateCurrentSessionModelOverride,
  updateSessionStatus,
  updateSessionTitle,
} from '../store/slices/coworkSlice';
import { clearActiveSkills } from '../store/slices/skillSlice';
import type {
  CoworkApiConfig,
  CoworkConfigUpdate,
  CoworkContinueOptions,
  CoworkPermissionRequest,
  CoworkPermissionResult,
  CoworkSession,
  CoworkSessionListResult,
  CoworkSessionResult,
  CoworkStartOptions,
} from '../types/cowork';
import { i18nService } from './i18n';
import { respondToPermissionByOrigin } from './coworkPermissionRouting';
import { prepareCoworkSessionRender } from './coworkSessionRenderPreparation';
import {
  createCoworkTerminalErrorMessage,
  hasMatchingLatestTerminalError,
  resolveCoworkTerminalError,
} from './coworkTerminalError';
import { RafMessageUpdateBatcher } from './rafMessageUpdateBatcher';
import { workspaceService } from './workspace';

const classifyError = (error: string | CoworkError): string => {
  if (typeof error === 'object' && 'kind' in error) {
    const key = getUserErrorI18nKey(error.kind);
    return key ? i18nService.t(key) : error.message;
  }
  const key = classifyErrorKey(error);
  return key ? i18nService.t(key) : error;
};

class CoworkService {
  private streamListenerCleanups: Array<() => void> = [];
  private initialized = false;
  private latestLoadSessionsRequestId = 0;
  private latestLoadChatSessionsRequestId = 0;
  private latestLoadSessionRequestId = 0;

  async init(): Promise<void> {
    if (this.initialized) return;

    // Load initial config
    await this.loadConfig();

    // Load workspaces and the sessions belonging to the selected workspace.
    await workspaceService.loadWorkspaces();
    await Promise.all([
      this.loadSessions(undefined, store.getState().workspace.currentWorkspaceId ?? undefined),
      this.loadChatSessions(),
    ]);

    // Set up stream listeners
    this.setupStreamListeners();

    this.initialized = true;
  }

  private setupStreamListeners(): void {
    const cowork = window.electron?.cowork;
    if (!cowork) return;

    // Clean up any existing listeners
    this.cleanupListeners();

    // Message listener - also check if session exists (for IM-created sessions)
    const messageCleanup = cowork.onStreamMessage(async ({ sessionId, message }) => {
      // Debug: log user messages to check if imageAttachments are preserved
      if (message.type === 'user') {
        const meta = message.metadata as Record<string, unknown> | undefined;
        console.log('[CoworkService] onStreamMessage received user message', {
          sessionId,
          messageId: message.id,
          hasMetadata: !!meta,
          metadataKeys: meta ? Object.keys(meta) : [],
          hasImageAttachments: !!meta?.imageAttachments,
          imageAttachmentsCount: Array.isArray(meta?.imageAttachments)
            ? (meta.imageAttachments as unknown[]).length
            : 0,
        });
      }
      // Check if session exists in current list
      const state = store.getState().cowork;
      const sessionExists = [...state.sessions, ...state.chatSessions].some(
        session => session.id === sessionId,
      );

      console.log(
        '[CoworkService] onStreamMessage: sessionId=',
        sessionId,
        'type=',
        message.type,
        'sessionExists=',
        sessionExists,
        'totalSessions=',
        state.sessions.length,
      );
      if (!sessionExists) {
        // Session was created by IM or another source, refresh the session list
        console.log(
          '[CoworkService] onStreamMessage: session NOT found in Redux, calling loadSessions...',
        );
        await Promise.all([this.loadSessions(), this.loadChatSessions()]);
        const newState = store.getState().cowork;
        const nowExists = [...newState.sessions, ...newState.chatSessions].some(
          session => session.id === sessionId,
        );
        console.log(
          '[CoworkService] onStreamMessage: after loadSessions, sessionExists=',
          nowExists,
          'totalSessions=',
          newState.sessions.length,
        );
      }

      // A new user turn means this session is actively running again
      // (especially important for IM-triggered turns that do not call continueSession from renderer).
      if (message.type === 'user') {
        store.dispatch(updateSessionStatus({ sessionId, status: 'running' }));
      }

      // Do not force status back to "running" on arbitrary messages.
      // Late stream chunks can arrive after an error/complete event.
      store.dispatch(addMessage({ sessionId, message }));
    });
    this.streamListenerCleanups.push(messageCleanup);

    // Keep the latest update per message for the next frame. Thinking and answer
    // messages can be finalized back-to-back, so a single pending slot loses one.
    const updateBatcher = new RafMessageUpdateBatcher(updates => {
      store.dispatch(updateMessageContents(updates));
    });
    const messageUpdateCleanup = cowork.onStreamMessageUpdate(update => {
      updateBatcher.enqueue(update);
    });
    const messageUpdateRafCleanup = () => {
      updateBatcher.dispose();
      messageUpdateCleanup();
    };
    this.streamListenerCleanups.push(messageUpdateRafCleanup);

    const toolActivityCleanup = cowork.onStreamToolActivity(payload => {
      store.dispatch(updateToolActivity(payload));
    });
    this.streamListenerCleanups.push(toolActivityCleanup);

    // Permission request listener
    const permissionCleanup = cowork.onStreamPermission(({ sessionId, request }) => {
      store.dispatch(
        enqueuePendingPermission({
          origin: CoworkPermissionOrigin.PiWorkbench,
          sessionId,
          toolName: request.toolName,
          toolInput: request.toolInput,
          requestId: request.requestId,
          toolUseId: request.toolUseId ?? null,
        }),
      );
    });
    this.streamListenerCleanups.push(permissionCleanup);

    // Permission dismiss listener (timeout or server-side resolution)
    const permissionDismissCleanup = cowork.onStreamPermissionDismiss(({ requestId }) => {
      store.dispatch(dequeuePendingPermission({ requestId }));
    });
    this.streamListenerCleanups.push(permissionDismissCleanup);

    const interruptedCleanup = cowork.onStreamInterrupted(({ sessionId }) => {
      store.dispatch(clearPendingPermissionsForSession(sessionId));
      store.dispatch(updateSessionStatus({ sessionId, status: 'idle' }));
    });
    this.streamListenerCleanups.push(interruptedCleanup);

    // Complete listener
    const completeCleanup = cowork.onStreamComplete(({ sessionId }) => {
      store.dispatch(updateSessionStatus({ sessionId, status: 'completed' }));
    });
    this.streamListenerCleanups.push(completeCleanup);

    // Error listener
    const errorCleanup = cowork.onStreamError(({ sessionId, error }) => {
      const stateBeforeStatusUpdate = store.getState().cowork;
      const terminalMessageAlreadyReceived = hasMatchingLatestTerminalError(
        [
          stateBeforeStatusUpdate.currentSession,
          stateBeforeStatusUpdate.streamingSessions[sessionId],
        ],
        sessionId,
        error,
      );
      store.dispatch(updateSessionStatus({ sessionId, status: 'error' }));

      // The runtime normally sends the persisted terminal message first. The
      // error event owns status/global side effects and only supplies a message
      // fallback when that canonical message was not delivered.
      if (error.kind === CoworkErrorKind.AuthExpired) {
        window.dispatchEvent(new CustomEvent('core-rpc-auth-expired'));
      }

      if (error.message && !terminalMessageAlreadyReceived) {
        store.dispatch(
          addMessage({
            sessionId,
            message: createCoworkTerminalErrorMessage(error),
          }),
        );
      }
    });
    this.streamListenerCleanups.push(errorCleanup);

    // Sessions changed listener (new channel sessions discovered by polling,
    // or reconcileWithHistory replaced messages for a channel session)
    const sessionsChangedCleanup = cowork.onSessionsChanged(data => {
      const beforeState = store.getState().cowork;
      const changedSessionId = data?.sessionId;
      console.log(
        '[CoworkService] onSessionsChanged: received IPC event, changedSessionId:',
        changedSessionId,
        'before sessions:',
        beforeState.sessions.length,
        'sessionIds:',
        beforeState.sessions.map(s => s.id).slice(0, 5),
      );
      void Promise.all([this.loadSessions(), this.loadChatSessions()])
        .then(() => {
          const state = store.getState().cowork;
          console.log(
            '[CoworkService] onSessionsChanged: loadSessions complete, total sessions:',
            state.sessions.length,
            'sessionIds:',
            state.sessions.map(s => s.id).slice(0, 5),
          );

          const currentId = state.currentSessionId;
          if (currentId) {
            // Only reload the current session if the change affects it directly,
            // or if no specific sessionId was provided (backward compat).
            if (!changedSessionId || changedSessionId === currentId) {
              void this.loadSession(currentId);
            }
          }
        })
        .catch(err => {
          console.error('[CoworkService] onSessionsChanged: loadSessions FAILED:', err);
        });
    });
    this.streamListenerCleanups.push(sessionsChangedCleanup);
  }

  private cleanupListeners(): void {
    this.streamListenerCleanups.forEach(cleanup => cleanup());
    this.streamListenerCleanups = [];
  }

  async loadSessions(agentId?: string, workspaceId?: string): Promise<void> {
    const requestId = ++this.latestLoadSessionsRequestId;
    const effectiveWorkspaceId =
      workspaceId ?? store.getState().workspace.currentWorkspaceId ?? undefined;
    const result = await window.electron?.cowork?.listSessions({
      limit: COWORK_SESSION_PAGE_SIZE,
      offset: 0,
      agentId:
        workspaceService.isWorkspaceApiAvailable() && effectiveWorkspaceId ? undefined : agentId,
      workspaceId: workspaceService.isWorkspaceApiAvailable() ? effectiveWorkspaceId : undefined,
      mode: CoworkSessionMode.Work,
    });
    if (result?.success && result.sessions) {
      // High-frequency IM traffic can trigger overlapping list refreshes.
      // Ignore stale responses so an older snapshot does not hide newer sessions.
      if (requestId !== this.latestLoadSessionsRequestId) {
        return;
      }
      store.dispatch(setSessions(result.sessions));
      store.dispatch(setHasMoreSessions(result.hasMore ?? false));
    }
  }

  async loadChatSessions(): Promise<void> {
    const requestId = ++this.latestLoadChatSessionsRequestId;
    const result = await window.electron?.cowork?.listSessions({
      limit: COWORK_SESSION_PAGE_SIZE,
      offset: 0,
      mode: CoworkSessionMode.Chat,
    });
    if (result?.success && result.sessions && requestId === this.latestLoadChatSessionsRequestId) {
      store.dispatch(setChatSessions(result.sessions));
    }
  }

  async listSessionsForAgentPreview(
    agentId: string,
    limit: number,
    offset: number,
  ): Promise<CoworkSessionListResult> {
    const result = await window.electron?.cowork?.listSessions({ limit, offset, agentId });
    return result ?? { success: false, error: 'Cowork IPC is unavailable' };
  }

  async listSessionsForWorkspacePreview(
    workspaceId: string,
    limit: number,
    offset: number,
    sources: CoworkSessionSource[],
  ): Promise<CoworkSessionListResult> {
    const result = await window.electron?.cowork?.listSessions({
      limit,
      offset,
      workspaceId: workspaceService.isWorkspaceApiAvailable() ? workspaceId : undefined,
      mode: CoworkSessionMode.Work,
      sources,
    });
    return result ?? { success: false, error: 'Cowork IPC is unavailable' };
  }

  async listSessionsForSearch(limit: number, offset: number): Promise<CoworkSessionListResult> {
    const result = await window.electron?.cowork?.listSessions({ limit, offset });
    return result ?? { success: false, error: 'Cowork IPC is unavailable' };
  }

  async loadMoreSessions(): Promise<boolean> {
    const state = store.getState().cowork;
    if (!state.hasMoreSessions) return false;

    const offset = state.sessions.length;
    const result = await window.electron?.cowork?.listSessions({
      limit: COWORK_SESSION_PAGE_SIZE,
      offset,
      workspaceId: workspaceService.isWorkspaceApiAvailable()
        ? (store.getState().workspace.currentWorkspaceId ?? undefined)
        : undefined,
      mode: CoworkSessionMode.Work,
    });
    if (result?.success && result.sessions) {
      store.dispatch(
        appendSessions({ sessions: result.sessions, hasMore: result.hasMore ?? false }),
      );
      return true;
    }
    return false;
  }

  async loadConfig(): Promise<void> {
    const coworkResult = await window.electron?.cowork?.getConfig();

    if (coworkResult?.success && coworkResult.config) {
      store.dispatch(setConfig(coworkResult.config));
    }
  }

  async startSession(
    options: CoworkStartOptions,
  ): Promise<{ session: CoworkSession | null; error?: string }> {
    const cowork = window.electron?.cowork;
    if (!cowork) {
      console.error('Cowork API not available');
      return { session: null, error: 'Cowork API not available' };
    }

    const result = await cowork.startSession({
      ...options,
      workspaceId: workspaceService.isWorkspaceApiAvailable()
        ? (options.workspaceId ?? store.getState().workspace.currentWorkspaceId ?? undefined)
        : undefined,
    });
    if (result.success && result.session) {
      store.dispatch(addSession(result.session));
      workspaceService.promoteWorkspace(result.session.workspaceId);
      await workspaceService.refreshWorkspaces();
      return { session: result.session };
    }

    // Show a user-visible error when session start fails
    if (result.error) {
      const errorContent =
        result.code === ENGINE_NOT_READY_CODE
          ? i18nService.t('coworkErrorEngineNotReady')
          : classifyError(result.error);
      window.dispatchEvent(new CustomEvent('app:showToast', { detail: errorContent }));
    }

    console.error('Failed to start session:', result.error);
    return { session: null, error: result.error };
  }

  async continueSession(options: CoworkContinueOptions): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork) {
      console.error('Cowork API not available');
      return false;
    }

    store.dispatch(updateSessionStatus({ sessionId: options.sessionId, status: 'running' }));

    const result = await cowork.continueSession({
      sessionId: options.sessionId,
      prompt: options.prompt,
      systemPrompt: options.systemPrompt,
      activeSkillIds: options.activeSkillIds,
      goalMode: options.goalMode,
      productionLoopMode: options.productionLoopMode,
      expertIds: options.expertIds,
      permissionMode: options.permissionMode,
      imageAttachments: options.imageAttachments,
      fileAttachments: options.fileAttachments,
    });
    if (!result.success) {
      const terminalError = result.error
        ? resolveCoworkTerminalError(result.error, result.code)
        : null;
      if (result.code !== ENGINE_NOT_READY_CODE) {
        store.dispatch(updateSessionStatus({ sessionId: options.sessionId, status: 'error' }));
      }
      if (terminalError) {
        const state = store.getState().cowork;
        const alreadyReceived = hasMatchingLatestTerminalError(
          [state.currentSession, state.streamingSessions[options.sessionId]],
          options.sessionId,
          terminalError,
        );
        if (!alreadyReceived) {
          store.dispatch(
            addMessage({
              sessionId: options.sessionId,
              message: createCoworkTerminalErrorMessage(terminalError),
            }),
          );
        }
      }
      console.error('Failed to continue session:', result.error);
      return false;
    }

    if (result.session?.workspaceId) {
      workspaceService.promoteWorkspace(result.session.workspaceId);
    }
    await workspaceService.refreshWorkspaces();
    return true;
  }

  async stopSession(sessionId: string): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork) return false;

    const result = await cowork.stopSession(sessionId);
    if (result.success) {
      store.dispatch(updateSessionStatus({ sessionId, status: 'idle' }));
      return true;
    }

    console.error('Failed to stop session:', result.error);
    return false;
  }

  async saveChatSession(session: CoworkSession): Promise<CoworkSessionResult> {
    const cowork: Record<string, unknown> =
      (window.electron?.cowork as unknown as Record<string, unknown>) || {};
    const saveSession = cowork.saveSession as
      | ((s: Record<string, unknown>) => Promise<CoworkSessionResult>)
      | undefined;
    if (!saveSession) return { success: false, error: 'saveSession API unavailable' };
    return saveSession(session as unknown as Record<string, unknown>);
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork) return false;

    const result = await cowork.deleteSession(sessionId);
    if (result.success) {
      store.dispatch(deleteSessionAction(sessionId));
      const permissionModeBySession = { ...store.getState().cowork.config.permissionModeBySession };
      if (permissionModeBySession?.[sessionId]) {
        delete permissionModeBySession[sessionId];
        await this.updateConfig({ permissionModeBySession });
      }
      return true;
    }

    console.error('Failed to delete session:', result.error);
    return false;
  }

  async deleteSessions(sessionIds: string[]): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork) return false;

    const result = await cowork.deleteSessions(sessionIds);
    if (result.success) {
      store.dispatch(deleteSessionsAction(sessionIds));
      const permissionModeBySession = { ...store.getState().cowork.config.permissionModeBySession };
      let changed = false;
      for (const sessionId of sessionIds) {
        if (permissionModeBySession?.[sessionId]) {
          delete permissionModeBySession[sessionId];
          changed = true;
        }
      }
      if (changed) await this.updateConfig({ permissionModeBySession });
      return true;
    }

    console.error('Failed to batch delete sessions:', result.error);
    return false;
  }

  async setSessionPinned(
    sessionId: string,
    pinned: boolean,
  ): Promise<{ success: boolean; pinOrder: number | null }> {
    const cowork = window.electron?.cowork;
    if (!cowork?.setSessionPinned) return { success: false, pinOrder: null };

    const result = await cowork.setSessionPinned({ sessionId, pinned });
    if (result.success) {
      const pinOrder = result.pinOrder ?? null;
      store.dispatch(updateSessionPinned({ sessionId, pinned, pinOrder }));
      return { success: true, pinOrder };
    }

    console.error('Failed to update session pin:', result.error);
    return { success: false, pinOrder: null };
  }

  async renameSession(sessionId: string, title: string): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork?.renameSession) return false;

    const normalizedTitle = title.trim();
    if (!normalizedTitle) return false;

    const result = await cowork.renameSession({ sessionId, title: normalizedTitle });
    if (result.success) {
      store.dispatch(updateSessionTitle({ sessionId, title: normalizedTitle }));
      return true;
    }

    console.error('Failed to rename session:', result.error);
    return false;
  }

  async exportSessionResultImage(options: {
    rect: { x: number; y: number; width: number; height: number };
    defaultFileName?: string;
  }): Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }> {
    const cowork = window.electron?.cowork;
    if (!cowork?.exportResultImage) {
      return { success: false, error: 'Cowork export API not available' };
    }

    try {
      const result = await cowork.exportResultImage(options);
      return result ?? { success: false, error: 'Failed to export session image' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to export session image',
      };
    }
  }

  async captureSessionImageChunk(options: {
    rect: { x: number; y: number; width: number; height: number };
  }): Promise<{
    success: boolean;
    width?: number;
    height?: number;
    pngBase64?: string;
    error?: string;
  }> {
    const cowork = window.electron?.cowork;
    if (!cowork?.captureImageChunk) {
      return { success: false, error: 'Cowork capture API not available' };
    }

    try {
      const result = await cowork.captureImageChunk(options);
      return result ?? { success: false, error: 'Failed to capture session image chunk' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to capture session image chunk',
      };
    }
  }

  async saveSessionResultImage(options: {
    pngBase64: string;
    defaultFileName?: string;
  }): Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }> {
    const cowork = window.electron?.cowork;
    if (!cowork?.saveResultImage) {
      return { success: false, error: 'Cowork save image API not available' };
    }

    try {
      const result = await cowork.saveResultImage(options);
      return result ?? { success: false, error: 'Failed to save session image' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save session image',
      };
    }
  }

  async loadSession(sessionId: string): Promise<CoworkSession | null> {
    const cowork = window.electron?.cowork;
    if (!cowork) return null;
    const requestId = ++this.latestLoadSessionRequestId;

    const result = await cowork.getSession(sessionId);
    if (result.success && result.session) {
      // Keep only the latest session load result to avoid stale async overwrites.
      if (requestId !== this.latestLoadSessionRequestId) {
        return result.session;
      }
      await prepareCoworkSessionRender(result.session);
      if (requestId !== this.latestLoadSessionRequestId) {
        return result.session;
      }
      if (result.session.workspaceId) {
        const preserveSessionLoading = store.getState().cowork.loadingSessionId === sessionId;
        await workspaceService.selectWorkspace(result.session.workspaceId, {
          preserveSessionLoading,
        });
      }
      if (result.session.agentId) {
        store.dispatch(setCurrentAgentId(result.session.agentId));
      }
      const wasCurrentSession = store.getState().cowork.currentSessionId === sessionId;
      store.dispatch(setCurrentSession(result.session));
      // Only restore streaming for running sessions — never clear it here.
      // Clearing is the responsibility of complete/error stream events.
      // loadSession can be called reactively (onSessionsChanged) while a task
      // is still executing; the backend may report a transitional 'idle' status
      // that would prematurely hide the stop button.
      // Session skills describe already-sent messages. Never reattach them to
      // the next prompt when reactive session loading runs during a stream.
      // Re-edit explicitly restores a message's skills in CoworkSessionDetail.
      if (!wasCurrentSession) {
        store.dispatch(clearActiveSkills());
      }

      const imResult = await cowork.remoteManaged(sessionId);
      if (requestId === this.latestLoadSessionRequestId) {
        store.dispatch(setRemoteManaged(imResult?.remoteManaged ?? false));
      }

      return result.session;
    }

    // The session no longer exists in the backend (e.g. a stale temp-* entry
    // leaked into the sidebar). Remove it from Redux so the ghost disappears
    // instead of surfacing a load error on every click.
    store.dispatch(deleteSessionAction(sessionId));
    console.error('Failed to load session:', result.error);
    return null;
  }

  /** Load older messages for the current session (for scroll-up history). */
  async loadMoreMessages(sessionId: string): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork?.getSessionMessages) return false;

    const state = store.getState().cowork;
    if (state.currentSession?.id !== sessionId) return false;

    const currentOffset = state.currentSession.messagesOffset;
    if (currentOffset <= 0) return false;

    const newOffset = Math.max(0, currentOffset - COWORK_MESSAGE_HISTORY_PAGE_SIZE);
    const limit = currentOffset - newOffset;

    const result = await cowork.getSessionMessages({ sessionId, limit, offset: newOffset });
    if (result.success && result.messages && result.messages.length > 0) {
      store.dispatch(
        prependMessages({
          sessionId,
          messages: result.messages,
          newOffset,
        }),
      );
      return true;
    }
    return false;
  }

  async updateSessionModel(
    sessionId: string,
    modelOverride: string,
  ): Promise<CoworkSession | null> {
    const sessionApi = window.electron?.cowork?.updateSessionModel;
    if (!sessionApi) {
      console.error('Session model update API is not available');
      return null;
    }

    const result = await sessionApi({ sessionId, modelOverride });
    if (result.success && result.session) {
      const currentSessionId = store.getState().cowork.currentSessionId;
      if (currentSessionId === sessionId) {
        // Model updates return a metadata-only session snapshot. Patch just
        // the model field so the in-memory transcript, draft and streaming
        // state are not replaced while the user is switching models.
        store.dispatch(
          updateCurrentSessionModelOverride({
            sessionId,
            modelOverride: result.session.modelOverride,
          }),
        );
      }
      return result.session;
    }

    console.error('Failed to patch session:', result.error);
    return null;
  }

  async respondToPermission(requestId: string, result: CoworkPermissionResult): Promise<boolean> {
    const permission = store
      .getState()
      .cowork.pendingPermissions.find(
        (pending: CoworkPermissionRequest) => pending.requestId === requestId,
      );
    if (!permission) return false;

    const response = await respondToPermissionByOrigin(permission, result, {
      respondToPi: window.electron?.cowork?.respondToPermission,
    });
    if (response.success) {
      store.dispatch(dequeuePendingPermission({ requestId }));
      return true;
    }

    console.error('Failed to respond to permission:', response.error);
    return false;
  }

  async updateConfig(config: CoworkConfigUpdate): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork) return false;

    const currentConfig = store.getState().cowork.config;
    const result = await cowork.setConfig(config);
    if (result.success) {
      store.dispatch(setConfig({ ...currentConfig, ...config }));
      return true;
    }

    console.error('Failed to update config:', result.error);
    return false;
  }

  async getApiConfig(): Promise<CoworkApiConfig | null> {
    if (!window.electron?.getApiConfig) {
      return null;
    }
    return window.electron.getApiConfig();
  }

  async checkApiConfig(options?: {
    probeModel?: boolean;
  }): Promise<{ hasConfig: boolean; config: CoworkApiConfig | null; error?: string } | null> {
    if (!window.electron?.checkApiConfig) {
      return null;
    }
    return window.electron.checkApiConfig(options);
  }

  async saveApiConfig(
    config: CoworkApiConfig,
  ): Promise<{ success: boolean; error?: string } | null> {
    if (!window.electron?.saveApiConfig) {
      return null;
    }
    return window.electron.saveApiConfig(config);
  }

  async readBootstrapFile(filename: string): Promise<string> {
    const api = window.electron?.cowork?.readBootstrapFile;
    if (!api) return '';
    const result = await api(filename);
    if (!result?.success) {
      console.warn(`[CoworkService] readBootstrapFile: failed to read ${filename}`, result?.error);
      return '';
    }
    return result.content || '';
  }

  async writeBootstrapFile(filename: string, content: string): Promise<boolean> {
    const api = window.electron?.cowork?.writeBootstrapFile;
    if (!api) return false;
    const result = await api(filename, content);
    return Boolean(result?.success);
  }

  async generateSessionTitle(prompt: string | null): Promise<string | null> {
    if (!window.electron?.generateSessionTitle) {
      return null;
    }
    return window.electron.generateSessionTitle(prompt);
  }

  async getRecentCwds(limit?: number): Promise<string[]> {
    if (!window.electron?.getRecentCwds) {
      return [];
    }
    return window.electron.getRecentCwds(limit);
  }

  clearSession(): void {
    store.dispatch(clearCurrentSession());
  }

  destroy(): void {
    this.cleanupListeners();
    this.initialized = false;
  }
}

export const coworkService = new CoworkService();
