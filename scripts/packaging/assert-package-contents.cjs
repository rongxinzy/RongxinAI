'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Patterns that must never enter an installer. Matched against file basenames
// only, so Python modules such as tokens.py stay packaged.
const FORBIDDEN_BASENAME_PATTERNS = [
  /^\.env$/i,
  /^\.env\./i,
  /\.local\.json$/i,
  /\.map$/i,
  /(?:^|[._-])tokens?\.json$/i,
  /^modelscope\.tokens.*\.json$/i,
];

const PACKAGING_EXCLUDES = [
  '!**/*.map',
  '!*.map',
  '!**/*.local.json',
  '!**/.env',
  '!**/.env.*',
  '!**/*.token.json',
  '!**/*.tokens.json',
  '!**/token.json',
  '!**/tokens.json',
  '!**/modelscope.tokens*.json',
];

// Renderer and dev packages that must not be copied into app.asar. Real
// main-process dependencies and their nested packages are not in this list.
const FORBIDDEN_EXACT_DEPENDENCIES = new Set([
  'electron',
  'echarts',
  'esbuild',
  'lightningcss',
  'mermaid',
  'pdfjs-dist',
  'playwright',
  'react',
  'react-dom',
  'react-redux',
  'shadcn',
  'shiki',
  'streamdown',
  'tailwindcss',
  'typescript',
  'vite',
  'vitest',
  'xlsx',
]);

const FORBIDDEN_DEPENDENCY_SCOPES = [
  '@babel/',
  '@codemirror/',
  '@napi-rs/',
  '@shikijs/',
  '@streamdown/',
  '@tailwindcss/',
  '@ts-morph/',
  '@types/',
  '@uiw/',
];

const RENDERER_PACKAGE_EXCLUDES = [
  '!node_modules/electron/**',
  '!node_modules/echarts/**',
  '!node_modules/esbuild/**',
  '!node_modules/lightningcss/**',
  '!node_modules/lightningcss-*/**',
  '!node_modules/mermaid/**',
  '!node_modules/pdfjs-dist/**',
  '!node_modules/playwright/**',
  '!node_modules/react/**',
  '!node_modules/react-dom/**',
  '!node_modules/react-redux/**',
  '!node_modules/shadcn/**',
  '!node_modules/shiki/**',
  '!node_modules/@shikijs/**',
  '!node_modules/streamdown/**',
  '!node_modules/@streamdown/**',
  '!node_modules/tailwindcss/**',
  '!node_modules/@tailwindcss/**',
  '!node_modules/typescript/**',
  '!node_modules/vite/**',
  '!node_modules/vitest/**',
  '!node_modules/xlsx/**',
  '!node_modules/@babel/**',
  '!node_modules/@codemirror/**',
  '!node_modules/@napi-rs/**',
  '!node_modules/@ts-morph/**',
  '!node_modules/@types/**',
  '!node_modules/@uiw/**',
];

function packagingExcludePatterns() {
  return [...PACKAGING_EXCLUDES];
}

function isForbiddenPackagedBasename(basename) {
  return FORBIDDEN_BASENAME_PATTERNS.some(pattern => pattern.test(basename));
}

function isForbiddenPackagedDependency(name) {
  if (FORBIDDEN_EXACT_DEPENDENCIES.has(name)) return true;
  return FORBIDDEN_DEPENDENCY_SCOPES.some(scope => name.startsWith(scope));
}

function appendPatterns(filter, patterns) {
  const next = Array.isArray(filter) ? [...filter] : [];
  for (const pattern of patterns) {
    if (!next.includes(pattern)) next.push(pattern);
  }
  return next;
}

function ensureFilterExcludes(filter) {
  const hadFilter = Array.isArray(filter) && filter.length > 0;
  return appendPatterns(hadFilter ? filter : ['**/*'], PACKAGING_EXCLUDES);
}

// electron-builder normalizes `files` before beforePack. A later ignore-only
// fileset (every pattern starts with "!") is expanded to "**/*" and packs the
// repository, including caches and source. Excludes must be appended to a
// fileset that already has a positive pattern, never pushed as bare strings.
function applyPackagingExcludes(config) {
  if (Array.isArray(config.files)) {
    config.files = config.files.map(entry => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
      const patterns =
        entry.from == null && entry.to == null
          ? [...PACKAGING_EXCLUDES, ...RENDERER_PACKAGE_EXCLUDES]
          : PACKAGING_EXCLUDES;
      const filter = appendPatterns(entry.filter, patterns);
      if (
        entry.from == null &&
        entry.to == null &&
        filter.every(pattern => pattern.startsWith('!'))
      ) {
        throw new Error(
          'Refusing to apply packaging excludes to an ignore-only fileset; electron-builder would pack the repository',
        );
      }
      return { ...entry, filter };
    });
  }

  const visitResources = resources => {
    if (!Array.isArray(resources)) return;
    for (const entry of resources) {
      if (!entry || typeof entry !== 'object' || typeof entry.from !== 'string') continue;
      entry.filter = ensureFilterExcludes(entry.filter);
    }
  };

  visitResources(config.extraResources);
  for (const platformName of ['linux', 'win', 'mac']) {
    const platform = config[platformName];
    if (platform && typeof platform === 'object') visitResources(platform.extraResources);
  }
  return config;
}

