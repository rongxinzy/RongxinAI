import fs from 'node:fs';
import path from 'node:path';

export function documentWasmAssets(projectRoot) {
  const packagePath = path.join(projectRoot, 'node_modules', '@firecrawl', 'anydoc-wasm');
  return {
    name: 'document-wasm-assets',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'anydoc_wasm_bg.wasm',
        source: fs.readFileSync(path.join(packagePath, 'anydoc_wasm_bg.wasm')),
      });
      this.emitFile({
        type: 'asset',
        fileName: 'anydoc-wasm.NOTICE.txt',
        source: fs.readFileSync(path.join(packagePath, 'LICENSE')),
      });
    },
  };
}
