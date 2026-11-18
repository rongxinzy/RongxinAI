import fs from 'node:fs';
import path from 'node:path';

import { build } from 'esbuild';
import { afterAll } from 'vitest';

const projectRoot = path.resolve(import.meta.dirname, '../../..');

async function buildDocumentReaderTestWorker() {
  const root = fs.mkdtempSync(path.join(projectRoot, 'node_modules', '.document-reader-test-'));
  const workerPath = path.join(root, 'documentWorker.cjs');
  const dispose = () => fs.rmSync(root, { recursive: true, force: true });
  try {
    await build({
      entryPoints: [path.join(projectRoot, 'src/main/documentReader/documentWorker.ts')],
      bundle: true,
      platform: 'node',
      outfile: workerPath,
    });
    fs.copyFileSync(
      path.join(projectRoot, 'node_modules/@firecrawl/anydoc-wasm/anydoc_wasm_bg.wasm'),
      path.join(root, 'anydoc_wasm_bg.wasm'),
    );
    return { workerPath, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

export async function documentReaderWorkerMock(
  importOriginal: () => Promise<typeof import('../../../src/main/documentReader/officeDocument')>,
) {
  const implementation = await importOriginal();
  let worker: ReturnType<typeof buildDocumentReaderTestWorker> | undefined;
  afterAll(async () => (await worker)?.dispose());
  return {
    async readOfficeDocument(filePath: string, signal: AbortSignal) {
      const { workerPath } = await (worker ??= buildDocumentReaderTestWorker());
      return implementation.readOfficeDocument(filePath, signal, workerPath);
    },
  };
}
