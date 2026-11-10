import { mockDefenseExperts, mockDefenseSkills } from './fixtures/defense';
import { PreviewEdition } from './previewQuery';
import type { DeepPartial } from './scenarioTypes';

type ElectronApi = Window['electron'];

export function createEditionOverrides(
  edition: PreviewEdition,
): DeepPartial<ElectronApi> | undefined {
  if (edition !== PreviewEdition.Defense) return undefined;
  return {
    agents: {
      getPresetExperts: () => Promise.resolve({ experts: mockDefenseExperts }),
    },
    skills: {
      list: () => Promise.resolve({ success: true, skills: mockDefenseSkills }),
    },
    mcp: {
      list: () => Promise.resolve({ success: true, servers: [] }),
      fetchMarketplace: () =>
        Promise.resolve({ success: true, data: { categories: [], servers: [] } }),
    },
  };
}
