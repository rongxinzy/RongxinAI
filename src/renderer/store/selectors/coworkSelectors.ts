import { createSelector } from '@reduxjs/toolkit';

import type { RootState } from '../index';

// --- Primitive (identity) selectors ---
// These return stable references for primitive values or existing object refs,
// so useSelector's default === check is enough to skip re-renders.

export const selectCoworkSessions = (state: RootState) => state.cowork.sessions;
export const selectChatSessions = (state: RootState) => state.cowork.chatSessions;
export const selectChatSessionsLoaded = (state: RootState) => state.cowork.chatSessionsLoaded;
export const selectCurrentSessionId = (state: RootState) => state.cowork.currentSessionId;
export const selectCurrentSession = (state: RootState) => state.cowork.currentSession;
export const selectLoadingSessionId = (state: RootState) => state.cowork.loadingSessionId;
export const selectStreamingSessionIds = (state: RootState) =>
  state.cowork.streamingSessionIds;
export const selectToolActivitiesBySession = (state: RootState) =>
  state.cowork.toolActivitiesBySession;

export const selectIsStreaming = (state: RootState) => {
  const session = state.cowork.currentSession;
  if (!session) return false;
  return state.cowork.streamingSessionIds.includes(session.id);
};
export const selectIsCoworkActive = (state: RootState) => state.cowork.isCoworkActive;
export const selectRemoteManaged = (state: RootState) => state.cowork.remoteManaged;
export const selectCoworkConfig = (state: RootState) => state.cowork.config;
export const selectDraftPrompts = (state: RootState) => state.cowork.draftPrompts;
export const selectPendingPermissions = (state: RootState) => state.cowork.pendingPermissions;
export const selectPendingPermissionForSession = (state: RootState, sessionId: string | null) => {
  if (!sessionId) return null;
  return state.cowork.pendingPermissions.find(permission => permission.sessionId === sessionId) ?? null;
};
export const selectHasPendingPermissionForSession = (state: RootState, sessionId: string) =>
  selectPendingPermissionForSession(state, sessionId) !== null;
export const selectUnreadSessionIds = (state: RootState) => state.cowork.unreadSessionIds;

// --- Derived (memoized) selectors ---
// These compute new values from the store and use createSelector to avoid
// returning new object references when the inputs haven't changed.

export const resolveDisplayedSessionId = (
  currentSessionId: string | null,
  loadingSessionId: string | null,
): string | null => loadingSessionId ?? currentSessionId;

export const selectDisplayedSessionId = createSelector(
  selectCurrentSessionId,
  selectLoadingSessionId,
  resolveDisplayedSessionId,
);

export const selectCurrentMessages = createSelector(
  selectCurrentSession,
  session => session?.messages ?? null,
);

export const selectCurrentMessagesLength = createSelector(
  selectCurrentMessages,
  messages => messages?.length ?? 0,
);

export const selectCurrentToolActivities = createSelector(
  selectCurrentSessionId,
  selectToolActivitiesBySession,
  (sessionId, activitiesBySession) => {
    if (!sessionId) return [];
    return Object.values(activitiesBySession[sessionId] ?? {}).sort(
      (left, right) => left.updatedAt - right.updatedAt,
    );
  },
);

export const selectLastMessageContent = createSelector(selectCurrentMessages, messages => {
  if (!messages || messages.length === 0) return undefined;
  return messages[messages.length - 1]?.content;
});

export const selectFirstPendingPermission = createSelector(
  selectPendingPermissions,
  permissions => permissions[0] ?? null,
);
