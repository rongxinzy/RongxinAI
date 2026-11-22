/**
 * Cowork session registry for IM conversations: persisted mappings,
 * legacy title normalization, and session creation.
 */

import { CoworkExecutionMode, CoworkSessionSource } from '../../../shared/cowork/constants';
import type { Platform } from '../../../shared/platform';
import type { CoworkStore } from '../../coworkStore';
import type { PiRuntime } from '../../libs/agentEngine/types';
import { t } from '../../i18n';
import type { IMStore } from '../imStore';

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

  constructor(deps: IMCoworkSessionRegistryDeps) {
    this.deps = deps;
    this.initializeMappedSessions();
  }

  private initializeMappedSessions(): void {
    for (const mapping of this.deps.imStore.listSessionMappings()) {
      const session = this.deps.coworkStore.getSession(mapping.coworkSessionId, 0, {
        includeArtifacts: false,
      });
      if (!session) {
        continue;
      }
      this.migrateLegacySessionTitle(
        session.id,
        session.title,
        mapping.platform,
        session.titleUserRenamed,
      );
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

  getConversation(sessionId: string): IMConversationRef | undefined {
    const mapping = this.deps.imStore.getSessionMappingByCoworkSessionId(sessionId);
    return mapping
      ? { conversationId: mapping.imConversationId, platform: mapping.platform }
      : undefined;
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
        this.deps.onSessionInvalidated(stale.coworkSessionId);
        this.deps.coworkRuntime.stopSession(stale.coworkSessionId);
      }
    }

    // Check existing mapping
    const existing = forceNewSession
      ? null
      : this.deps.imStore.getSessionMapping(imConversationId, platform);
    if (existing) {
      const session = this.deps.coworkStore.getSession(existing.coworkSessionId, 0, {
        includeArtifacts: false,
      });
      if (!session) {
        console.warn(
          `[IMCoworkHandler] Found stale mapping for ${platform}:${imConversationId}, session ${existing.coworkSessionId} is missing`,
        );
        this.deps.imStore.deleteSessionMapping(imConversationId, platform);
        this.deps.onSessionInvalidated(existing.coworkSessionId);
        this.deps.coworkRuntime.stopSession(existing.coworkSessionId);
      } else {
        this.deps.imStore.updateSessionLastActive(imConversationId, platform);
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
    const workspace = workspaceId
      ? this.deps.coworkStore.workspaces.getWorkspace(workspaceId)
      : null;
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
    this.deps.imStore.createSessionMapping(imConversationId, platform, session.id);

    return session.id;
  }
}
