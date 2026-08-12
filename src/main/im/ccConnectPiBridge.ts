import type { CoworkStore } from "../coworkStore";
import type { PiRuntimeAdapter } from "../libs/agentEngine";
import type {
  CcConnectCronTrigger,
  CcConnectTurnRequest,
} from "../libs/ccConnectBridgeServer";
import { IMCoworkHandler } from "./imCoworkHandler";
import type { ChannelTurnCoordinator } from './channelTurnCoordinator';
import type { IMStore } from "./imStore";
import type { IMScheduledTaskRequestDetector, IMScheduledTaskCreationResult, ParsedIMScheduledTaskRequest } from "./imScheduledTaskHandler";
import type { IMMessage, Platform } from "./types";

const SUPPORTED_PLATFORMS = new Set<string>([
  "telegram",
  "discord",
  "dingtalk",
  "feishu",
  "qq",
  "qqbot",
  "wecom",
  "weixin",
]);

export class CcConnectPiBridge {
  private readonly handler: IMCoworkHandler;
  private readonly imStore: IMStore;

  constructor(options: {
    runtime: PiRuntimeAdapter;
    coworkStore: CoworkStore;
    imStore: IMStore;
    getSkillsPrompt: () => Promise<string | null>;
    onCronTrigger: (trigger: CcConnectCronTrigger) => Promise<void>;
    detectScheduledTaskRequest?: IMScheduledTaskRequestDetector;
    createScheduledTask?: (input: { sessionId: string; message: IMMessage; request: ParsedIMScheduledTaskRequest }) => Promise<IMScheduledTaskCreationResult>;
    turnCoordinator: ChannelTurnCoordinator;
  }) {
    this.onCronTrigger = options.onCronTrigger;
    this.imStore = options.imStore;
    this.turnCoordinator = options.turnCoordinator;
    this.handler = new IMCoworkHandler({
      coworkRuntime: options.runtime,
      coworkStore: options.coworkStore,
      imStore: options.imStore,
      getSkillsPrompt: options.getSkillsPrompt,
      detectScheduledTaskRequest: options.detectScheduledTaskRequest,
      createScheduledTask: options.createScheduledTask,
    });
  }

  private readonly onCronTrigger: (
    trigger: CcConnectCronTrigger,
  ) => Promise<void>;
  private readonly turnCoordinator: ChannelTurnCoordinator;

  async runTurn(
    request: CcConnectTurnRequest,
    signal?: AbortSignal,
  ): Promise<{ content: string }> {
    if (!SUPPORTED_PLATFORMS.has(request.message.platform)) {
      throw new Error(
        `Unsupported cc-connect platform: ${request.message.platform}`,
      );
    }
    const platform = request.message.platform === 'qqbot' ? 'qq' : request.message.platform as Platform;
    const nativeConversationId = resolveNativeConversationId(request.message);
    const conversationId = getCcConnectScopedConversationId(
      request.accountId,
      nativeConversationId,
    );
    this.imStore.setCcConnectSessionKey(
      request.accountId,
      request.message.platform,
      nativeConversationId,
      request.message.sessionKey,
    );
    const message: IMMessage = {
      platform,
      messageId: request.message.messageId,
      // Scope the persisted Pi session by the stable ChannelAccount id so two bots in the same
      // platform conversation can never resume one another's session.
      conversationId,
      senderId: request.message.userId,
      senderName: request.message.userName,
      groupName: request.message.chatName,
      content: request.message.content,
      chatType:
        nativeConversationId === request.message.userId
          ? "direct"
          : "group",
      timestamp: request.message.userMessageTimeMs ?? Date.now(),
    };
    const content = await this.turnCoordinator.run({
      platform: request.message.platform,
      accountId: request.accountId,
      conversationId: nativeConversationId,
      messageId: request.message.messageId,
      payload: JSON.stringify(request),
    }, () => this.handler.processMessage(
      message,
      signal,
      this.imStore.getChannelAccountWorkspaceId(request.accountId) ?? undefined,
    ), signal);
    return { content };
  }

  async runCronTrigger(trigger: CcConnectCronTrigger): Promise<void> {
    await this.onCronTrigger(trigger);
  }
}

function resolveNativeConversationId(message: CcConnectTurnRequest['message']): string {
  const explicit = message.channelId?.trim();
  if (explicit) return explicit;
  const parts = message.sessionKey.split(':').map(part => part.trim()).filter(Boolean);
  if (parts.length < 2) throw new Error('cc-connect channel conversation is required');
  if (message.platform === 'dingtalk' && parts.length >= 3 && ['d', 'g'].includes(parts[1])) {
    return parts[2];
  }
  return parts[1];
}

/** Stable, unambiguous storage key for a cc-connect account conversation. */
export function getCcConnectScopedConversationId(
  accountId: string,
  conversationId: string,
): string {
  const account = accountId.trim();
  const conversation = conversationId.trim();
  if (!account || !conversation) {
    throw new Error('cc-connect accountId and conversationId are required');
  }
  return `cc-connect:${Buffer.from(JSON.stringify([account, conversation])).toString('base64url')}`;
}

/** Recover the account and native conversation only from our own scoped key. */
export function parseCcConnectScopedConversationId(value: string): [string, string] {
  if (!value.startsWith('cc-connect:')) throw new Error('invalid cc-connect conversation id');
  try {
    const decoded = JSON.parse(Buffer.from(value.slice('cc-connect:'.length), 'base64url').toString('utf8'));
    if (!Array.isArray(decoded) || decoded.length !== 2 || decoded.some(item => typeof item !== 'string' || !item.trim())) {
      throw new Error('invalid cc-connect conversation id');
    }
    return [decoded[0], decoded[1]];
  } catch {
    throw new Error('invalid cc-connect conversation id');
  }
}
