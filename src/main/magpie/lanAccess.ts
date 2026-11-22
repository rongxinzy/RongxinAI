import { LlamaCppGatewayAccessMode } from '../../shared/llamacpp';
import type { LlamaCppServiceConfig } from '../../shared/llamacpp';

/** Gateway key name the local-inference LAN token is imported under. */
export const MAGPIE_LAN_KEY_NAME = 'zhiyuan-lan';

/** Same rule as the llama.cpp service config today: either signal means LAN. */
export function isLlamaCppLanAccessEnabled(config: LlamaCppServiceConfig): boolean {
  return (
    config.gatewayAccessMode === LlamaCppGatewayAccessMode.Lan || config.listenHost === '0.0.0.0'
  );
}

type MagpieCallerKey = {
  id: string;
  name: string;
  off?: boolean;
};

export type MagpieLanAccessClient = {
  /** Authenticated management JSON call into the running gateway's web port. */
  managementJson(route: string, init?: RequestInit): Promise<Record<string, unknown>>;
};

/**
 * Idempotently imports the LAN token as the `zhiyuan-lan` gateway key. The key
 * list never returns secrets, so an existing key is compared through its
 * administrator copy action. On regeneration the new secret is added before the
 * old key is removed, so LAN clients see no window where no key works.
 */
export async function syncMagpieLanAccessKey(
  client: MagpieLanAccessClient,
  lanToken: string,
): Promise<void> {
  const secret = lanToken.trim();
  if (!secret) throw new Error('The LAN access token is unavailable.');
  const state = await client.managementJson('/api/caller-keys');
  const keys = (Array.isArray(state.keys) ? state.keys : []).filter(
    (key): key is MagpieCallerKey =>
      Boolean(key) && typeof key === 'object' && typeof (key as MagpieCallerKey).id === 'string',
  );
  const existing = keys.filter(key => key.name === MAGPIE_LAN_KEY_NAME);
  const post = (action: string, body: Record<string, string>) =>
    client.managementJson(`/api/caller-keys/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  let retained: MagpieCallerKey | undefined;
  for (const key of existing) {
    // copy-key answers {"secret": "..."} (the wrapped access.Update result).
    const copied = await post('copy-key', { key: key.id });
    if (copied.secret === secret) {
      retained = key;
      break;
    }
  }
  if (!retained) {
    await post('add-key', { name: MAGPIE_LAN_KEY_NAME, secret });
  } else if (retained.off) {
    await post('on-key', { key: retained.id });
  }
  for (const key of existing) {
    if (key.id !== retained?.id) await post('remove-key', { key: key.id });
  }
}
