import type { CoworkStore } from "../coworkStore";
import type { PiRuntimeAdapter } from "../libs/agentEngine";
import type {
  CcConnectCronTrigger,
  CcConnectTurnRequest,
} from "../libs/ccConnectBridgeServer";
import { IMCoworkHandler } from "./imCoworkHandler";
import type { IMStore } from "./imStore";
import type { IMMessage, Platform } from "./types";

const SUPPORTED_PLATFORMS = new Set<Platform>([
  "telegram",
  "discord",
  "dingtalk",
  "feishu",
  "qq",
  "wecom",
  "weixin",
]);

export class CcConnectPiBridge {
  private readonly handler: IMCoworkHandler;

  constructor(options: {
    runtime: PiRuntimeAdapter;
    coworkStore: CoworkStore;
    imStore: IMStore;
    getSkillsPrompt: () => Promise<string | null>;
    onCronTrigger: (trigger: CcConnectCronTrigger) => Promise<void>;
  }) {
    this.onCronTrigger = options.onCronTrigger;
    this.handler = new IMCoworkHandler({
      coworkRuntime: options.runtime,
      coworkStore: options.coworkStore,
      imStore: options.imStore,
      getSkillsPrompt: options.getSkillsPrompt,
    });
  }

  private readonly onCronTrigger: (
    trigger: CcConnectCronTrigger,
  ) => Promise<void>;

  async runTurn(request: CcConnectTurnRequest): Promise<{ content: string }> {
    if (!SUPPORTED_PLATFORMS.has(request.message.platform as Platform)) {
      throw new Error(
        `Unsupported cc-connect platform: ${request.message.platform}`,
      );
    }
    const message: IMMessage = {
      platform: request.message.platform as Platform,
      messageId: request.message.messageId,
      conversationId: request.message.channelId,
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
