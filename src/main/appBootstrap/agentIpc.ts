/** Agent IPC: list/get/create/update/delete agents, import/export, expert packages. */
import fs from 'fs';
import path from 'path';

import { app, BrowserWindow, dialog, ipcMain } from 'electron';

import { rt } from './runtimeState';
import { resolveDefaultAgentModelRef } from './messageTriage';
import { getAgentManager, getCoworkStore, getSkillManager, getStore } from './runtimeServices';
import { getIMGatewayManager } from './ccConnectRuntime';
import { bumpCodingCommandCatalog } from './codingRoomRuntime';
import { listAllMatchingSessionIds, forgetCoworkSession } from './coworkSessionImages';
import { listPresetExperts } from '../presetExpertCatalog';
import { DB_FILENAME } from '../appConstants';
import type { CreateAgentRequest, UpdateAgentRequest } from '../coworkStore';
import { CoworkSessionExpertSource } from '../../shared/cowork/sessionExperts';
import { AgentIpcChannel } from '../../shared/agent/constants';
import { CoworkStreamIpc } from '../../shared/ipc/channels';

export const registerAgentIpc = (): void => {
  // ========== Agent IPC Handlers ==========

  ipcMain.handle(AgentIpcChannel.List, async () => {
    try {
      const agents = getAgentManager().listAgents();
      return { success: true, agents };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list agents',
      };
    }
  });

  ipcMain.handle(AgentIpcChannel.Get, async (_event, id: string) => {
    try {
      const agent = getAgentManager().getAgent(id);
      return { success: true, agent };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get agent',
      };
    }
  });

  ipcMain.handle(AgentIpcChannel.Create, async (_event, request: CreateAgentRequest) => {
    try {
      const agent = getAgentManager().createAgent(request, resolveDefaultAgentModelRef());
      bumpCodingCommandCatalog();
      return { success: true, agent };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create agent',
      };
    }
  });

  ipcMain.handle(
    AgentIpcChannel.Update,
    async (_event, id: string, updates: UpdateAgentRequest) => {
      try {
        const agent = getAgentManager().updateAgent(id, updates);
        bumpCodingCommandCatalog();
        return { success: true, agent };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update agent',
        };
      }
    },
  );

  ipcMain.handle(AgentIpcChannel.Delete, async (_event, id: string) => {
    try {
      const result = getAgentManager().deleteAgent(id);
      if (result) bumpCodingCommandCatalog();

      // Cascade delete all Cowork sessions belonging to the deleted agent
      const agentIpcCoworkStore = getCoworkStore();
      for (const sessionId of listAllMatchingSessionIds({ agentId: id })) {
        forgetCoworkSession(sessionId);
      }
      const deletedSessionIds = agentIpcCoworkStore.deleteSessionsByAgentId(id);

      // Clean up IM session mappings for deleted sessions
      if (deletedSessionIds.length > 0) {
        try {
          const imStore = getIMGatewayManager()?.getIMStore();
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
          win.webContents.send(CoworkStreamIpc.SessionsChanged, { agentId: id, deletedSessionIds });
        }
      }

      return { success: true, deleted: result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete agent',
      };
    }
  });

  ipcMain.handle(AgentIpcChannel.ImportExpertPackage, async (_event, expertDir: string) => {
    try {
      const bundledSkillsRoot = getSkillManager().getBundledSkillsRoot();
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
      const localAgentManager = getAgentManager();

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

      const defaultModel = resolveDefaultAgentModelRef();
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
      bumpCodingCommandCatalog();

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

      return { success: true, agentIds, expertType: pluginJson.expertType, name: pluginJson.name };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to import expert package',
      };
    }
  });

  ipcMain.handle(AgentIpcChannel.GetPresetExperts, async () => {
    try {
      const bundledSkillsRoot = getSkillManager().getBundledSkillsRoot();
      return { experts: listPresetExperts(bundledSkillsRoot) };
    } catch (error) {
      return {
        experts: [],
        error: error instanceof Error ? error.message : 'Failed to list preset experts',
      };
    }
  });
};
