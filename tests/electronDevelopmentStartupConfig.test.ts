import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { test } from 'vitest';

const root = path.resolve(__dirname, '..');

test('development startup waits for Vite readiness before launching Electron', () => {
  const viteConfig = readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
  const rendererStyles = readFileSync(path.join(root, 'src', 'renderer', 'index.css'), 'utf8');
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const developmentScript = packageJson.scripts?.['electron:dev'] || '';
  const electronBuildScript = readFileSync(
    path.join(root, 'scripts', 'build-electron-development.mjs'),
    'utf8',
  );
  const preloadEntryIndex = viteConfig.indexOf("entry: 'src/main/preload.ts'");
  const mainEntryIndex = viteConfig.indexOf("entry: 'src/main/main.ts'");

  assert.match(viteConfig, /extractExternalDeps\(packageJson, true\)/);
  assert.match(viteConfig, /electronDevelopmentExternalRoots\.has\(packageRoot\(id\)\)/);
  assert.match(viteConfig, /id\.startsWith\('\\0'\)/);
  assert.match(viteConfig, /path\.isAbsolute\(id\)/);
  assert.match(viteConfig, /!id\.startsWith\('@shared\/'\)/);
  assert.match(viteConfig, /command === ['"]serve['"][\s\S]*isElectronDevelopmentExternal/);
  assert.match(viteConfig, /rolldownOptions:[\s\S]*codeSplitting: false/);
  assert.doesNotMatch(viteConfig, /inlineDynamicImports/);
  assert.doesNotMatch(viteConfig, /rollupOptions/);
  assert.doesNotMatch(viteConfig, /esbuildOptions/);
  assert.match(viteConfig, /optimizeDeps:[\s\S]*entries: \['src\/renderer\/main\.tsx'\]/);
  assert.doesNotMatch(viteConfig, /noDiscovery: true/);
  assert.match(viteConfig, /include:[\s\S]*'react-dom\/client'/);
  assert.match(viteConfig, /include:[\s\S]*'react-redux'/);
  assert.match(viteConfig, /include:[\s\S]*'use-sync-external-store\/shim\/with-selector'/);
  assert.match(viteConfig, /include:[\s\S]*'use-sync-external-store\/with-selector'/);
  assert.match(viteConfig, /include:[\s\S]*'use-sync-external-store\/with-selector\.js'/);
  assert.match(viteConfig, /ignored: ignoreOutsideRendererSources/);
  assert.match(viteConfig, /rendererWatchDirectories = new Set\(\['public', 'src'\]\)/);
  assert.match(viteConfig, /VITE_SKIP_ELECTRON \? \[\] : \[renderer\(\)\]/);
  assert.match(rendererStyles, /@import 'tailwindcss' source\(none\)/);
  assert.match(rendererStyles, /@source "\."/);
  assert.match(rendererStyles, /@source "\.\.\/shared"/);
  assert.ok(preloadEntryIndex >= 0 && preloadEntryIndex < mainEntryIndex);
  assert.match(viteConfig, /entry: 'src\/main\/preload\.ts'[\s\S]*watch: null/);
  assert.match(
    developmentScript,
    /wait-on -l -t 120000 -i 1000 -s 1 http-get:\/\/localhost:5175\/src\/renderer\/main\.tsx http-get:\/\/localhost:5175\/src\/renderer\/index\.css/,
  );
  assert.doesNotMatch(developmentScript, /-d 20000/);
  assert.match(developmentScript, /concurrently --kill-others --kill-signal SIGKILL/);
  assert.doesNotMatch(developmentScript, /compile:electron/);
  assert.match(developmentScript, /build:electron:dev/);
  assert.match(developmentScript, /VITE_SKIP_ELECTRON=1/);
  assert.match(developmentScript, /dist-electron\/\.electron-ready/);
  assert.match(electronBuildScript, /src\/main\/preload\.ts/);
  assert.match(electronBuildScript, /src\/main\/main\.ts/);
  assert.match(electronBuildScript, /fs\.writeFileSync\(readyPath/);
});
