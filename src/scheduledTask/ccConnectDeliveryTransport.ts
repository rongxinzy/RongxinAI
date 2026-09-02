import type { IMStore } from "../main/im/imStore";
import { tryParseCcConnectScopedConversationId } from "../main/im/ccConnectConversationId";

import type { CcConnectDeliveryClient } from "./ccConnectDeliveryClient";
import type { SchedulerDeliveryTransport } from "./deliveryDispatcher";

type DeliveryClient = Pick<CcConnectDeliveryClient, "send">;

/**
 * Routes an already-persisted Delivery through the sidecar that owns its
 * ChannelAccount. The native session key is learned from an inbound cc-connect
 * turn; it is never inferred from the display conversation id.
 */
export class CcConnectDeliveryTransport implements SchedulerDeliveryTransport {
  private readonly clients = new Map<string, DeliveryClient>();

  constructor(
    private readonly imStore: Pick<IMStore, "getCcConnectSessionKey" | "listSessionMappings">,
  ) {}

  attach(accountId: string, client: DeliveryClient): void {
    this.clients.set(requireValue("accountId", accountId), client);
  }

  detach(accountId: string): void {
    this.clients.delete(accountId.trim());
  }

  async send(
    input: Parameters<SchedulerDeliveryTransport["send"]>[0],
  ): Promise<{ receiptId?: string | null }> {
    const platform = normalizePlatform(
      requireValue("delivery channel", input.task.delivery.channel),
    );
    const conversationId = requireValue(
      "delivery destination",
      input.task.delivery.to,
    );
    const accountId = this.resolveAccountId(platform, conversationId, input.task.delivery.accountId);
    const client = this.clients.get(accountId);
    if (!client)
      throw new Error(
        `cc-connect delivery sidecar is unavailable for account ${accountId}`,
      );
    const sessionKey = this.imStore.getCcConnectSessionKey(
      accountId,
      platform,
      conversationId,
    );
    if (!sessionKey) {
      throw new Error(
        `cc-connect delivery route is unknown for ${platform}:${conversationId}`,
      );
    }
    await client.send({ accountId, platform, sessionKey, content: input.content });
    return {};
  }

  private resolveAccountId(platform: string, conversationId: string, configuredAccountId?: string): string {
    const configured = configuredAccountId?.trim();
    if (configured) return configured;

    // Legacy tasks may not have persisted accountId. Recover it from the
    // scoped session mapping created when the channel first received a message.
    const candidates = this.imStore
      .listSessionMappings()
      .filter(mapping => normalizePlatform(mapping.platform) === platform)
      .map(mapping => tryParseCcConnectScopedConversationId(mapping.imConversationId))
      .filter((parsed): parsed is [string, string] => parsed !== null)
      .filter(([, nativeConversationId]) => nativeConversationId === conversationId)
      .map(([accountId]) => accountId)
      .filter(accountId => this.clients.has(accountId));
    const uniqueCandidates = [...new Set(candidates)];
    if (uniqueCandidates.length === 0) {
      throw new Error(`Scheduled task delivery accountId is required for ${platform}:${conversationId}`);
    }
    if (uniqueCandidates.length > 1) {
      throw new Error(
        `Scheduled task delivery accountId is ambiguous for ${platform}:${conversationId}`,
      );
    }
    return uniqueCandidates[0];
  }
}

function requireValue(name: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Scheduled task ${name} is required`);
  return normalized;
}

function normalizePlatform(platform: string): string {
  if (platform === "qq") return "qqbot";
  if (platform === "lark") return "feishu";
  return platform;
}
