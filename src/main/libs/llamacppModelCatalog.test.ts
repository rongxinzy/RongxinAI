import fs from 'fs';
import os from 'os';
import path from 'path';
import { expect, test } from 'vitest';

import { scanLocalGgufModels } from './llamacppModelCatalog';

test.each([
  'mmproj-F16.gguf',
  'Vision-Model-mmproj-F16.gguf',
  'Vision-Model.mmproj.F16.gguf',
])('scanLocalGgufModels excludes the mmproj file %s', mmprojFileName => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-mmproj-filter-'));
  const modelDir = path.join(modelsDir, 'Vision-Model');
  fs.mkdirSync(modelDir, { recursive: true });
  fs.writeFileSync(path.join(modelDir, 'Vision-Model-Q4_K_M.gguf'), 'model');
  fs.writeFileSync(path.join(modelDir, mmprojFileName), 'projection');

  const models = scanLocalGgufModels(modelsDir);

  expect(models).toHaveLength(1);
  expect(path.basename(models[0].path ?? '')).toBe('Vision-Model-Q4_K_M.gguf');
});
