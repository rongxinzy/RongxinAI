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
    const workspaceSessions = sessionsByWorkspace.get(session.workspaceId) ?? [];
    workspaceSessions.push(session);
    sessionsByWorkspace.set(session.workspaceId, workspaceSessions);
  }

  if (sessionsByWorkspace.size === 0) return current;

  const next = { ...current };
  sessionsByWorkspace.forEach((sessions, workspaceId) => {
    next[workspaceId] = mergeSessionSummaries(
      (current[workspaceId] ?? []).filter(session => session.workspaceId === workspaceId),
      sessions,
    );
  });
  return next;
};

export const isSessionOwnedByWorkspace = (
  session: CoworkSessionSummary,
  workspaceId: string,
): boolean => session.workspaceId === workspaceId;
