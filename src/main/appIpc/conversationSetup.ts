import { generateSessionTitle } from '../libs/coworkUtil';
import { t } from '../i18n';
import { appSystemContract } from '../../shared/ipc/appSystemContract';
import { handleIpcContractSubset } from '../ipc/handleIpcContract';
import type { CoworkStore } from '../coworkStore';
import type { MagpieModelService } from '../magpie/modelService';

export interface ConversationSetupIpcDeps {
  getCoworkStore: () => Pick<CoworkStore, 'listRecentCwds'>;
  getMagpieModelService: () => Pick<MagpieModelService, 'checkReadiness'> | undefined;
  isInternalWorkspacePath: (candidate: string) => boolean;
}

/** Conversation setup remains available independently of external messaging. */
export function registerConversationSetupIpc(deps: ConversationSetupIpcDeps): void {
  handleIpcContractSubset(appSystemContract, {
    generateSessionTitle: async (_event, userInput) =>
      generateSessionTitle(userInput, t('coworkDefaultSessionTitle')),
    getRecentCwds: async (_event, limit) => {
      const boundedLimit = limit ? Math.min(Math.max(limit, 1), 20) : 8;
      return deps
        .getCoworkStore()
        .listRecentCwds(20)
        .filter(cwd => !deps.isInternalWorkspacePath(cwd))
        .slice(0, boundedLimit);
    },
    // Resolve lazily: IPC registration happens before the model service starts.
    checkApiConfig: async () =>
      deps.getMagpieModelService()?.checkReadiness() ?? { hasConfig: false, config: null },
  });
}
