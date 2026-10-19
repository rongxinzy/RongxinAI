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
  handleIpcContract(skillsContract, {
    list: () => {
      try {
        const skills = deps.getSkillManager().listSkills();
        return { success: true, skills };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to load skills',
        };
      }
    },

    setEnabled: (_event, options) => {
      try {
        const skills = deps.getSkillManager().setSkillEnabled(options.id, options.enabled);
        return { success: true, skills };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update skill',
        };
      }
    },

    setEnabledBatch: (_event, options) => {
      try {
        const skills = deps.getSkillManager().setSkillsEnabled(options.ids, options.enabled);
        return { success: true, skills };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update skills',
        };
      }
    },

    setPinned: (_event, options) => {
      try {
        const skills = deps.getSkillManager().setSkillPinned(options.id, options.pinned);
        return { success: true, skills };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update skill',
        };
      }
    },

    createCustom: (_event, params) => deps.getSkillManager().createCustomSkill(params),

    delete: async (_event, id) => {
      try {
        const skills = await deps.getSkillManager().deleteSkill(id);
        return { success: true, skills };
      } catch (error) {
        console.error('[skills] Failed to delete skill:', id, error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete skill',
        };
      }
    },

    download: (_event, source, options) => deps.getSkillManager().downloadSkill(source, options),

    confirmInstall: (_event, pendingId, action) =>
      deps.getSkillManager().confirmPendingInstall(pendingId, action),

    getRoot: () => {
      try {
        const root = deps.getSkillManager().getSkillsRoot();
        return { success: true, path: root };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to resolve skills root',
        };
      }
    },

    getContent: (_event, skillId) => deps.getSkillManager().getSkillContent(skillId),

    autoRoutingPrompt: () => {
      try {
        const prompt = deps.getSkillManager().buildAutoRoutingPrompt();
        return { success: true, prompt };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to build auto-routing prompt',
        };
      }
    },

    getConfig: (_event, skillId) => deps.getSkillManager().getSkillConfig(skillId),

    setConfig: (_event, skillId, config) => deps.getSkillManager().setSkillConfig(skillId, config),

    testEmailConnectivity: (_event, skillId, config) =>
      deps.getSkillManager().testEmailConnectivity(skillId, config),

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
