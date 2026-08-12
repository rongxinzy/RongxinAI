import { PlatformRegistry } from '../../shared/platform';
import type { Platform } from '../im/types';

const SessionKeyPart = {
  Agent: 'agent',
  Managed: 'zhiyuan',
} as const;

const MANAGED_SESSION_PREFIX = `${SessionKeyPart.Managed}:`;
export const DEFAULT_MANAGED_AGENT_ID = 'main';

export interface ManagedSessionKey {
  agentId: string | null;
  sessionId: string;
}

export function buildManagedSessionKey(
  sessionId: string,
  agentId = DEFAULT_MANAGED_AGENT_ID,
): string {
  const normalizedSessionId = sessionId.trim();
  const normalizedAgentId = agentId.trim() || DEFAULT_MANAGED_AGENT_ID;
  return `${SessionKeyPart.Agent}:${normalizedAgentId}:${SessionKeyPart.Managed}:${normalizedSessionId}`;
}

export function parseManagedSessionKey(
  sessionKey: string | undefined | null,
): ManagedSessionKey | null {
  const raw = (sessionKey ?? '').trim();
  if (!raw) return null;

  if (raw.startsWith(MANAGED_SESSION_PREFIX)) {
    const sessionId = raw.slice(MANAGED_SESSION_PREFIX.length).trim();
    return sessionId ? { agentId: null, sessionId } : null;
  }

  const parts = raw.split(':');
  if (parts.length < 4 || parts[0] !== SessionKeyPart.Agent || parts[2] !== SessionKeyPart.Managed) {
    return null;
  }

  const agentId = parts[1]?.trim();
  const sessionId = parts.slice(3).join(':').trim();
  return agentId && sessionId ? { agentId, sessionId } : null;
}

export function isManagedSessionKey(sessionKey: string | undefined | null): boolean {
  return parseManagedSessionKey(sessionKey) !== null;
}

export function parseChannelSessionKey(
  sessionKey: string,
): { platform: Platform; conversationId: string } | null {
  if (!sessionKey || isManagedSessionKey(sessionKey)) return null;

  if (sessionKey.startsWith(`${SessionKeyPart.Agent}:`)) {
    const jsonIndex = sessionKey.indexOf(':{');
    if (jsonIndex > 0) {
      try {
        const context = JSON.parse(sessionKey.slice(jsonIndex + 1));
        if (context && typeof context.channel === 'string') {
          const platform = PlatformRegistry.platformOfChannel(context.channel);
          const conversationId = context.peerid || context.conversationId || context.accountid || null;
          if (platform && typeof conversationId === 'string' && conversationId) {
            return { platform, conversationId };
          }
        }
      } catch {
        // Colon-delimited channel keys are handled below.
      }
    }

    const parts = sessionKey.split(':');
    if (parts.length < 4) return null;
    const directPlatform = PlatformRegistry.platformOfChannel(parts[2]);
    if (directPlatform) {
      const conversationId = parts.slice(3).join(':');
      return conversationId ? { platform: directPlatform, conversationId } : null;
    }
    if (parts.length >= 5) {
      const nestedPlatform = PlatformRegistry.platformOfChannel(parts[3]);
      const conversationId = parts.slice(4).join(':');
      if (nestedPlatform && conversationId) return { platform: nestedPlatform, conversationId };
    }
    return null;
  }

  const separatorIndex = sessionKey.indexOf(':');
  if (separatorIndex <= 0) return null;
  const platform = PlatformRegistry.platformOfChannel(sessionKey.slice(0, separatorIndex));
  const conversationId = sessionKey.slice(separatorIndex + 1);
  return platform && conversationId ? { platform, conversationId } : null;
}
