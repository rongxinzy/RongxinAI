/**
 * Official-site screenshot demo for the browser preview (`?previewScenario=site`).
 * Localized by `previewLocale` (zh-CN default, en-US for the English site). Used by
 * scripts/site-screenshots/capture.mjs.
 */
import type { MagpieModelCatalog } from '../../../shared/magpie/types';
import type { DeepPartial } from '../scenarioTypes';
import { readPreviewLocale } from '../previewQuery';
import { mockAgents, type MockSession } from '../fixtures';
import {
  pick,
  SITE_NOW,
  siteSessions,
  siteSkills,
  siteWorkspaces,
  type SiteDemoLang,
} from './content';
import { readPresetExpertPackageMetadata } from '../../../shared/expert/presetPackageMetadata';
import { siteLocalModels, siteMarketplace } from './models';

type ElectronApi = Window['electron'];
type ListOptions = Parameters<ElectronApi['cowork']['listSessions']>[0];
type PresetExperts = Awaited<ReturnType<ElectronApi['agents']['getPresetExperts']>>['experts'];
type PresetPlugin = Omit<
  PresetExperts[number],
  'workflow' | 'path' | 'categoryId' | 'tags' | 'quickPrompts'
> &
  Partial<Pick<PresetExperts[number], 'categoryId' | 'tags' | 'quickPrompts'>>;

// Shipped expert presets, so the Expert page shows real bundled content.
const presetFiles = import.meta.glob<PresetPlugin>(
  '../../../../SKILLs/zhiyuan-expert-manager/presets/*/plugin.json',
  { eager: true, import: 'default' },
);

function presetExperts(): PresetExperts {
  return Object.entries(presetFiles)
    .filter(([, preset]) => preset.name !== 'presales-technical-consultant')
    .map(([file, preset]) => {
      const packageMetadata = readPresetExpertPackageMetadata(
        preset as Record<string, unknown>,
      );
      return {
        name: preset.name,
        displayName: preset.displayName,
        profession: preset.profession,
        displayDescription: preset.displayDescription,
        categoryId: preset.categoryId ?? '',
        tags: preset.tags ?? [],
        quickPrompts: preset.quickPrompts ?? [],
        workflow: [],
        path: file,
        mcpIds: packageMetadata.mcpIds,
        pythonRequirements: packageMetadata.pythonRequirements,
        pypiMirrors: packageMetadata.pypiMirrors,
      };
    });
}

const catalog: MagpieModelCatalog = {
  status: { state: 'running', version: '1.0.0', enabled: true },
  defaultModelId: 'qwen3-8b',
  models: [
    {
      id: 'qwen3-8b',
      owned_by: 'llama.cpp',
      display_name: 'Qwen3 8B',
      context_window: 32768,
      reasoning: true,
      modalities: { input: ['text'], output: ['text'] },
    },
    {
      id: 'deepseek-v3',
      owned_by: 'deepseek',
      display_name: 'DeepSeek V3',
      context_window: 128000,
      reasoning: false,
      modalities: { input: ['text'], output: ['text'] },
    },
  ],
};

function summaryOf(session: MockSession) {
  const {
    messages: _messages,
    messagesOffset: _offset,
    totalMessages: _total,
    ...summary
  } = session;
  return summary;
}

export function createSiteDemoOverrides(): DeepPartial<ElectronApi> {
  const lang: SiteDemoLang = readPreviewLocale() === 'en-US' ? 'en' : 'zh';
  const workspaces = siteWorkspaces(lang);
  const sessions = siteSessions(lang);
  const byId = new Map(sessions.map(session => [session.id, session]));
  const market = siteMarketplace(lang);
  const checkedAt = new Date(SITE_NOW).toISOString();
  const agents = mockAgents.map(agent => ({
    ...agent,
    name: pick(lang, '知远', 'ZhiYuan'),
    description: pick(lang, '通用办公助手', 'General-purpose work assistant'),
  }));
  return {
    appInfo: {
      getSystemLocale: () => Promise.resolve(lang === 'zh' ? 'zh-CN' : 'en-US'),
      isDev: () => Promise.resolve(false),
    },
    hardware: {
      nvidiaSmi: () =>
        Promise.resolve({
          source: 'nvidia-smi',
          available: true,
          checkedAt,
          driverVersion: '566.36',
          gpus: [
            {
              index: 0,
              name: 'NVIDIA GeForce RTX 4070',
              memoryTotalMiB: 12282,
              memoryFreeMiB: 11020,
            },
          ],
        }),
      systemMemory: () =>
        Promise.resolve({
          source: 'system',
          available: true,
          checkedAt,
          totalMemoryMiB: 32768,
          freeMemoryMiB: 21500,
        }),
    },
    marketplace: {
      search: ({ params }) => {
        const task = params.task ?? 'all';
        const models =
          task === 'all' ? market : market.filter(model => model.capabilities?.includes(task));
        return Promise.resolve({
          models,
          totalCount: models.length,
          hasMore: false,
          source: 'curated',
        });
      },
    },
    llamacpp: {
      listLocalModels: () => Promise.resolve(siteLocalModels()),
      listRunningModels: () =>
        Promise.resolve(
          siteLocalModels()
            .filter(model => model.status === 'loaded')
            .map(model => ({ ...model, context_length: 32768, runtime_context_length: 32768 })),
        ),
      modelsDir: () => Promise.resolve('/Users/lin/.zhiyuan/models'),
    },
    magpie: {
      catalog: () => Promise.resolve(catalog),
      models: () => Promise.resolve(catalog.models),
      status: () => Promise.resolve(catalog.status),
      selectDefault: () => Promise.resolve(catalog),
    },
    getRecentCwds: () => Promise.resolve(workspaces.map(workspace => workspace.path)),
    agents: {
      list: () => Promise.resolve(agents),
      get: (id: string) => Promise.resolve(agents.find(agent => agent.id === id) ?? null),
      getPresetExperts: () => Promise.resolve({ experts: presetExperts() }),
    },
    skills: { list: () => Promise.resolve({ success: true, skills: siteSkills(lang) }) },
    cowork: {
      listWorkspaces: () => Promise.resolve({ success: true, workspaces }),
      listSessions: (options?: ListOptions) => {
        const matched = sessions.filter(
          session =>
            (!options?.workspaceId || session.workspaceId === options.workspaceId) &&
            (!options?.mode || options.mode === session.mode) &&
            (!options?.sources || options.sources.includes(session.source)),
        );
        const offset = options?.offset ?? 0;
        const limit = options?.limit ?? matched.length;
        return Promise.resolve({
          success: true,
          sessions: matched.slice(offset, offset + limit).map(summaryOf),
          hasMore: offset + limit < matched.length,
        });
      },
      getSession: (sessionId: string) => {
        const session = byId.get(sessionId);
        return Promise.resolve(
          session ? { success: true, session } : { success: false, error: 'Session not found' },
        );
      },
      getSessionMessages: ({ sessionId }: { sessionId: string }) => {
        const messages = byId.get(sessionId)?.messages ?? [];
        return Promise.resolve({ success: true, messages, offset: 0, total: messages.length });
      },
    },
  };
}
