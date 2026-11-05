import type { StrataManager } from '../libs/strata/strataManager';
import type { MagpieHostProvider } from './hostProviders';
import type { StrataStatusSnapshot } from '../../shared/strata/types';
import { StrataServiceStatus } from '../../shared/strata/types';
import { StrataClient } from '../libs/strata/strataClient';

export interface StrataProviderSnapshot {
  baseUrl: string | null;
  models: MagpieHostProvider['models'];
}

/**
 * Builds the Magpie host-provider snapshot from the manager's current status.
 *
 * This deliberately does not call `manager.detect()`: status listeners already
 * run inside a status transition, so re-probing here would create the
 * detect -> status event -> binding refresh -> detect loop (#1406).
 */
export async function readStrataProviderSnapshot(
  manager: Pick<StrataManager, 'getStatus' | 'baseUrl' | 'resolvePort'>,
  status: StrataStatusSnapshot = manager.getStatus(),
): Promise<StrataProviderSnapshot> {
  if (status.status !== StrataServiceStatus.Running) {
    return { baseUrl: null, models: [] };
  }
  const port = manager.resolvePort();
  const baseUrl = status.baseUrl ?? manager.baseUrl() ?? `http://127.0.0.1:${port}/v1`;
  const client = new StrataClient(`http://127.0.0.1:${port}`);
  const models = await client.listModels();
  return {
    baseUrl,
    models: models.map(model => ({
      id: model.id,
      name: model.name ?? model.id,
      input: ['text' as const],
    })),
  };
}
