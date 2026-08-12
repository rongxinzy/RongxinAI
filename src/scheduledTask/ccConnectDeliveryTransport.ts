import type { IMStore } from "../main/im/imStore";

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
    private readonly imStore: Pick<IMStore, "getCcConnectSessionKey">,
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
    const accountId = requireValue(
      "delivery accountId",
      input.task.delivery.accountId,
    );
    const platform = normalizePlatform(
      requireValue("delivery channel", input.task.delivery.channel),
    );
    const conversationId = requireValue(
      "delivery destination",
      input.task.delivery.to,
    );
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
    await client.send({ platform, sessionKey, content: input.content });
    return {};
  }
}

function requireValue(name: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Scheduled task ${name} is required`);
  return normalized;
}

function normalizePlatform(platform: string): string {
  return platform === "qq" ? "qqbot" : platform;
}
