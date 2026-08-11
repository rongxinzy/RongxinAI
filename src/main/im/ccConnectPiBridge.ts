import type { CoworkStore } from "../coworkStore";
import type { PiRuntimeAdapter } from "../libs/agentEngine";
import type {
  CcConnectCronTrigger,
  CcConnectTurnRequest,
} from "../libs/ccConnectBridgeServer";
import { IMCoworkHandler } from "./imCoworkHandler";
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
  }) {
    this.onCronTrigger = options.onCronTrigger;
    this.imStore = options.imStore;
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

  async runTurn(request: CcConnectTurnRequest): Promise<{ content: string }> {
    if (!SUPPORTED_PLATFORMS.has(request.message.platform)) {
      throw new Error(
        `Unsupported cc-connect platform: ${request.message.platform}`,
      );
    }
    const platform = request.message.platform === 'qqbot' ? 'qq' : request.message.platform as Platform;
    const conversationId = getCcConnectScopedConversationId(
      request.project,
      request.message.channelId,
    );
    this.imStore.setCcConnectSessionKey(
      request.project,
      request.message.platform,
      request.message.channelId,
      request.message.sessionKey,
    );
    const message: IMMessage = {
      platform,
      messageId: request.message.messageId,
      // cc-connect project names are generated from the stable ChannelAccount
      // id. Scope the persisted Pi session by that id so two bots in the same
      // platform conversation can never resume one another's session.
      conversationId,
      senderId: request.message.userId,
      senderName: request.message.userName,
      groupName: request.message.chatName,
      content: request.message.content,
      chatType:
        request.message.channelId === request.message.userId
          ? "direct"
          : "group",
      timestamp: request.message.userMessageTimeMs ?? Date.now(),
    };
    return { content: await this.handler.processMessage(message) };
  }

  async runCronTrigger(trigger: CcConnectCronTrigger): Promise<void> {
    await this.onCronTrigger(trigger);
  }
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
