/** Agent IPC: list/get/create/update/delete agents, import/export, expert packages. */
import fs from 'fs';
import path from 'path';

import { app, BrowserWindow, dialog, ipcMain } from 'electron';

import {
  listAllMatchingSessionIds,
  forgetCoworkSession,
} from '../appBootstrap/coworkSessionImages';
import { listPresetExperts } from '../presetExpertCatalog';
import { DB_FILENAME } from '../appConstants';
import { CoworkSessionExpertSource } from '../../shared/cowork/sessionExperts';
import { CoworkStreamIpc } from '../../shared/ipc/channels';
import { providersContract } from '../../shared/ipc/providersContract';
import type { ChannelAccountManager } from '../im/channelAccountManager';
import type { AgentManager } from '../agentManager';
import type { CoworkStore } from '../coworkStore';
import type { SkillManager } from '../skillManager';
import type { SqliteStore } from '../sqliteStore';
import { handleIpcContractSubset } from '../ipc/handleIpcContract';

export interface AgentIpcDeps {
  getAgentManager: () => AgentManager;
  getCoworkStore: () => CoworkStore;
  getSkillManager: () => SkillManager;
  getStore: () => SqliteStore;
  getIMGatewayManager: () => ChannelAccountManager;
  bumpCodingCommandCatalog: () => void;
  resolveDefaultAgentModelRef: () => string;
}

