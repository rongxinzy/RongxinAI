import type { StrataManager } from '../libs/strata/strataManager';
import type { MagpieHostProvider } from './hostProviders';
import { StrataClient } from '../libs/strata/strataClient';
import { StrataServiceStatus } from '../../shared/strata/types';

export interface StrataProviderSnapshot {
  baseUrl: string | null;
  models: MagpieHostProvider['models'];
}

export async function readStrataProviderSnapshot(
  manager: Pick<StrataManager, 'detect' | 'baseUrl' | 'resolvePort'>,
): Promise<StrataProviderSnapshot> {
  const status = await manager.detect();
  if (status.status !== StrataServiceStatus.Running) {
    return { baseUrl: null, models: [] };
  }
  const port = manager.resolvePort();
  const baseUrl = manager.baseUrl() ?? `http://127.0.0.1:${port}/v1`;
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
