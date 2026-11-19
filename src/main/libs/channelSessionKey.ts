const SessionKeyPart = {
  Managed: 'zhiyuan',
} as const;

const MANAGED_SESSION_PREFIX = `${SessionKeyPart.Managed}:`;

export interface ManagedSessionKey {
  sessionId: string;
}

export function parseManagedSessionKey(
  sessionKey: string | undefined | null,
): ManagedSessionKey | null {
  const raw = (sessionKey ?? '').trim();
  if (!raw) return null;

  if (!raw.startsWith(MANAGED_SESSION_PREFIX)) return null;
  const sessionId = raw.slice(MANAGED_SESSION_PREFIX.length).trim();
  return sessionId ? { sessionId } : null;
}
