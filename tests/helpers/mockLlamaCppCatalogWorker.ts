import { vi } from 'vitest';
import { scanLocalGgufModels } from '../../src/main/libs/llamacppModelCatalog';

vi.mock('../../src/main/workbenchTask/artifactWorkerPool', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/main/workbenchTask/artifactWorkerPool')>()),
  scanLocalModelsAsync: async (dir: string) => scanLocalGgufModels(dir),
}));
