import { addAbortListener } from 'node:events';
import type { IMStore } from '../main/im/imStore';
import type { CoworkMessageStore } from '../main/coworkStore/messageStore';

import type { CcConnectDeliveryClient } from './ccConnectDeliveryClient';
import type { SchedulerDeliveryTransport } from './deliveryDispatcher';

type DeliveryClient = Pick<CcConnectDeliveryClient, 'send'>;

/**
 * Routes an already-persisted Delivery through the sidecar that owns its
 * ChannelAccount. The native session key is learned from an inbound cc-connect
 * turn; it is never inferred from the display conversation id.
 */
export class CcConnectDeliveryTransport implements SchedulerDeliveryTransport {
  private connection: { accounts: ReadonlySet<string>; client: DeliveryClient } | null = null;
  private startup?: Promise<void>;

  constructor(
    private readonly imStore: Pick<
      IMStore,
      'getCcConnectSessionKey' | 'getCcConnectCoworkSessionId'
    >,
    private readonly messageStore?: Pick<CoworkMessageStore, 'addMessage'>,
  ) {}

  connect(accountIds: readonly string[], client: DeliveryClient): void {
    const accounts = new Set(accountIds.map(id => requireValue('accountId', id)));
    this.connection = { accounts, client };
  }

  disconnect(): void {
    this.connection = null;
  }

  trackStartup(startup: Promise<void>): Promise<void> {
    return (this.startup = startup.finally(() => {
      this.startup = undefined;
    }));
  }

  async send(
    input: Parameters<SchedulerDeliveryTransport['send']>[0],
    signal?: AbortSignal,
  ): Promise<{ receiptId?: string | null }> {
    signal?.throwIfAborted();
    if (!this.connection && this.startup) {
      const aborted = Promise.withResolvers<never>();
      using _listener = signal && addAbortListener(signal, () => aborted.reject(signal.reason));
      await Promise.race([this.startup, aborted.promise]);
      signal?.throwIfAborted();
    }
    const platform = normalizePlatform(
      requireValue('delivery channel', input.task.delivery.channel),
    );
    const conversationId = requireValue('delivery destination', input.task.delivery.to);
    const { accountId, recipientSessionId } = this.resolveRecipient(
      platform,
      conversationId,
      input.task.delivery.accountId,
    );
    const connection = this.connection;
    if (!connection?.accounts.has(accountId))
      throw new Error(`cc-connect delivery sidecar is unavailable for account ${accountId}`);
    const sessionKey = this.imStore.getCcConnectSessionKey(accountId, platform, conversationId);
    if (!sessionKey) {
      throw new Error(`cc-connect delivery route is unknown for ${platform}:${conversationId}`);
    }
    await connection.client.send(
      { accountId, platform, sessionKey, content: input.content },
      signal,
    );
    try {
      // Pi already wrote the answer when the recipient is the execution session.
      if (
        recipientSessionId &&
        recipientSessionId !== input.run.sessionId &&
        input.content.trim()
      ) {
        this.messageStore?.addMessage(recipientSessionId, {
          type: 'assistant',
          content: input.content,
          metadata: {
            source: 'scheduled_task_delivery',
            scopedConversationId: JSON.stringify([accountId, conversationId]),
          },
        });
      }
    } catch (error) {
      // Delivery has already succeeded. Do not turn an outbound notification
      // into a failed delivery merely because its local context projection
      // could not be persisted.
      console.warn('[CcConnectDelivery] failed to persist assistant context:', error);
    }
    return {};
  }

  private resolveRecipient(
    platform: string,
    conversationId: string,
    configuredAccountId?: string,
  ): { accountId: string; recipientSessionId: string | null } {
    const configured = configuredAccountId?.trim();
    if (configured) {
      let recipientSessionId: string | null = null;
      if (this.messageStore) {
        try {
          recipientSessionId = this.imStore.getCcConnectCoworkSessionId(
            configured,
            platform,
            conversationId,
          );
        } catch (error) {
          console.warn('[CcConnectDelivery] failed to resolve assistant context:', error);
        }
      }
      return { accountId: configured, recipientSessionId };
    }

    // Legacy tasks may not have persisted accountId. Recover it from the
    // scoped session mapping created when the channel first received a message.
    const candidates = [...(this.connection?.accounts ?? [])].flatMap(accountId => {
      const recipientSessionId = this.imStore.getCcConnectCoworkSessionId(
        accountId,
        platform,
        conversationId,
      );
      return recipientSessionId ? [{ accountId, recipientSessionId }] : [];
    });
    if (candidates.length === 0) {
      throw new Error(
        `Scheduled task delivery accountId is required for ${platform}:${conversationId}`,
      );
    }
    if (candidates.length > 1) {
      throw new Error(
        `Scheduled task delivery accountId is ambiguous for ${platform}:${conversationId}`,
      );
    }
    return candidates[0];
  }
}

function requireValue(name: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Scheduled task ${name} is required`);
  return normalized;
}

function normalizePlatform(platform: string): string {
  if (platform === 'qq') return 'qqbot';
  if (platform === 'lark') return 'feishu';
  return platform;
}
