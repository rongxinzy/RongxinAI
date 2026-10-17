/** Skills IPC: list/enable/pin/delete/config and ModelScope marketplace access. */
import { ipcMain } from 'electron';

import { getSkillManager } from './runtimeServices';
import { getStore } from './runtimeServices';
import { session } from 'electron';

import {
  fetchModelScopeSkillContent,
  fetchModelScopeSkillMarketplace,
} from '../libs/modelscopeSkillMarketplace';
import { createModelScopeTokenPool, ModelScopeStoreKey } from '../libs/modelscopeTokenPool';
import { SkillsIpc } from '../../shared/ipc/channels';

export const registerSkillsIpc = (): void => {
  // Skills IPC handlers
  ipcMain.handle('skills:list', () => {
    try {
      const skills = getSkillManager().listSkills();
      return { success: true, skills };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load skills',
      };
    }
  });

  ipcMain.handle(SkillsIpc.SetEnabled, (_event, options: { id: string; enabled: boolean }) => {
    try {
      const skills = getSkillManager().setSkillEnabled(options.id, options.enabled);
      return { success: true, skills };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update skill',
      };
    }
  });

  ipcMain.handle(
    SkillsIpc.SetEnabledBatch,
    (_event, options: { ids: string[]; enabled: boolean }) => {
      try {
        const skills = getSkillManager().setSkillsEnabled(options.ids, options.enabled);
        return { success: true, skills };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update skills',
        };
      }
    },
  );

  ipcMain.handle(SkillsIpc.SetPinned, (_event, options: { id: string; pinned: boolean }) => {
    try {
      const skills = getSkillManager().setSkillPinned(options.id, options.pinned);
      return { success: true, skills };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update skill',
      };
    }
  });

  ipcMain.handle('skills:delete', async (_event, id: string) => {
    try {
      const skills = await getSkillManager().deleteSkill(id);
      return { success: true, skills };
    } catch (error) {
      console.error('[skills] Failed to delete skill:', id, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete skill',
      };
    }
  });

  ipcMain.handle(
    'skills:download',
    async (_event, source: string, options?: { iconUrl?: string; displayName?: string }) => {
      return getSkillManager().downloadSkill(source, options);
    },
  );

  ipcMain.handle('skills:confirmInstall', async (_event, pendingId: string, action: string) => {
    const validActions = ['install', 'installDisabled', 'cancel'];
    if (!validActions.includes(action)) {
      return { success: false, error: 'Invalid action' };
    }
    return getSkillManager().confirmPendingInstall(
      pendingId,
      action as 'install' | 'installDisabled' | 'cancel',
    );
  });

  ipcMain.handle('skills:getRoot', () => {
    try {
      const root = getSkillManager().getSkillsRoot();
      return { success: true, path: root };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to resolve skills root',
      };
    }
  });

  ipcMain.handle(SkillsIpc.GetContent, async (_event, skillId: string) => {
    return getSkillManager().getSkillContent(skillId);
  });

  ipcMain.handle('skills:autoRoutingPrompt', () => {
    try {
      const prompt = getSkillManager().buildAutoRoutingPrompt();
      return { success: true, prompt };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to build auto-routing prompt',
      };
    }
  });

  ipcMain.handle('skills:getConfig', (_event, skillId: string) => {
    return getSkillManager().getSkillConfig(skillId);
  });

  ipcMain.handle(
    'skills:setConfig',
    async (_event, skillId: string, config: Record<string, string>) => {
      const result = getSkillManager().setSkillConfig(skillId, config);
      return result;
    },
  );

  ipcMain.handle(
    'skills:testEmailConnectivity',
    async (_event, skillId: string, config: Record<string, string>) => {
      return getSkillManager().testEmailConnectivity(skillId, config);
    },
  );

  ipcMain.handle(
    SkillsIpc.FetchMarketplace,
    async (_event, options?: { pageNumber?: number; pageSize?: number }) => {
      try {
        const userToken = getStore().get<string>(ModelScopeStoreKey.ApiToken);
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
  );

  ipcMain.handle(SkillsIpc.FetchMarketplaceContent, async (_event, skillId: string) => {
    try {
      const userToken = getStore().get<string>(ModelScopeStoreKey.ApiToken);
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
  });
};
