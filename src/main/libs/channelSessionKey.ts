import { PlatformRegistry } from '../../shared/platform';
import type { Platform } from '../im/types';

const SessionKeyPart = {
  Managed: 'zhiyuan',
} as const;

const MANAGED_SESSION_PREFIX = `${SessionKeyPart.Managed}:`;

export interface ManagedSessionKey {
  sessionId: string;
}

export function buildManagedSessionKey(sessionId: string): string {
  const normalizedSessionId = sessionId.trim();
  return `${SessionKeyPart.Managed}:${normalizedSessionId}`;
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

export function isManagedSessionKey(sessionKey: string | undefined | null): boolean {
  return parseManagedSessionKey(sessionKey) !== null;
}

export function parseChannelSessionKey(
  sessionKey: string,
): { platform: Platform; conversationId: string } | null {
  if (!sessionKey || isManagedSessionKey(sessionKey)) return null;

  const separatorIndex = sessionKey.indexOf(':');
  if (separatorIndex <= 0) return null;
  const platform = PlatformRegistry.platformOfChannel(sessionKey.slice(0, separatorIndex));
  const conversationId = sessionKey.slice(separatorIndex + 1);
  return platform && conversationId ? { platform, conversationId } : null;
}
