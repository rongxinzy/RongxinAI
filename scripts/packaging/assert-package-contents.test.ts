import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, expect, test } from 'vitest';

import {
  applyPackagingExcludes,
  findAsarViolations,
  isForbiddenPackagedBasename,
  pinElectronLanguages,
  pruneChromiumLocales,
  walkForbiddenFiles,
} from './assert-package-contents.cjs';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createTempDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'package-contents-'));
  temporaryDirectories.push(directory);
  return directory;
}

test('secret and map filenames are rejected without treating code modules as tokens', () => {
  expect(isForbiddenPackagedBasename('modelscope.tokens.local.json')).toBe(true);
  expect(isForbiddenPackagedBasename('api.token.json')).toBe(true);
  expect(isForbiddenPackagedBasename('tokens.json')).toBe(true);
  expect(isForbiddenPackagedBasename('.env')).toBe(true);
  expect(isForbiddenPackagedBasename('.env.local')).toBe(true);
  expect(isForbiddenPackagedBasename('main.js.map')).toBe(true);
  expect(isForbiddenPackagedBasename('tokens.py')).toBe(false);
  expect(isForbiddenPackagedBasename('tokens.pyi')).toBe(false);
  expect(isForbiddenPackagedBasename('upstream.json')).toBe(false);
});

test('an empty platform language list does not override the root locale set', () => {
  const config = {
    electronLanguages: ['en-US', 'zh-CN'],
    linux: { electronLanguages: [] as string[] },
    win: {},
    mac: { electronLanguages: ['fr'] },
  };

  expect(pinElectronLanguages(config)).toEqual(['en-US', 'zh-CN']);
  expect(config.linux.electronLanguages).toEqual(['en-US', 'zh-CN']);
  expect(config.win.electronLanguages).toEqual(['en-US', 'zh-CN']);
  expect(config.mac.electronLanguages).toEqual(['fr']);
});

test('locale pruning keeps only configured Chromium packs', () => {
  const appOutDir = createTempDir();
  const locales = path.join(appOutDir, 'locales');
  fs.mkdirSync(locales);
  fs.writeFileSync(path.join(locales, 'en-US.pak'), 'en');
  fs.writeFileSync(path.join(locales, 'de.pak'), 'de');
  fs.writeFileSync(path.join(locales, 'zh-CN.pak'), 'zh');

  pruneChromiumLocales(appOutDir, ['en-US', 'zh-CN']);

  expect(fs.readdirSync(locales).sort()).toEqual(['en-US.pak', 'zh-CN.pak']);
});

test('unpackaged trees fail when a token file or source map is present', () => {
  const appOutDir = createTempDir();
  fs.mkdirSync(path.join(appOutDir, 'resources'), { recursive: true });
  fs.writeFileSync(
    path.join(appOutDir, 'resources', 'modelscope.tokens.local.json'),
    '{"tokens":[]}',
  );
  fs.writeFileSync(path.join(appOutDir, 'preload.js.map'), '{"version":3}');
  fs.writeFileSync(path.join(appOutDir, 'tokens.py'), 'print("ok")');

  expect(walkForbiddenFiles(appOutDir)).toEqual([
    'preload.js.map',
    'resources/modelscope.tokens.local.json',
  ]);
});

test('asar checks reject renderer packages, secret paths, and unexpected roots', () => {
  const allowed = new Set(['electron-updater', 'debug']);
  expect(
    findAsarViolations(
      [
        'node_modules/debug/package.json',
        'node_modules/react-dom/package.json',
        'node_modules/shiki/package.json',
        'dist-electron/main.js.map',
        'node_modules/electron-updater/package.json',
        '.cache/magpie/go-build/x',
        'src/main/main.ts',
        'resources/SYSTEM_PROMPT.md',
        'resources/ocr/model.bin',
      ],
      allowed,
    ),
  ).toEqual([
    '.cache',
    'dist-electron/main.js.map',
    'node_modules/react-dom',
    'node_modules/shiki',
    'resources/ocr/model.bin',
    'src',
  ]);
});

test('packaging excludes stay on existing filesets and do not add ignore-only patterns', () => {
  const config = {
    files: [
      { filter: ['package.json', 'resources/SYSTEM_PROMPT.md'] },
      { from: 'dist', to: 'dist', filter: ['**/*'] },
    ],
    extraResources: [{ from: 'resources/tray', to: 'tray', filter: ['**/*'] }],
    linux: { extraResources: [{ from: 'SKILLs', to: 'SKILLs' }] },
    win: {},
    mac: {},
  };

  applyPackagingExcludes(config);

  const root = config.files[0] as { filter: string[] };
  const dist = config.files[1] as { filter: string[] };
  expect(root.filter).toContain('package.json');
  expect(root.filter).toContain('!node_modules/react-dom/**');
  expect(root.filter).toContain('!node_modules/shiki/**');
  expect(root.filter).not.toContain('**/*');
  expect(config.files.some(entry => typeof entry === 'string')).toBe(false);
  expect(dist.filter).toContain('!**/*.map');
  expect(dist.filter).toContain('!*.map');
  expect(dist.filter).toContain('!**/*.local.json');
  expect(config.extraResources[0].filter).toContain('!**/*.local.json');
  expect(config.linux.extraResources[0].filter).toContain('!**/tokens.json');
});

test('normalized builder config still excludes the repository after packaging excludes', () => {
  const require = createRequire(import.meta.url);
  const { doMergeConfigs } = require('app-builder-lib/out/util/config/config.js') as {
    doMergeConfigs: (configs: unknown[]) => {
      files: Array<{ from?: string; filter?: string[] }>;
    };
  };
  const { getMainFileMatchers } = require('app-builder-lib/out/fileMatcher.js') as {
    getMainFileMatchers: (
      appDir: string,
      destination: string,
      macroExpander: (value: string) => string,
      platformOptions: object,
      platformPackager: { info: object },
      outDir: string,
      isElectronCompile: boolean,
    ) => Array<{ from: string; patterns: string[] }>;
  };
  const { AppFileWalker } = require('app-builder-lib/out/util/AppFileWalker.js') as {
    AppFileWalker: new (
      matcher: { patterns: string[] },
      packager: object,
    ) => {
      filter: (file: string, stat: { isDirectory: () => boolean }) => boolean;
    };
  };
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const raw = JSON.parse(fs.readFileSync(path.join(projectRoot, 'electron-builder.json'), 'utf8'));
  const config = doMergeConfigs([raw]);
  applyPackagingExcludes(config);

  const packager = {
    info: {
      projectDir: projectRoot,
      buildResourcesDir: 'build',
      config,
      isPrepackedAppAsar: false,
      areNodeModulesHandledExternally: false,
      debugLogger: { isEnabled: false },
    },
  };
  const matchers = getMainFileMatchers(
    projectRoot,
    path.join(projectRoot, 'release', 'app'),
    value => value,
    {},
    packager,
    path.join(projectRoot, 'release'),
    false,
  );
  const directory = { isDirectory: () => true };
  const file = { isDirectory: () => false };
  const rootMatchers = matchers.filter(matcher => matcher.from === projectRoot);
  expect(rootMatchers.length).toBeGreaterThan(0);
  for (const matcher of rootMatchers) {
    const walker = new AppFileWalker(matcher, packager.info);
    expect(matcher.patterns.includes('**/*')).toBe(false);
    expect(walker.filter(path.join(projectRoot, '.cache'), directory)).toBe(false);
    expect(walker.filter(path.join(projectRoot, 'src'), directory)).toBe(false);
    expect(walker.filter(path.join(projectRoot, 'package.json'), file)).toBe(true);
  }
});
