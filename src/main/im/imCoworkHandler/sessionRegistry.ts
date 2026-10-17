/**
 * Cowork session registry for IM conversations: mapping lifecycle, lazy
 * session tracking, legacy title normalization, and session creation.
 */

import { CoworkExecutionMode, CoworkSessionSource } from '../../../shared/cowork/constants';
import type { Platform } from '../../../shared/platform';
import type { CoworkStore } from '../../coworkStore';
import type { PiRuntime } from '../../libs/agentEngine/types';
import { t } from '../../i18n';
import type { IMStore } from '../imStore';
import type { IMSessionMapping } from '../types';

const IM_SESSION_TITLE_PLATFORM_KEY = {
  weixin: 'channelPrefixWeixin',
  dingtalk: 'channelPrefixDingtalk',
  feishu: 'channelPrefixFeishu',
  wecom: 'channelPrefixWecom',
  qq: 'channelPrefixQq',
  telegram: 'channelPrefixTelegram',
  discord: 'channelPrefixDiscord',
} as const satisfies Record<Platform, string>;

/** IM routing identities never become user-visible session titles. */
function buildIMSessionTitle(platform: Platform): string {
  const platformName = t(IM_SESSION_TITLE_PLATFORM_KEY[platform]);
  return t('channelConversationFallback', { channel: platformName });
}

interface IMConversationRef {
  conversationId: string;
  platform: Platform;
}

interface IMCoworkSessionRegistryDeps {
  coworkRuntime: PiRuntime;
  coworkStore: CoworkStore;
  imStore: IMStore;
  buildSystemPrompt: () => Promise<string>;
  /** Invoked when a mapped cowork session is discarded, so pending permissions can be cleared. */
  onSessionInvalidated: (coworkSessionId: string) => void;
}

export class IMCoworkSessionRegistry {
  private readonly deps: IMCoworkSessionRegistryDeps;

  // Track which sessions are created by IM (to filter events)
  private readonly imSessionIds = new Set<string>();
  private readonly sessionConversationMap = new Map<string, IMConversationRef>();

  constructor(deps: IMCoworkSessionRegistryDeps) {
    this.deps = deps;
    this.initializeMappedSessions();
  }

  private initializeMappedSessions(): void {
    for (const mapping of this.deps.imStore.listSessionMappings()) {
      const session = this.deps.coworkStore.getSession(mapping.coworkSessionId);
      if (!session) {
        continue;
      }
      this.migrateLegacySessionTitle(
        session.id,
        session.title,
        mapping.platform,
        session.titleUserRenamed,
      );
      this.trackSessionMapping(mapping);
    }
  }

  private migrateLegacySessionTitle(
    sessionId: string,
    title: string,
    platform: Platform,
    titleUserRenamed: boolean,
  ): void {
    if (titleUserRenamed) return;
    const platformName = t(IM_SESSION_TITLE_PLATFORM_KEY[platform]);
    const defaultTitle = t('channelConversationFallback', { channel: platformName });
    if (title === defaultTitle) return;

    this.deps.coworkStore.updateSession(
      sessionId,
      { title: defaultTitle },
      { touchUpdatedAt: false },
    );
  }

  private trackSessionMapping(mapping: IMSessionMapping): void {
    this.imSessionIds.add(mapping.coworkSessionId);
    this.sessionConversationMap.set(mapping.coworkSessionId, {
      conversationId: mapping.imConversationId,
      platform: mapping.platform,
    });
  }

  ensureTrackedSession(sessionId: string): boolean {
    if (this.imSessionIds.has(sessionId)) {
      return true;
    }

    const mapping = this.deps.imStore.getSessionMappingByCoworkSessionId(sessionId);
    if (!mapping) {
      return false;
    }

    this.trackSessionMapping(mapping);
    return true;
  }

  setConversation(sessionId: string, conversation: IMConversationRef): void {
    this.sessionConversationMap.set(sessionId, conversation);
  }

  getConversation(sessionId: string): IMConversationRef | undefined {
    return this.sessionConversationMap.get(sessionId);
  }

  forgetSession(coworkSessionId: string): void {
    this.imSessionIds.delete(coworkSessionId);
    this.sessionConversationMap.delete(coworkSessionId);
  }

  clear(): void {
    this.imSessionIds.clear();
    this.sessionConversationMap.clear();
  }

  /**
   * Get or create a Cowork session for an IM conversation
   */
  async getOrCreateSession(
    imConversationId: string,
    platform: Platform,
    forceNewSession: boolean = false,
    workspaceId?: string,
  ): Promise<string> {
    if (forceNewSession) {
      const stale = this.deps.imStore.getSessionMapping(imConversationId, platform);
      if (stale) {
        this.deps.imStore.deleteSessionMapping(imConversationId, platform);
        this.forgetSession(stale.coworkSessionId);
        this.deps.onSessionInvalidated(stale.coworkSessionId);
        this.deps.coworkRuntime.stopSession(stale.coworkSessionId);
      }
    }

    // Check existing mapping
    const existing = forceNewSession
      ? null
      : this.deps.imStore.getSessionMapping(imConversationId, platform);
    if (existing) {
      const session = this.deps.coworkStore.getSession(existing.coworkSessionId);
      if (!session) {
        console.warn(
          `[IMCoworkHandler] Found stale mapping for ${platform}:${imConversationId}, session ${existing.coworkSessionId} is missing`,
        );
        this.deps.imStore.deleteSessionMapping(imConversationId, platform);
        this.forgetSession(existing.coworkSessionId);
        this.deps.onSessionInvalidated(existing.coworkSessionId);
        this.deps.coworkRuntime.stopSession(existing.coworkSessionId);
      } else {
        this.deps.imStore.updateSessionLastActive(imConversationId, platform);
        this.trackSessionMapping(existing);
        return existing.coworkSessionId;
      }
    }

    // Create new Cowork session
    return this.createSessionForConversation(imConversationId, platform, workspaceId);
  }

  private async createSessionForConversation(
    imConversationId: string,
    platform: Platform,
    workspaceId?: string,
  ): Promise<string> {
    // Create new Cowork session
    const config = this.deps.coworkStore.getConfig();
    const title = buildIMSessionTitle(platform);
    const systemPrompt = await this.deps.buildSystemPrompt();
    const workspace = workspaceId ? this.deps.coworkStore.getWorkspace(workspaceId) : null;
    if (!workspace) throw new Error('Channel account workspace is not configured');

    const session = this.deps.coworkStore.createSession(
      title,
      workspace.path,
      systemPrompt,
      config.executionMode || CoworkExecutionMode.Local,
      [],
      'main',
      '',
      'work',
      undefined,
      workspace.id,
      undefined,
      CoworkSessionSource.Im,
    );

    // Save mapping
    const mapping = this.deps.imStore.createSessionMapping(imConversationId, platform, session.id);
    this.trackSessionMapping(mapping);

    return session.id;
  }
}
