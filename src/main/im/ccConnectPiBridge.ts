import type { CoworkStore } from '../coworkStore';
import type { PiRuntimeAdapter } from '../libs/agentEngine';
import type {
  CcConnectCronTrigger,
  CcConnectTurnRequest,
  CcConnectTurnResponse,
} from '../libs/ccConnectBridgeServer';
import { getCcConnectScopedConversationId } from './ccConnectConversationId';
import { buildCcConnectTurnResponse, persistCcConnectMedia } from './ccConnectMedia';
import { IMCoworkHandler } from './imCoworkHandler';
import type { ActivityService } from '../activity/activityService';
import type { ChannelTurnCoordinator } from './channelTurnCoordinator';
import type { IMStore } from './imStore';
import type {
  IMScheduledTaskRequestDetector,
  IMScheduledTaskCreationResult,
  ParsedIMScheduledTaskRequest,
} from './imScheduledTaskHandler';
import type { IMMessage, Platform } from './types';

const PLATFORM_MAPPING = {
  telegram: 'telegram',
  discord: 'discord',
  dingtalk: 'dingtalk',
  feishu: 'feishu',
  lark: 'feishu',
  qq: 'qq',
  qqbot: 'qq',
  wecom: 'wecom',
  weixin: 'weixin',
} as const satisfies Readonly<Record<string, Platform>>;

export function normalizeCcConnectPlatform(platform: string): Platform | null {
  return PLATFORM_MAPPING[platform as keyof typeof PLATFORM_MAPPING] ?? null;
}

export class CcConnectPiBridge {
  private readonly handler: IMCoworkHandler;
  private readonly imStore: IMStore;
  private readonly coworkStore: CoworkStore;

  constructor(options: {
    runtime: PiRuntimeAdapter;
    coworkStore: CoworkStore;
    imStore: IMStore;
    getSkillsPrompt: () => Promise<string | null>;
    onCronTrigger: (trigger: CcConnectCronTrigger) => Promise<void>;
    detectScheduledTaskRequest?: IMScheduledTaskRequestDetector;
    createScheduledTask?: (input: {
      sessionId: string;
      message: IMMessage;
      request: ParsedIMScheduledTaskRequest;
    }) => Promise<IMScheduledTaskCreationResult>;
    turnCoordinator: ChannelTurnCoordinator;
    activityService: ActivityService;
  }) {
    this.onCronTrigger = options.onCronTrigger;
    this.imStore = options.imStore;
    this.coworkStore = options.coworkStore;
    this.turnCoordinator = options.turnCoordinator;
    this.handler = new IMCoworkHandler({
      coworkRuntime: options.runtime,
      coworkStore: options.coworkStore,
      imStore: options.imStore,
      getSkillsPrompt: options.getSkillsPrompt,
      detectScheduledTaskRequest: options.detectScheduledTaskRequest,
      createScheduledTask: options.createScheduledTask,
      activityService: options.activityService,
    });
  }

  private readonly onCronTrigger: (trigger: CcConnectCronTrigger) => Promise<void>;
  private readonly turnCoordinator: ChannelTurnCoordinator;

  async runTurn(
    request: CcConnectTurnRequest,
    signal?: AbortSignal,
  ): Promise<CcConnectTurnResponse> {
    const platform = normalizeCcConnectPlatform(request.message.platform);
    if (!platform) {
      throw new Error(`Unsupported cc-connect platform: ${request.message.platform}`);
    }
    const nativeConversationId = resolveNativeConversationId(request.message);
    const conversationId = getCcConnectScopedConversationId(
      request.accountId,
      nativeConversationId,
    );
    this.imStore.setCcConnectSessionKey(
      request.accountId,
      platform,
      nativeConversationId,
      request.message.sessionKey,
    );
    const workspaceId = this.imStore.getChannelAccountWorkspaceId(request.accountId);
    const workspace = workspaceId ? this.coworkStore.getWorkspace(workspaceId) : null;
    if (!workspace) throw new Error('Channel account workspace is not configured');
    const attachments = await persistCcConnectMedia({
      workspacePath: workspace.path,
      accountId: request.accountId,
      messageId: request.message.messageId,
      images: request.message.images,
      files: request.message.files,
      audio: request.message.audio,
    });
    const message: IMMessage = {
      platform,
      messageId: request.message.messageId,
      // Scope the persisted Pi session by the stable ChannelAccount id so two bots in the same
      // platform conversation can never resume one another's session.
      conversationId,
      senderId: request.message.userId,
      senderName: request.message.userName,
      groupName: request.message.chatName,
      content: mergeMessageContent(request.message.extraContent, request.message.content),
      chatType: request.message.chatType,
      timestamp: request.message.userMessageTimeMs ?? Date.now(),
      ...(attachments.length > 0 ? { attachments } : {}),
    };
    const content = await this.turnCoordinator.run(
      {
        platform: request.message.platform,
        accountId: request.accountId,
        conversationId: nativeConversationId,
        messageId: request.message.messageId,
        payload: JSON.stringify(request),
      },
      () => this.handler.processMessage(message, signal, workspaceId ?? undefined),
      signal,
    );
    return buildCcConnectTurnResponse(content);
  }

  async runCronTrigger(trigger: CcConnectCronTrigger): Promise<void> {
    await this.onCronTrigger(trigger);
  }
}

function mergeMessageContent(extraContent: string | undefined, content: string): string {
  return [extraContent?.trim(), content.trim()].filter(Boolean).join('\n');
}

function resolveNativeConversationId(message: CcConnectTurnRequest['message']): string {
  const explicit = message.channelId?.trim();
  if (explicit) return explicit;
  const parts = message.sessionKey
    .split(':')
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.length < 2) throw new Error('cc-connect channel conversation is required');
  if (message.platform === 'dingtalk' && parts.length >= 3 && ['d', 'g'].includes(parts[1])) {
    return parts[2];
  }
  return parts[1];
}

export {
  getCcConnectScopedConversationId,
  parseCcConnectScopedConversationId,
} from './ccConnectConversationId';
