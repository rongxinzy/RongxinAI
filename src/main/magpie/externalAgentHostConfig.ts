import fs from 'node:fs/promises';
import path from 'node:path';
import { isRecord } from '../../shared/lib/isRecord';

const STASH_ROOT = 'host-agent-stash';
const OPENCODE_STASH_NAME = 'opencode-merge.json';

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

function opencodeStashPath(privateHome: string): string {
  return path.join(privateHome, STASH_ROOT, OPENCODE_STASH_NAME);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error(`${label} must be a JSON object`);
  return parsed;
}

type OpenCodeMergeStash = {
  hadFile: boolean;
  addedProviderKeys: string[];
  replacedProviderValues: Record<string, unknown>;
  changedModel: boolean;
  hadModelKey: boolean;
  modelBefore?: unknown;
};

/** Remove legacy whole-tree snapshots; never store credentials or full agent dirs. */
export async function clearLegacyHostAgentStorage(privateHome: string): Promise<void> {
  const legacy = path.join(privateHome, STASH_ROOT);
  if (!(await pathExists(legacy))) return;
  const entries = await fs.readdir(legacy, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === OPENCODE_STASH_NAME) continue;
    await fs.rm(path.join(legacy, entry.name), { recursive: true, force: true });
  }
}

/** Merge magpie OpenCode provider entries and model into the user's config without replacing the file. */
export async function mergeOpenCodeConfigToUser(privateHome: string, home: string): Promise<void> {
  await clearLegacyHostAgentStorage(privateHome);
  const from = privateOpenCodeConfig(privateHome);
  if (!(await pathExists(from))) return;

  const magpie = parseJsonObject(await fs.readFile(from, 'utf8'), 'Magpie OpenCode config');
  const userPath = userOpenCodeConfig(home);
  const hadFile = await pathExists(userPath);
  const user = hadFile
    ? parseJsonObject(await fs.readFile(userPath, 'utf8'), 'User OpenCode config')
    : {};

  const magpieProvider = isRecord(magpie.provider) ? magpie.provider : {};
  const userProvider = isRecord(user.provider) ? { ...user.provider } : {};

  const stash: OpenCodeMergeStash = {
    hadFile,
    addedProviderKeys: [],
    replacedProviderValues: {},
    changedModel: false,
    hadModelKey: Object.prototype.hasOwnProperty.call(user, 'model'),
  };
  if (stash.hadModelKey) stash.modelBefore = user.model;

  for (const [key, value] of Object.entries(magpieProvider)) {
    if (!Object.prototype.hasOwnProperty.call(userProvider, key)) {
      stash.addedProviderKeys.push(key);
      userProvider[key] = value;
    } else if (JSON.stringify(userProvider[key]) !== JSON.stringify(value)) {
      stash.replacedProviderValues[key] = userProvider[key];
      userProvider[key] = value;
    }
  }

  if (Object.prototype.hasOwnProperty.call(magpie, 'model')) {
    stash.changedModel = true;
    if (!stash.hadModelKey) stash.modelBefore = undefined;
    user.model = magpie.model;
  }

  if (Object.keys(userProvider).length > 0) user.provider = userProvider;
  else delete user.provider;

  await fs.mkdir(path.dirname(userPath), { recursive: true });
  await fs.writeFile(userPath, `${JSON.stringify(user, null, 2)}\n`, 'utf8');
  await fs.mkdir(path.dirname(opencodeStashPath(privateHome)), { recursive: true });
  await fs.writeFile(opencodeStashPath(privateHome), `${JSON.stringify(stash, null, 2)}\n`, 'utf8');
}

export async function revertOpenCodeConfigFromUser(
  privateHome: string,
  home: string,
): Promise<void> {
  const stashPath = opencodeStashPath(privateHome);
  if (!(await pathExists(stashPath))) return;

  const stash = JSON.parse(await fs.readFile(stashPath, 'utf8')) as OpenCodeMergeStash;
  const userPath = userOpenCodeConfig(home);

  if (!stash.hadFile) {
    if (await pathExists(userPath)) await fs.rm(userPath, { force: true });
    await fs.rm(stashPath, { force: true });
    return;
  }

  if (!(await pathExists(userPath))) {
    await fs.rm(stashPath, { force: true });
    return;
  }

  const user = parseJsonObject(await fs.readFile(userPath, 'utf8'), 'User OpenCode config');
  const userProvider = isRecord(user.provider) ? { ...user.provider } : {};

  for (const key of stash.addedProviderKeys) delete userProvider[key];
  for (const [key, value] of Object.entries(stash.replacedProviderValues)) {
    userProvider[key] = value;
  }

  if (Object.keys(userProvider).length > 0) user.provider = userProvider;
  else delete user.provider;

  if (stash.changedModel) {
    if (stash.hadModelKey) user.model = stash.modelBefore;
    else delete user.model;
  }

  await fs.writeFile(userPath, `${JSON.stringify(user, null, 2)}\n`, 'utf8');
  await fs.rm(stashPath, { force: true });
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
    const trimmed = line.trim();
    if (/^\[model_providers\.magpie\]/.test(trimmed)) {
      skipping = true;
      continue;
    }
    if (skipping && /^\[/.test(trimmed)) skipping = false;
    if (skipping) continue;
    if (/^magpie[_a-z]*\s*=/.test(trimmed)) continue;
    out.push(line);
  }
  let next = out.join('\n');
  while (next.endsWith('\n\n')) next = next.slice(0, -1);
  if (!next.endsWith('\n') && original.endsWith('\n')) next = `${next}\n`;
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

export async function readFileIfExists(filePath: string): Promise<Buffer | null> {
  if (!(await pathExists(filePath))) return null;
  return fs.readFile(filePath);
}