function normalizeLocale(locale) {
  return String(locale).trim().toLowerCase().replace(/_/g, '-');
}

function localeMatches(wanted, language) {
  return (
    wanted === language || language.startsWith(`${wanted}-`) || wanted.startsWith(`${language}-`)
  );
}

function configuredLocales(electronLanguages) {
  const languages = Array.isArray(electronLanguages) ? electronLanguages : [];
  return languages.map(normalizeLocale).filter(language => language.length > 0);
}

// Empty platform arrays are truthy, so electron-builder treats them as an
// override and skips the root electronLanguages list (shipping every locale).
function pinElectronLanguages(config) {
  const languages = Array.isArray(config.electronLanguages)
    ? config.electronLanguages.filter(language => String(language).trim().length > 0)
    : [];
  if (languages.length === 0) {
    throw new Error('electronLanguages must list the Chromium locales to ship');
  }
  config.electronLanguages = languages;
  for (const platformName of ['linux', 'win', 'mac']) {
    const platform = config[platformName];
    if (!platform || typeof platform !== 'object') continue;
    const current = platform.electronLanguages;
    const hasOwnList = Array.isArray(current) ? current.length > 0 : Boolean(current);
    if (!hasOwnList) platform.electronLanguages = [...languages];
  }
  return languages;
}

function pruneLocaleDirectory(directory, extension, wanted) {
  if (!fs.existsSync(directory)) return { kept: [], removed: [] };
  const kept = [];
  const removed = [];
  for (const file of fs.readdirSync(directory)) {
    if (path.extname(file) !== extension) continue;
    const language = normalizeLocale(path.basename(file, extension));
    const matched = wanted.some(wantedLanguage => localeMatches(wantedLanguage, language));
    const fullPath = path.join(directory, file);
    if (matched) {
      kept.push(file);
      continue;
    }
    fs.rmSync(fullPath, { recursive: true, force: true });
    removed.push(file);
  }
  return { kept, removed };
}

function pruneChromiumLocales(appOutDir, electronLanguages) {
  const wanted = configuredLocales(electronLanguages);
  if (wanted.length === 0) {
    throw new Error('electronLanguages must list the Chromium locales to ship');
  }
  const results = [];
  const localesDir = path.join(appOutDir, 'locales');
  results.push({
    directory: localesDir,
    ...pruneLocaleDirectory(localesDir, '.pak', wanted),
  });

  const resourceDirs = [path.join(appOutDir, 'resources')];
  if (fs.existsSync(appOutDir)) {
    for (const entry of fs.readdirSync(appOutDir)) {
      if (!entry.endsWith('.app')) continue;
      resourceDirs.push(path.join(appOutDir, entry, 'Contents', 'Resources'));
      resourceDirs.push(
        path.join(
          appOutDir,
          entry,
          'Contents',
          'Frameworks',
          'Electron Framework.framework',
          'Resources',
        ),
      );
    }
  }
  for (const resourceDir of resourceDirs) {
    if (!fs.existsSync(resourceDir)) continue;
    for (const entry of fs.readdirSync(resourceDir)) {
      if (!entry.endsWith('.lproj')) continue;
      const language = normalizeLocale(entry.slice(0, -'.lproj'.length));
      const matched = wanted.some(wantedLanguage => localeMatches(wantedLanguage, language));
      if (matched) continue;
      fs.rmSync(path.join(resourceDir, entry), { recursive: true, force: true });
      results.push({ directory: resourceDir, kept: [], removed: [entry] });
    }
  }
  return results;
}

function walkForbiddenFiles(root) {
  const found = [];
  const visit = directory => {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (entry.isFile() && isForbiddenPackagedBasename(entry.name)) {
        found.push(path.relative(root, fullPath).split(path.sep).join('/'));
      }
    }
  };
  if (fs.existsSync(root)) visit(root);
  return found.sort();
}

function nodeModuleNameFromAsarPath(entry) {
  const normalized = entry.replace(/\\/g, '/').replace(/^\//, '');
  const match = normalized.match(/^node_modules\/(?:(@[^/]+)\/([^/]+)|([^/]+))\/package\.json$/);
  if (!match) return null;
  return match[1] ? `${match[1]}/${match[2]}` : match[3];
}

// app.asar is the built renderer, main process, and production node_modules.
// Anything else (source, caches, docs) means a fileset was expanded to the repo.
const ALLOWED_ASAR_ROOTS = new Set([
  'package.json',
  'dist',
  'dist-electron',
  'node_modules',
  'resources',
]);

function findAsarViolations(entries, allowedNames) {
  const violations = new Set();
  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, '/').replace(/^\//, '');
    if (!normalized) continue;
    const basename = path.posix.basename(normalized);
    if (isForbiddenPackagedBasename(basename)) violations.add(normalized);
    const [root, ...rest] = normalized.split('/');
    if (!ALLOWED_ASAR_ROOTS.has(root)) {
      violations.add(root);
    } else if (
      root === 'resources' &&
      rest.length > 0 &&
      normalized !== 'resources/SYSTEM_PROMPT.md'
    ) {
      violations.add(normalized);
    }
    const name = nodeModuleNameFromAsarPath('/' + normalized);
    if (!name) continue;
    if (isForbiddenPackagedDependency(name) || (allowedNames && !allowedNames.has(name))) {
      violations.add(`node_modules/${name}`);
    }
  }
  return [...violations].sort();
}

