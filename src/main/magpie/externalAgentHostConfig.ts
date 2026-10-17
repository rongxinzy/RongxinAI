import fs from 'node:fs/promises';
import path from 'node:path';

const STASH_ROOT = 'host-agent-stash';

export function canonicalHostAgentId(agentId: string): string {
  const id = agentId.trim().toLowerCase();
  if (id === 'claude-code' || id === 'cc') return 'claude';
  return id;
}

export function resolveUserHome(environment: NodeJS.ProcessEnv = process.env): string {
  const home = environment.HOME ?? environment.USERPROFILE;
  if (!home) throw new Error('HOME is unavailable for external agent host config');
  return home;
}

export function userAgentConfigRoots(home: string): Readonly<Record<string, string[]>> {
  return {
    claude: [path.join(home, '.claude')],
    codex: [path.join(home, '.codex')],
    opencode: [path.join(home, '.config', 'opencode')],
    gemini: [path.join(home, '.gemini')],
    pi: [path.join(home, '.pi', 'agent')],
  };
}

function privateOpenCodeConfig(privateHome: string): string {
  return path.join(privateHome, 'config', 'opencode', 'opencode.json');
}

function userOpenCodeConfig(home: string): string {
  return path.join(home, '.config', 'opencode', 'opencode.json');
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function copyFileEnsuringDir(from: string, to: string): Promise<void> {
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
}

async function copyTree(from: string, to: string): Promise<void> {
  await fs.cp(from, to, { recursive: true, force: true, errorOnExist: false });
}

async function snapshotDirectoryTree(source: string, destination: string): Promise<void> {
  if (!(await pathExists(source))) {
    await fs.rm(destination, { recursive: true, force: true });
    return;
  }
  await fs.rm(destination, { recursive: true, force: true });
  await copyTree(source, destination);
}

async function restoreDirectoryTree(snapshot: string, target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true });
  if (await pathExists(snapshot)) {
    await copyTree(snapshot, target);
  }
}

function hostStashDir(privateHome: string, agentId: string): string {
  return path.join(privateHome, STASH_ROOT, agentId);
}

export async function snapshotAgentHostTrees(
  privateHome: string,
  agentId: string,
  home: string,
): Promise<void> {
  const canonical = canonicalHostAgentId(agentId);
  const roots = userAgentConfigRoots(home)[canonical];
  if (!roots) return;
  const stash = hostStashDir(privateHome, canonical);
  await fs.rm(stash, { recursive: true, force: true });
  for (const root of roots) {
    const name = path.basename(root);
    await snapshotDirectoryTree(root, path.join(stash, name));
  }
}

export async function restoreAgentHostTrees(
  privateHome: string,
  agentId: string,
  home: string,
): Promise<void> {
  const canonical = canonicalHostAgentId(agentId);
  const roots = userAgentConfigRoots(home)[canonical];
  if (!roots) return;
  const stash = hostStashDir(privateHome, canonical);
  for (const root of roots) {
    const name = path.basename(root);
    await restoreDirectoryTree(path.join(stash, name), root);
  }
}

/** Magpie writes OpenCode under app-private XDG; mirror into the user's real config. */
export async function mirrorOpenCodeConfigToUser(privateHome: string, home: string): Promise<void> {
  const from = privateOpenCodeConfig(privateHome);
  if (!(await pathExists(from))) return;
  await copyFileEnsuringDir(from, userOpenCodeConfig(home));
}

/** Fallback when upstream disconnect leaves Codex provider debris. */
export async function stripCodexMagpieProviderBlock(home: string): Promise<void> {
  const configPath = path.join(home, '.codex', 'config.toml');
  if (!(await pathExists(configPath))) return;
  const original = await fs.readFile(configPath, 'utf8');
  const lines = original.split('\n');
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (/^\[model_providers\.magpie\]/.test(line.trim())) {
      skipping = true;
      continue;
    }
    if (skipping && /^\[/.test(line.trim())) skipping = false;
    if (!skipping) out.push(line);
  }
  const next = out.join('\n');
  if (next !== original) await fs.writeFile(configPath, next, 'utf8');
}

export async function collectDirectorySnapshot(root: string): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  if (!(await pathExists(root))) return out;
  async function walk(relative: string): Promise<void> {
    const absolute = path.join(root, relative);
    const entries = await fs.readdir(absolute, { withFileTypes: true });
    for (const entry of entries) {
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      const full = path.join(root, next);
      if (entry.isDirectory()) await walk(next);
      else if (entry.isFile()) out.set(next, await fs.readFile(full));
    }
  }
  await walk('');
  return out;
}

export function assertDirectorySnapshotsEqual(
  before: Map<string, Buffer>,
  after: Map<string, Buffer>,
  label: string,
): void {
  const keys = new Set([...before.keys(), ...after.keys()]);
  for (const key of keys) {
    const left = before.get(key);
    const right = after.get(key);
    if (!left || !right || !left.equals(right)) {
      throw new Error(`Host config drift for ${label} at ${key}`);
    }
  }
}
