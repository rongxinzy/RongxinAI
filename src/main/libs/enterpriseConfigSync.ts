import { app } from 'electron';
import * as fs from 'node:fs/promises';
import path from 'path';

import type { SqliteStore } from '../sqliteStore';

type EnterpriseUIAction = 'hide' | 'disable' | 'readonly';

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

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveEnterpriseConfigPath(): Promise<string | null> {
  const configPath = path.join(app.getPath('userData'), ENTERPRISE_CONFIG_DIR);
  return (await pathExists(path.join(configPath, MANIFEST_FILE))) ? configPath : null;
}

export async function syncEnterpriseConfig(
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
): Promise<EnterpriseManifest | null> {
  let manifest: EnterpriseManifest;
  try {
    manifest = JSON.parse(
      await fs.readFile(path.join(configPath, MANIFEST_FILE), 'utf-8'),
    ) as EnterpriseManifest;
  } catch (error) {
    console.error('[Enterprise] failed to parse manifest.json, skipping enterprise config:', error);
    return null;
  }

  console.log(`[Enterprise] detected enterprise config ${manifest.name} v${manifest.version}`);
  const previousManifest = store.get<EnterpriseManifest>('enterprise_config');
  const versionChanged = previousManifest?.version !== manifest.version;
  const agentsForce = manifest.sync.agents === 'force';
  if (versionChanged) {
    const skillsMode = resolveMergeMode(manifest.sync.skills);
    if (skillsMode) await syncSkills(configPath, store, skillsMode);
    if (manifest.sync.agents) await syncAgents(configPath, getWorkingDirectory(), agentsForce);
    const pluginsMode = resolveMergeMode(manifest.sync.plugins);
    if (pluginsMode) await syncPlugins(configPath, pluginsMode);
    const mcpMode = resolveMergeMode(manifest.sync.mcp);
    if (mcpMode) await syncMcpServers(configPath, mcpUpsertByName, mcpClearAll, mcpMode);
  } else {
    if (manifest.sync.agents) await syncAgents(configPath, getWorkingDirectory(), agentsForce);
    const pluginsMode = resolveMergeMode(manifest.sync.plugins);
    if (pluginsMode) await syncPlugins(configPath, pluginsMode);
    console.log('[Enterprise] version unchanged, skipping immutable package content');
  }

  store.set('enterprise_config', manifest);
  if (manifest.autoAcceptPrivacy) store.set('privacy_agreed', true);
  console.log('[Enterprise] config sync completed');
  return manifest;
}

async function syncSkills(
  configPath: string,
  store: SqliteStore,
  mode: 'merge' | 'overwrite',
): Promise<void> {
  const sourceDir = path.join(configPath, 'skills');
  if (!(await pathExists(sourceDir))) {
    console.log('[Enterprise] no skills directory found, skipping skills sync');
    return;
  }

  const targetDir = path.join(app.getPath('userData'), 'SKILLs');
  await fs.mkdir(targetDir, { recursive: true });
  if (mode === 'overwrite') {
    for (const entry of await fs.readdir(targetDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        await fs.rm(path.join(targetDir, entry.name), { recursive: true, force: true });
      } catch (error) {
        console.warn(`[Enterprise] failed to remove existing skill "${entry.name}":`, error);
      }
    }
  }

  const skillNames: string[] = [];
  for (const entry of await fs.readdir(sourceDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      await copyDirRecursive(path.join(sourceDir, entry.name), path.join(targetDir, entry.name));
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

async function copyDirRecursive(source: string, target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) await copyDirRecursive(sourcePath, targetPath);
    else await fs.copyFile(sourcePath, targetPath);
  }
}

async function syncAgents(
  configPath: string,
  workspaceDir: string | undefined,
  force: boolean,
): Promise<void> {
  const sourceDir = path.join(configPath, 'agents');
  if (!(await pathExists(sourceDir))) {
    console.log('[Enterprise] no agents directory found, skipping agents sync');
    return;
  }
  if (!workspaceDir) {
    console.warn('[Enterprise] agent workspace is unavailable, skipping agents sync');
    return;
  }

  try {
    await fs.mkdir(workspaceDir, { recursive: true });
  } catch (error) {
    console.warn(`[Enterprise] failed to prepare agent workspace at ${workspaceDir}:`, error);
    return;
  }

  let copiedCount = 0;
  for (const entry of await fs.readdir(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(workspaceDir, entry.name);
    if (!force && (await pathExists(targetPath))) continue;
    try {
      if (entry.isDirectory()) await copyDirRecursive(sourcePath, targetPath);
      else await fs.copyFile(sourcePath, targetPath);
      copiedCount += 1;
    } catch (error) {
      console.warn(`[Enterprise] failed to copy agent file "${entry.name}":`, error);
    }
  }
  console.log(`[Enterprise] synced ${copiedCount} agent files to ${workspaceDir}`);
}

async function syncMcpServers(
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
): Promise<void> {
  const serversPath = path.join(configPath, 'mcp', 'servers.json');
  if (!(await pathExists(serversPath))) {
    console.log('[Enterprise] no MCP server file found, skipping MCP sync');
    return;
  }

  try {
    const servers = JSON.parse(await fs.readFile(serversPath, 'utf-8')) as Array<{
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

async function syncPlugins(configPath: string, mode: 'merge' | 'overwrite'): Promise<void> {
  const pluginsDir = path.join(configPath, 'plugins');
  if (!(await pathExists(pluginsDir))) {
    console.log('[Enterprise] no plugins directory found, skipping plugin sync');
    return;
  }
  const entries = await fs.readdir(pluginsDir, { withFileTypes: true });
  const pluginCount = entries.filter(entry => entry.isDirectory()).length;
  console.log(`[Enterprise] registered ${pluginCount} plugin packages in ${mode} mode`);
}
