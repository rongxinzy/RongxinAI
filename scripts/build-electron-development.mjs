import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite-plugin-electron';
import { extractExternalDeps } from 'vite-plugin-electron/plugin';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const outputDirectory = path.join(projectRoot, 'dist-electron');
const readyPath = path.join(outputDirectory, '.electron-ready');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const externalRoots = new Set(extractExternalDeps(packageJson, true));

function packageRoot(specifier) {
  return specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
}

function isDevelopmentExternal(id) {
  if (externalRoots.has(packageRoot(id))) return true;
  if (id.startsWith('\0') || id.startsWith('.') || path.isAbsolute(id)) return false;
  return !id.startsWith('@shared/') && !id.startsWith('@/');
}

function createBuildOptions(entry, extraBuildOptions = {}) {
  return {
    entry,
    vite: {
      root: projectRoot,
      build: {
        outDir: outputDirectory,
        emptyOutDir: false,
        minify: false,
        sourcemap: true,
        rolldownOptions: {
          external: isDevelopmentExternal,
          ...extraBuildOptions,
        },
      },
    },
  };
}

function copyPhotonWasm() {
  const sourceCandidates = [
    path.join(
      projectRoot,
      'node_modules/@earendil-works/pi-coding-agent/node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm',
    ),
    path.join(projectRoot, 'node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm'),
  ];
  const source = sourceCandidates.find(candidate => fs.existsSync(candidate));
  if (!source) {
    console.warn('[ElectronDevBuild] Photon WASM asset was not found.');
    return;
  }
  fs.copyFileSync(source, path.join(outputDirectory, 'photon_rs_bg.wasm'));
}

fs.mkdirSync(outputDirectory, { recursive: true });
fs.rmSync(readyPath, { force: true });

await build(createBuildOptions('src/main/preload.ts'));
await build(
  createBuildOptions('src/main/main.ts', {
    output: {
      codeSplitting: false,
    },
  }),
);

copyPhotonWasm();
fs.writeFileSync(readyPath, '');
console.log('[ElectronDevBuild] Main and preload bundles are ready.');
