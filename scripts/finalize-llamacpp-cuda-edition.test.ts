import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { assertNoNvidiaDriverLibraries } from './finalize-llamacpp-cuda-edition.cjs';

const temporaryDirectories: string[] = [];

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-cuda-finalize-'));
  temporaryDirectories.push(root);
  return root;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('finalizeLlamaCppCudaEdition', () => {
  test('assertNoNvidiaDriverLibraries rejects libcuda.so in tree', () => {
    const root = tempRoot();
    fs.mkdirSync(path.join(root, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(root, 'nested', 'libcuda.so.1'), 'stub');
    expect(() => assertNoNvidiaDriverLibraries(root)).toThrow('driver library');
  });

  test('assertNoNvidiaDriverLibraries allows other CUDA runtime libs', () => {
    const root = tempRoot();
    fs.writeFileSync(path.join(root, 'libcudart.so.12'), 'runtime');
    expect(() => assertNoNvidiaDriverLibraries(root)).not.toThrow();
  });
});