export const registerAgentIpc = (deps: AgentIpcDeps): void => {
  // ========== Agent IPC Handlers ==========

  handleIpcContractSubset(providersContract, {
    agentsList: async () => {
      try {
        const agents = deps.getAgentManager().listAgents();
        return { success: true, agents };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list agents',
        };
      }
    },

    agentsGet: async (_event, id) => {
      try {
        const agent = deps.getAgentManager().getAgent(id);
        return { success: true, agent };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get agent',
        };
      }
    },

    agentsCreate: async (_event, request) => {
      try {
        const agent = deps
          .getAgentManager()
          .createAgent(request, deps.resolveDefaultAgentModelRef());
        deps.bumpCodingCommandCatalog();
        return { success: true, agent };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create agent',
        };
      }
    },

    agentsUpdate: async (_event, id, updates) => {
      try {
        const agent = deps.getAgentManager().updateAgent(id, updates);
        deps.bumpCodingCommandCatalog();
        return { success: true, agent };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update agent',
        };
      }
    },

    agentsDelete: async (_event, id) => {
      try {
        const result = deps.getAgentManager().deleteAgent(id);
        if (result) deps.bumpCodingCommandCatalog();

        // Cascade delete all Cowork sessions belonging to the deleted agent
        const agentIpcCoworkStore = deps.getCoworkStore();
        for (const sessionId of listAllMatchingSessionIds({ agentId: id })) {
          forgetCoworkSession(sessionId);
        }
        const deletedSessionIds = agentIpcCoworkStore.deleteSessionsByAgentId(id);

        // Clean up IM session mappings for deleted sessions
        if (deletedSessionIds.length > 0) {
          try {
            const imStore = deps.getIMGatewayManager()?.getIMStore();
            if (imStore) {
              for (const sessionId of deletedSessionIds) {
                imStore.deleteSessionMappingByCoworkSessionId(sessionId);
              }
            }
          } catch {
            // IM rt.store may not be initialised yet; safe to ignore.
          }

          // Notify renderer to refresh session lists
          const windows = BrowserWindow.getAllWindows();
          for (const win of windows) {
            if (win.isDestroyed()) continue;
            win.webContents.send(CoworkStreamIpc.SessionsChanged, {
              agentId: id,
              deletedSessionIds,
            });
          }
        }

        return { success: true, deleted: result };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete agent',
        };
      }
    },

    agentsImportExpertPackage: async (_event, expertDir) => {
      try {
        const bundledSkillsRoot = deps.getSkillManager().getBundledSkillsRoot();
        const registerExpertModule = require(
          path.join(bundledSkillsRoot, 'zhiyuan-expert-manager', 'scripts', 'register_expert'),
        ) as {
          parseExpertPackage: (...args: unknown[]) => {
            pluginJson: { name?: unknown; version?: unknown; expertType?: unknown };
            requests: Array<{
              id: string;
              name: string;
              description: string;
              systemPrompt: string;
              identity: string;
              icon: string;
              skillIds?: string[];
            }>;
            piSyncedFiles?: string[];
          };
          upsertExpertRegistry: (options: {
            registryPath: string;
            entry: Record<string, unknown>;
            skipIfWithin?: string[];
          }) => void;
        };
        const { parseExpertPackage, upsertExpertRegistry } = registerExpertModule;
        const dbPath = path.join(app.getPath('userData'), DB_FILENAME);
        const localAgentManager = deps.getAgentManager();

        // Re-importing an installed preset upgrades it in place: existing
        // agents are updated, packaged skills are refreshed, and the stale
        // preset registry entry is replaced.
        const packageJson = JSON.parse(
          fs.readFileSync(path.join(expertDir, 'plugin.json'), 'utf-8'),
        ) as { name?: unknown; version?: unknown; expertType?: unknown };
        const isUpgrade =
          typeof packageJson.name === 'string' &&
          localAgentManager.listAgents().some(agent => agent.presetId === packageJson.name);
        const { pluginJson, requests, piSyncedFiles } = parseExpertPackage(expertDir, {
          dbPath,
          update: isUpgrade,
        });

        const defaultModel = deps.resolveDefaultAgentModelRef();
        const agentIds: string[] = [];

        for (const request of requests) {
          // Re-importing an installed preset upgrades it in place instead of
          // failing on the duplicate name — preset updates (system prompt,
          // skills, workflow) must reach already-installed experts.
          const existing = localAgentManager.getAgent(request.id);
          // Only an expert package agent may be upgraded in place. A user-created
          // agent can own the same derived id (ids come from names), and updating
          // it here would silently rename it and replace its system prompt.
          const isExpertAgent =
            existing?.source === CoworkSessionExpertSource.Package ||
            existing?.source === CoworkSessionExpertSource.Member;
          if (existing && isExpertAgent) {
            localAgentManager.updateAgent(existing.id, {
              name: request.name,
              description: request.description,
              systemPrompt: request.systemPrompt,
              identity: request.identity,
              icon: request.icon,
              skillIds: request.skillIds ?? [],
            });
            agentIds.push(existing.id);
          } else {
            const agent = localAgentManager.createAgent(request, defaultModel);
            agentIds.push(agent.id);
          }
        }
        deps.bumpCodingCommandCatalog();

        // Bundled presets are file-sourced (方案A): they never enter the
        // registry. The single registry service (register_expert.js) enforces
        // containment server-side, drops stale bundled records idempotently,
        // and only records user-imported packages.
        const packagesDir = path.join(app.getPath('userData'), 'expert-packages');
        fs.mkdirSync(packagesDir, { recursive: true });
        upsertExpertRegistry({
          registryPath: path.join(packagesDir, 'registry.json'),
          entry: {
            name: pluginJson.name,
            version: pluginJson.version,
            expertType: pluginJson.expertType,
            path: expertDir,
            agentIds,
            piSyncedFiles: piSyncedFiles || [],
            createdAt: new Date().toISOString(),
          },
          skipIfWithin: [bundledSkillsRoot],
        });

        // plugin.json fields are parsed best-effort; the documented contract
        // exposes them as optional strings for the renderer.
        return {
          success: true,
          agentIds,
          expertType: typeof pluginJson.expertType === 'string' ? pluginJson.expertType : undefined,
          name: typeof pluginJson.name === 'string' ? pluginJson.name : undefined,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to import expert package',
        };
      }
    },

    agentsGetPresetExperts: async () => {
      try {
        const bundledSkillsRoot = deps.getSkillManager().getBundledSkillsRoot();
        return { experts: listPresetExperts(bundledSkillsRoot) };
      } catch (error) {
        return {
          experts: [],
          error: error instanceof Error ? error.message : 'Failed to list preset experts',
        };
      }
    },
  });
};
