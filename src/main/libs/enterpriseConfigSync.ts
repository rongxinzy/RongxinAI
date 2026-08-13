import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import type { SqliteStore } from '../sqliteStore';

export type EnterpriseUIAction = 'hide' | 'disable' | 'readonly';

export type EnterpriseManifest = {
  version: string;
  name: string;
  ui?: Record<string, EnterpriseUIAction>;
  disableUpdate?: boolean;
  sync: {
    skills: boolean | 'merge' | 'overwrite';
    agents: boolean | 'force';
    mcp: boolean | 'merge' | 'overwrite';
    plugins?: boolean | 'merge' | 'overwrite';
  };
  autoAcceptPrivacy?: boolean;
};

const ENTERPRISE_CONFIG_DIR = 'enterprise-config';
const MANIFEST_FILE = 'manifest.json';

function resolveMergeMode(
  value: boolean | 'merge' | 'overwrite' | undefined,
): 'merge' | 'overwrite' | null {
  if (!value) return null;
  return value === 'overwrite' ? 'overwrite' : 'merge';
}

export function resolveEnterpriseConfigPath(): string | null {
  const configPath = path.join(app.getPath('userData'), ENTERPRISE_CONFIG_DIR);
  return fs.existsSync(path.join(configPath, MANIFEST_FILE)) ? configPath : null;
}

export function syncEnterpriseConfig(
  configPath: string,
  store: SqliteStore,
  mcpUpsertByName: (server: {
    name: string;
    description: string;
    transportType: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
  }) => void,
  mcpClearAll: () => void,
  getWorkingDirectory: () => string | undefined,
): EnterpriseManifest | null {
  let manifest: EnterpriseManifest;
  try {
    manifest = JSON.parse(
      fs.readFileSync(path.join(configPath, MANIFEST_FILE), 'utf-8'),
    ) as EnterpriseManifest;
  } catch (error) {
    console.error('[Enterprise] failed to parse manifest.json, skipping enterprise config:', error);
    return null;
  }

  console.log(`[Enterprise] detected enterprise config ${manifest.name} v${manifest.version}`);
  const previousManifest = store.get<EnterpriseManifest>('enterprise_config');
  const versionChanged = previousManifest?.version !== manifest.version;
  store.set('enterprise_config', manifest);

  if (manifest.autoAcceptPrivacy) store.set('privacy_agreed', true);

  const agentsForce = manifest.sync.agents === 'force';
  if (versionChanged) {
    const skillsMode = resolveMergeMode(manifest.sync.skills);
    if (skillsMode) syncSkills(configPath, store, skillsMode);
    if (manifest.sync.agents) syncAgents(configPath, getWorkingDirectory(), agentsForce);
    const pluginsMode = resolveMergeMode(manifest.sync.plugins);
    if (pluginsMode) syncPlugins(configPath, pluginsMode);
    const mcpMode = resolveMergeMode(manifest.sync.mcp);
    if (mcpMode) syncMcpServers(configPath, mcpUpsertByName, mcpClearAll, mcpMode);
  } else {
    if (manifest.sync.agents) syncAgents(configPath, getWorkingDirectory(), agentsForce);
    const pluginsMode = resolveMergeMode(manifest.sync.plugins);
    if (pluginsMode) syncPlugins(configPath, pluginsMode);
    console.log('[Enterprise] version unchanged, skipping immutable package content');
  }

  console.log('[Enterprise] config sync completed');
  return manifest;
}

