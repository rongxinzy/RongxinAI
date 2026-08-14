import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ELECTRON_RUNTIME_DEPENDENCIES } from '../electron-runtime-dependencies.mjs';

const BUILTIN_MODULES = new Set([
  ...builtinModules,
  ...builtinModules.map(moduleName => `node:${moduleName}`),
  'electron',
]);

function packageRoot(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0];
}

export function collectLiteralExternalRoots(source) {
  const roots = new Set();
  const patterns = [
    /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
    /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[2];
      if (
        specifier.startsWith('.') ||
        specifier.startsWith('/') ||
        BUILTIN_MODULES.has(specifier)
      ) {
        continue;
      }
      roots.add(packageRoot(specifier));
    }
  }
  return [...roots].sort();
}

function findFiles(directory, predicate) {
  if (!fs.existsSync(directory)) return [];
  const matches = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) matches.push(...findFiles(entryPath, predicate));
    if (entry.isFile() && predicate(entryPath)) matches.push(entryPath);
  }
  return matches;
}

export function checkElectronRuntimeDependencies(projectRoot) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const declared = Object.keys(packageJson.dependencies ?? {}).sort();
  const expected = [...ELECTRON_RUNTIME_DEPENDENCIES].sort();
  if (JSON.stringify(declared) !== JSON.stringify(expected)) {
    throw new Error(
      `Production dependencies must match the Electron runtime allowlist.\nExpected: ${expected.join(', ')}\nActual: ${declared.join(', ')}`,
    );
  }

  const outputDirectory = path.join(projectRoot, 'dist-electron');
  const mainPath = path.join(outputDirectory, 'main.js');
  if (!fs.existsSync(mainPath)) {
    throw new Error(`Electron main bundle is missing: ${mainPath}`);
  }

  const externalRoots = collectLiteralExternalRoots(fs.readFileSync(mainPath, 'utf8'));
  const undeclared = externalRoots.filter(root => !declared.includes(root));
  if (undeclared.length > 0) {
    throw new Error(
      `Electron main bundle references undeclared runtime dependencies: ${undeclared.join(', ')}`,
    );
  }

  const sourceMaps = findFiles(outputDirectory, filePath => filePath.endsWith('.map'));
  if (sourceMaps.length > 0) {
    throw new Error(
      `Production Electron output contains source maps: ${sourceMaps.map(filePath => path.relative(projectRoot, filePath)).join(', ')}`,
    );
  }

  console.log(
    `[ElectronRuntimeDependencies] verified ${declared.length} production dependencies and ${externalRoots.length} generated external roots`,
  );
  return { declared, externalRoots };
}

const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (scriptPath === fileURLToPath(import.meta.url)) {
  checkElectronRuntimeDependencies(process.cwd());
}
