import fs from 'node:fs/promises';
import path from 'node:path';
/** Keep product resources isolated from CLI configuration and retired runtime data. */
export async function ensureEmbeddedPiAgentDir(userData: string): Promise<string> {
  const agentDir = path.join(userData, 'agent-resources');
  await fs.mkdir(agentDir, { recursive: true });
  process.env.ZHIYUAN_AGENT_DIR = agentDir;
  return agentDir;
}
