import type { MagpieAgents } from '../../shared/magpie/types';
import { canonicalHostAgentId, syncOpenCodeConfigToUser } from './externalAgentHostConfig';

/** Cold /api/agents reads on this machine take longer than the 2s management GET. */
const STARTUP_AGENT_READ_TIMEOUT_MS = 20_000;
const STARTUP_AGENT_READ_ATTEMPTS = 3;
const STARTUP_AGENT_READ_RETRY_MS = 1_000;

export async function sweepManagedAgentsAfterStart(input: {
  isRunning: () => boolean;
  readAgents: (timeoutMs: number) => Promise<MagpieAgents>;
  reapply: (snapshot: MagpieAgents) => Promise<Map<string, string>>;
}): Promise<{ snapshot: MagpieAgents; errors: Map<string, string> } | undefined> {
  if (!input.isRunning()) return undefined;
  let snapshot: MagpieAgents | undefined;
  let errors = new Map<string, string>();
  for (let attempt = 0; attempt < STARTUP_AGENT_READ_ATTEMPTS && !snapshot; attempt += 1) {
    try {
      const current = await input.readAgents(STARTUP_AGENT_READ_TIMEOUT_MS);
      errors = await input.reapply(current);
      snapshot = current;
    } catch (error) {
      if (attempt === STARTUP_AGENT_READ_ATTEMPTS - 1) {
        console.warn('[Magpie] reapply sweep failed during startup:', error);
      } else {
        await new Promise(resolve => setTimeout(resolve, STARTUP_AGENT_READ_RETRY_MS));
      }
    }
  }
  if (!snapshot) return undefined;
  return { snapshot, errors };
}

/**
 * The user's copy has to follow the gateway the service runs on now: magpie's
 * reapply can leave its own config on the old port, and builds that keep no
 * private copy need the live address instead. Only runs when OpenCode is wired
 * and its reapply did not fail.
 */
export async function resyncOpenCodeUserConfig(input: {
  snapshot: MagpieAgents;
  errors: ReadonlyMap<string, string>;
  privateHome: string;
  home: string;
  gatewayUrl?: string;
}): Promise<void> {
  const wired = input.snapshot.agents.some(
    agent => agent.wired && canonicalHostAgentId(agent.id) === 'opencode',
  );
  if (!wired || input.errors.has('opencode')) return;
  try {
    await syncOpenCodeConfigToUser(input.privateHome, input.home, input.gatewayUrl);
  } catch (error) {
    console.warn('[Magpie] opencode user config was not updated after reapply:', error);
  }
}
