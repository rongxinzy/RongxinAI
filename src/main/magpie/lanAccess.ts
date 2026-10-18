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
  const active = existing.filter(key => key.off !== true);
  if (active.length === 1) {
    const copied = await client.managementJson('/api/caller-keys/copy-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: active[0].id }),
    });
    if (typeof copied === 'string' && copied === secret) return;
  }
  await client.managementJson('/api/caller-keys/add-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: MAGPIE_LAN_KEY_NAME, secret }),
  });
  for (const key of existing) {
    await client.managementJson('/api/caller-keys/remove-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: key.id }),
    });
  }
}