function locatePackageJson(name, startDir) {
  let directory = path.resolve(startDir);
  const segments = name.split('/');
  for (;;) {
    const candidate = path.join(directory, 'node_modules', ...segments, 'package.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function productionDependencyClosure(projectRoot) {
  const rootPackage = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const names = new Set();
  const seenFiles = new Set();
  const queue = Object.keys(rootPackage.dependencies ?? {}).map(name => ({
    name,
    startDir: projectRoot,
  }));

  while (queue.length > 0) {
    const current = queue.pop();
    const packageJsonPath = locatePackageJson(current.name, current.startDir);
    if (!packageJsonPath || seenFiles.has(packageJsonPath)) continue;
    seenFiles.add(packageJsonPath);
    names.add(current.name);
    const meta = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const nestedRoot = path.dirname(packageJsonPath);
    for (const dependency of Object.keys({
      ...meta.dependencies,
      ...meta.optionalDependencies,
    })) {
      queue.push({ name: dependency, startDir: nestedRoot });
    }
  }
  return names;
}

function findAppAsar(appOutDir) {
  const direct = path.join(appOutDir, 'resources', 'app.asar');
  if (fs.existsSync(direct)) return direct;
  if (!fs.existsSync(appOutDir)) return null;
  for (const entry of fs.readdirSync(appOutDir)) {
    if (!entry.endsWith('.app')) continue;
    const candidate = path.join(appOutDir, entry, 'Contents', 'Resources', 'app.asar');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function loadAsar() {
  try {
    return require('@electron/asar');
  } catch {
    return require('@electron/asar/lib/asar.js');
  }
}

function assertPackagedApp(options) {
  const projectRoot = options.projectRoot;
  const appOutDir = options.appOutDir;
  const languages = pinElectronLanguages({
    electronLanguages: options.electronLanguages,
    linux: {},
    win: {},
    mac: {},
  });
  const localeResults = pruneChromiumLocales(appOutDir, languages);
  const removedLocales = localeResults.flatMap(result => result.removed);
  if (removedLocales.length > 0) {
    console.warn(
      `[package-contents] removed ${removedLocales.length} Chromium locale file(s) left after electronLanguages filtering: ${removedLocales.join(', ')}`,
    );
  }
  const keptPaks = localeResults
    .filter(
      result =>
        result.directory.endsWith(`${path.sep}locales`) || result.directory.endsWith('/locales'),
    )
    .flatMap(result => result.kept);
  if (
    process.platform !== 'darwin' &&
    fs.existsSync(path.join(appOutDir, 'locales')) &&
    keptPaks.length === 0
  ) {
    throw new Error('Chromium locales directory is empty after applying electronLanguages');
  }

  const forbiddenFiles = walkForbiddenFiles(appOutDir).filter(
    relativePath => !relativePath.endsWith('.asar'),
  );
  const asarPath = findAppAsar(appOutDir);
  let asarViolations = [];
  if (asarPath) {
    const asar = loadAsar();
    const entries = asar.listPackage(asarPath);
    asarViolations = findAsarViolations(entries, productionDependencyClosure(projectRoot));
    for (const entry of entries) {
      const basename = path.posix.basename(entry.replace(/\\/g, '/'));
      if (isForbiddenPackagedBasename(basename)) {
        forbiddenFiles.push(`app.asar/${entry.replace(/\\/g, '/').replace(/^\//, '')}`);
      }
    }
  }

  const problems = [...new Set([...forbiddenFiles, ...asarViolations])].sort();
  if (problems.length > 0) {
    throw new Error(
      `Packaged app contains files that must not ship:\n${problems.map(problem => `  ${problem}`).join('\n')}`,
    );
  }
  return { removedLocales, asarPath };
}

module.exports = {
  PACKAGING_EXCLUDES,
  RENDERER_PACKAGE_EXCLUDES,
  packagingExcludePatterns,
  isForbiddenPackagedBasename,
  isForbiddenPackagedDependency,
  ensureFilterExcludes,
  applyPackagingExcludes,
  pinElectronLanguages,
  pruneChromiumLocales,
  walkForbiddenFiles,
  nodeModuleNameFromAsarPath,
  findAsarViolations,
  productionDependencyClosure,
  assertPackagedApp,
};
