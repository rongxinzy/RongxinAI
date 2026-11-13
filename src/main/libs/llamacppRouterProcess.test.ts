import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { upsertLlamaCppRouterModelPresetSection } from './llamacppRouterProcess';

describe('upsertLlamaCppRouterModelPresetSection', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('writes sibling mmproj into the model preset section (b12359 router)', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-preset-mmproj-'));
    dirs.push(workDir);
    const modelDir = path.join(workDir, 'repo');
    fs.mkdirSync(modelDir, { recursive: true });
    const modelPath = path.join(modelDir, 'SmolVLM-256M-Instruct-Q4_K_M.gguf');
    const mmprojPath = path.join(modelDir, 'mmproj-SmolVLM-256M-Instruct-f16.gguf');
    fs.writeFileSync(modelPath, 'model');
    fs.writeFileSync(mmprojPath, 'mmproj');
    const presetPath = path.join(workDir, 'models-preset.ini');
    fs.writeFileSync(presetPath, 'version = 1\n\n', 'utf8');

    upsertLlamaCppRouterModelPresetSection({
      presetPath,
      modelName: 'SmolVLM-256M-Instruct-Q4_K_M',
      modelPath,
      options: { gpuLayers: 0 },
    });

    const source = fs.readFileSync(presetPath, 'utf8');
    expect(source).toContain(`model = ${modelPath}`);
    expect(source).toContain(`mmproj = ${mmprojPath}`);
  });
});
