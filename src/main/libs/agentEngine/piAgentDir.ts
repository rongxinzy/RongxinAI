import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Matches @earendil-works/pi-coding-agent `ENV_AGENT_DIR` (PI_CODING_AGENT_DIR). */
const PI_EMBEDDED_AGENT_DIR_ENV = 'PI_CODING_AGENT_DIR';

const MIGRATION_MARKER = '.zhiyuan-migrated-from-home';

const AGENT_FILE_NAMES = [
  'settings.json',
  'auth.json',
  'models.json',
  'mcp.json',
  'keybindings.json',
  'prompts',
  'agents',
  'extensions',
  'skills',
  'themes',
  'tools',
] as const;

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function copyEntry(source: string, destination: string): Promise<void> {
  const stat = await fs.lstat(source);
  if (stat.isDirectory()) {
    await fs.cp(source, destination, { recursive: true, errorOnExist: false });
    return;
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
}

/**
 * Keeps embedded Pi state under userData so Magpie can wire the user's ~/.pi/agent
 * without changing in-app Pi sessions.
 */
export async function ensureEmbeddedPiAgentDir(userData: string): Promise<string> {
  const agentDir = path.join(userData, 'pi-agent');
  await fs.mkdir(agentDir, { recursive: true });
  process.env[PI_EMBEDDED_AGENT_DIR_ENV] = agentDir;

  const marker = path.join(agentDir, MIGRATION_MARKER);
  if (await pathExists(marker)) return agentDir;

  const legacyDir = path.join(
    process.env.HOME ?? process.env.USERPROFILE ?? os.homedir(),
    '.pi',
    'agent',
  );
  if (!(await pathExists(legacyDir))) {
    await fs.writeFile(marker, `${new Date().toISOString()}\n`, 'utf8');
    return agentDir;
  }

  for (const name of AGENT_FILE_NAMES) {
    const from = path.join(legacyDir, name);
    const to = path.join(agentDir, name);
    if (!(await pathExists(from)) || (await pathExists(to))) continue;
    await copyEntry(from, to);
  }

  await fs.writeFile(marker, `${new Date().toISOString()}\n`, 'utf8');
  return agentDir;
}
