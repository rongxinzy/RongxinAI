/**
 * Scenario-specific overrides for browser preview interaction tests and local walkthroughs.
 */
import {
  PreviewEdition as PreviewEditionConst,
  PreviewScenario,
  type PreviewEdition,
} from './previewQuery';
import type { DeepPartial } from './scenarioTypes';
import { createSiteDemoOverrides } from './siteDemo';

type ElectronApi = Window['electron'];

export function editionWindowInjection(edition: PreviewEdition): void {
  if (edition === PreviewEditionConst.Xiaoruan) {
    (window as unknown as { __APP_EDITION__?: string }).__APP_EDITION__ =
      PreviewEditionConst.Xiaoruan;
  }
}

export function createScenarioOverrides(
  scenario: PreviewScenario,
): DeepPartial<ElectronApi> | undefined {
  switch (scenario) {
    case PreviewScenario.Empty:
      return {
        cowork: {
          listSessions: () => Promise.resolve({ success: true, sessions: [] }),
          listWorkspaces: () => Promise.resolve({ success: true, workspaces: [] }),
        },
        skills: {
          list: () => Promise.resolve({ success: true, skills: [] }),
        },
        mcp: {
          list: () => Promise.resolve({ success: true, servers: [] }),
        },
        todo: {
          list: () => Promise.resolve({ success: true, items: [] }),
        },
        activity: {
          list: () => Promise.resolve({ success: true, runs: [] }),
        },
        scheduledTasks: {
          list: () => Promise.resolve({ success: true, tasks: [] }),
        },
      };
    case PreviewScenario.Error:
      return {
        enterprise: {
          getConfig: () =>
            Promise.reject(new Error('Preview scenario: simulated bootstrap failure')),
        },
      };
    case PreviewScenario.Loading:
      return {
        llamacpp: {
          status: () =>
            Promise.resolve({
              status: 'starting' as const,
              version: 'preview',
              managedByApp: true,
              checkedAt: '2026-10-16T07:00:00.000Z',
            }),
          listLocalModels: () => new Promise(() => undefined),
          listRunningModels: () => new Promise(() => undefined),
        },
      };
    case PreviewScenario.Site:
      return createSiteDemoOverrides();
    default:
      return undefined;
  }
}