function syncSkills(configPath: string, store: SqliteStore, mode: 'merge' | 'overwrite'): void {
  const sourceDir = path.join(configPath, 'skills');
  if (!fs.existsSync(sourceDir)) {
    console.log('[Enterprise] no skills directory found, skipping skills sync');
    return;
  }

  const targetDir = path.join(app.getPath('userData'), 'SKILLs');
  fs.mkdirSync(targetDir, { recursive: true });
  if (mode === 'overwrite') {
    for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        fs.rmSync(path.join(targetDir, entry.name), { recursive: true, force: true });
      } catch (error) {
        console.warn(`[Enterprise] failed to remove existing skill "${entry.name}":`, error);
      }
    }
  }

  const skillNames: string[] = [];
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      copyDirRecursive(path.join(sourceDir, entry.name), path.join(targetDir, entry.name));
      skillNames.push(entry.name);
    } catch (error) {
      console.warn(`[Enterprise] failed to copy skill "${entry.name}":`, error);
    }
  }

  const state =
    mode === 'overwrite'
      ? ({} as Record<string, { enabled: boolean }>)
      : (store.get<Record<string, { enabled: boolean }>>('skills_state') ?? {});
  for (const name of skillNames) state[name] = { enabled: true };
  store.set('skills_state', state);
  console.log(`[Enterprise] synced ${skillNames.length} skills in ${mode} mode`);
}

function copyDirRecursive(source: string, target: string): void {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) copyDirRecursive(sourcePath, targetPath);
    else fs.copyFileSync(sourcePath, targetPath);
  }
}

function syncAgents(configPath: string, workspaceDir: string | undefined, force: boolean): void {
  const sourceDir = path.join(configPath, 'agents');
  if (!fs.existsSync(sourceDir)) {
    console.log('[Enterprise] no agents directory found, skipping agents sync');
    return;
  }
  if (!workspaceDir) {
    console.warn('[Enterprise] agent workspace is unavailable, skipping agents sync');
    return;
  }

  try {
    fs.mkdirSync(workspaceDir, { recursive: true });
  } catch (error) {
    console.warn(`[Enterprise] failed to prepare agent workspace at ${workspaceDir}:`, error);
    return;
  }

  let copiedCount = 0;
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(workspaceDir, entry.name);
    if (!force && fs.existsSync(targetPath)) continue;
    try {
      if (entry.isDirectory()) copyDirRecursive(sourcePath, targetPath);
      else fs.copyFileSync(sourcePath, targetPath);
      copiedCount += 1;
    } catch (error) {
      console.warn(`[Enterprise] failed to copy agent file "${entry.name}":`, error);
    }
  }
  console.log(`[Enterprise] synced ${copiedCount} agent files to ${workspaceDir}`);
}

function syncMcpServers(
  configPath: string,
  upsertByName: (server: {
    name: string;
    description: string;
    transportType: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
  }) => void,
  clearAll: () => void,
  mode: 'merge' | 'overwrite',
): void {
  const serversPath = path.join(configPath, 'mcp', 'servers.json');
  if (!fs.existsSync(serversPath)) {
    console.log('[Enterprise] no MCP server file found, skipping MCP sync');
    return;
  }

  try {
    const servers = JSON.parse(fs.readFileSync(serversPath, 'utf-8')) as Array<{
      name: string;
      description?: string;
      transportType?: string;
      command?: string;
      args?: string[];
      env?: Record<string, string>;
    }>;
    if (!Array.isArray(servers)) {
      console.warn('[Enterprise] MCP server file is not an array, skipping');
      return;
    }
    if (mode === 'overwrite') clearAll();
    let syncedCount = 0;
    for (const server of servers) {
      if (!server.name) continue;
      upsertByName({
        name: server.name,
        description: server.description ?? '',
        transportType: server.transportType ?? 'stdio',
        command: server.command,
        args: server.args,
        env: server.env,
      });
      syncedCount += 1;
    }
    console.log(`[Enterprise] synced ${syncedCount} MCP servers in ${mode} mode`);
  } catch (error) {
    console.error('[Enterprise] failed to sync MCP servers:', error);
  }
}

function syncPlugins(configPath: string, mode: 'merge' | 'overwrite'): void {
  const pluginsDir = path.join(configPath, 'plugins');
  if (!fs.existsSync(pluginsDir)) {
    console.log('[Enterprise] no plugins directory found, skipping plugin sync');
    return;
  }
  const pluginCount = fs
    .readdirSync(pluginsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory()).length;
  console.log(`[Enterprise] registered ${pluginCount} plugin packages in ${mode} mode`);
}
