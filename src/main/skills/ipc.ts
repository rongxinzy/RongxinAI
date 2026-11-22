/**
 * Skills IPC: list/enable/pin/delete/config and ModelScope marketplace access
 * (work package I: domain-owned registration, `registerXxxIpc(deps)` shape —
 * no appBootstrap imports).
 */
import { session } from 'electron';

import type { SkillManager } from '../skillManager';
import type { SqliteStore } from '../sqliteStore';
import {
  fetchModelScopeSkillContent,
  fetchModelScopeSkillMarketplace,
} from '../libs/modelscopeSkillMarketplace';
import { createModelScopeTokenPool, ModelScopeStoreKey } from '../libs/modelscopeTokenPool';
import { handleIpcContract } from '../ipc/handleIpcContract';
import { skillsContract } from '../../shared/ipc/skillsContract';

export interface SkillsIpcDeps {
  getSkillManager: () => SkillManager;
  getStore: () => SqliteStore;
}

export const registerSkillsIpc = (deps: SkillsIpcDeps): void => {
  const readyManager = async (): Promise<SkillManager> => {
    const manager = deps.getSkillManager();
    await manager.prepareBundledSkills();
    return manager;
  };
  handleIpcContract(skillsContract, {
    list: async () => {
      try {
        const skills = await deps.getSkillManager().listSkills();
        return { success: true, skills };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to load skills',
        };
      }
    },

    setEnabled: async (_event, options) => {
      try {
        const skills = await (await readyManager()).setSkillEnabled(options.id, options.enabled);
        return { success: true, skills };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update skill',
        };
      }
    },

    setEnabledBatch: async (_event, options) => {
      try {
        const skills = await (await readyManager()).setSkillsEnabled(options.ids, options.enabled);
        return { success: true, skills };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update skills',
        };
      }
    },

    setPinned: async (_event, options) => {
      try {
        const skills = await (await readyManager()).setSkillPinned(options.id, options.pinned);
        return { success: true, skills };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update skill',
        };
      }
    },

    createCustom: async (_event, params) => (await readyManager()).createCustomSkill(params),

    delete: async (_event, id) => {
      try {
        const skills = await (await readyManager()).deleteSkill(id);
        return { success: true, skills };
      } catch (error) {
        console.error('[skills] Failed to delete skill:', id, error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete skill',
        };
      }
    },

    download: async (_event, source, options) =>
      (await readyManager()).downloadSkill(source, options),

    confirmInstall: async (_event, pendingId, action) =>
      (await readyManager()).confirmPendingInstall(pendingId, action),

    getContent: (_event, skillId) => deps.getSkillManager().getSkillContent(skillId),

    getConfig: (_event, skillId) => deps.getSkillManager().getSkillConfig(skillId),

    setConfig: async (_event, skillId, config) =>
      (await readyManager()).setSkillConfig(skillId, config),

    testEmailConnectivity: async (_event, skillId, config) =>
      (await readyManager()).testEmailConnectivity(skillId, config),

    fetchMarketplace: async (_event, options) => {
      try {
        const userToken = deps.getStore().get<string>(ModelScopeStoreKey.ApiToken);
        const token = createModelScopeTokenPool({
          extraTokens: userToken ? [userToken] : [],
        }).nextToken();
        console.log('[SkillMarketplace] fetching skills from ModelScope OpenAPI');
        const data = await fetchModelScopeSkillMarketplace({
          token,
          pageNumber: options?.pageNumber,
          pageSize: options?.pageSize,
          fetchImpl: (input, init) =>
            session.defaultSession.fetch(input, init as RequestInit) as unknown as ReturnType<
              typeof fetch
            >,
        });
        return { success: true, data };
      } catch (error) {
        console.error('[SkillMarketplace] fetch error:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to fetch skill marketplace',
        };
      }
    },

    fetchMarketplaceContent: async (_event, skillId) => {
      try {
        const userToken = deps.getStore().get<string>(ModelScopeStoreKey.ApiToken);
        const token = createModelScopeTokenPool({
          extraTokens: userToken ? [userToken] : [],
        }).nextToken();
        const content = await fetchModelScopeSkillContent(skillId, {
          token,
          fetchImpl: (input, init) =>
            session.defaultSession.fetch(input, init as RequestInit) as unknown as ReturnType<
              typeof fetch
            >,
        });
        return { success: true, content };
      } catch (error) {
        console.warn('[SkillMarketplace] content fetch failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to fetch skill content',
        };
      }
    },
  });
};
