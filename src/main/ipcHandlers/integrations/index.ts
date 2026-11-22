/** Integration IPC: session title, recent cwds and readiness helpers. */
import { generateSessionTitle } from '../../libs/coworkUtil';
import { t } from '../../i18n';
import { appSystemContract } from '../../../shared/ipc/appSystemContract';
import type { MagpieModelService } from '../../magpie/modelService';
import type { CoworkStore } from '../../coworkStore';
import { handleIpcContractSubset } from '../../ipc/handleIpcContract';

export interface IntegrationsIpcDeps {
  isInternalWorkspacePath: (candidate: string) => boolean;
  getCoworkStore: () => CoworkStore;
  checkApiConfig: MagpieModelService['checkReadiness'];
}

export const registerIntegrationsIpc = (deps: IntegrationsIpcDeps): void => {
  handleIpcContractSubset(appSystemContract, {
    generateSessionTitle: async (_event, userInput) => {
      return generateSessionTitle(userInput, t('coworkDefaultSessionTitle'));
    },

    getRecentCwds: async (_event, limit) => {
      const boundedLimit = limit ? Math.min(Math.max(limit, 1), 20) : 8;
      return deps
        .getCoworkStore()
        .listRecentCwds(20)
        .filter(cwd => !deps.isInternalWorkspacePath(cwd))
        .slice(0, boundedLimit);
    },

    checkApiConfig: () => deps.checkApiConfig(),
  });
};
