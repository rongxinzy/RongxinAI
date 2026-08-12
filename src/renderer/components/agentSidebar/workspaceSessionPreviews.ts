import type { CoworkSessionSummary } from '../../types/cowork';

export type WorkspaceSessionPreviews = Record<string, CoworkSessionSummary[]>;

export const mergeSessionSummaries = (
  current: CoworkSessionSummary[],
  incoming: CoworkSessionSummary[],
): CoworkSessionSummary[] => {
  const byId = new Map(current.map(session => [session.id, session]));
  incoming.forEach(session => byId.set(session.id, session));
  return [...byId.values()];
};

export const mergeSessionsIntoWorkspacePreviews = (
  current: WorkspaceSessionPreviews,
  incoming: CoworkSessionSummary[],
): WorkspaceSessionPreviews => {
  const sessionsByWorkspace = new Map<string, CoworkSessionSummary[]>();

  for (const session of incoming) {
    if (!session.workspaceId) continue;
    // Temporary sessions (`temp-*`) are frontend-only UI identities that never
    // exist in the backend. They must never enter the workspace tree — the
    // tree only shows real sessions, and a temp entry would flash in as a
    // ghost running session until the real session replaces it.
    if (session.id.startsWith('temp-')) continue;
    const workspaceSessions = sessionsByWorkspace.get(session.workspaceId) ?? [];
    workspaceSessions.push(session);
    sessionsByWorkspace.set(session.workspaceId, workspaceSessions);
  }

  if (sessionsByWorkspace.size === 0) return current;

  const next = { ...current };
  sessionsByWorkspace.forEach((sessions, workspaceId) => {
    next[workspaceId] = mergeSessionSummaries(
      // Temporary sessions (`temp-*`) are frontend-only UI identities that
      // never exist in the backend. Drop every temp entry from the preview —
      // both stale ones leaked by an older build and any that briefly enter
      // the Redux list while a new session is starting. Backend-loaded real
      // sessions are preserved.
      (current[workspaceId] ?? []).filter(
        session => session.workspaceId === workspaceId && !session.id.startsWith('temp-'),
      ),
      sessions,
    );
  });
  return next;
};

export const isSessionOwnedByWorkspace = (
  session: CoworkSessionSummary,
  workspaceId: string,
): boolean => session.workspaceId === workspaceId;
