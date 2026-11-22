'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isForbiddenPackagedBasename } = require('./packaging/assert-package-contents.cjs');

const TRANSIENT_DIRECTORIES = new Set([
  '.cache',
  '.git',
  '.github',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.venv',
  '__pycache__',
]);

function shouldExclude(entryPath) {
  if (/^feishu[/\\]runtime(?:[/\\]|$)/i.test(entryPath)) return true;
  const segments = entryPath.split(/[/\\]/);
  return (
    segments.some(segment => TRANSIENT_DIRECTORIES.has(segment.toLowerCase())) ||
    isForbiddenPackagedBasename(segments.at(-1))
  );
}

const WINDOWS_RESOURCE_COMPONENT_SCHEMA_VERSION = 5;
const WINDOWS_RESOURCE_ARCHIVE_EXTENSION = '.7z';
const WINDOWS_RESOURCE_ARCHIVE_FORMAT = '7z';
// mx=5 keeps solid LZMA2 within ~4% of mx=9 while compressing more than twice as
// fast (measured 2026-10-22 on the 176 MB core layer: 34.8 MB / 18 s vs 33.4 MB /
// 41 s). Extraction cost is dominated by per-file writes, not by the level, so the
// extra ratio bought by mx=9 only slows packaging down.
const WINDOWS_RESOURCE_ARCHIVE_COMPRESSION = {
  NonSolid: {
    id: 'lzma2-mx5-nonsolid-v1',
    sevenZipArgs: ['-mx=5', '-m0=lzma2', '-ms=off', '-mmt=on'],
  },
  Solid: {
    id: 'lzma2-mx5-solid-v1',
    sevenZipArgs: ['-mx=5', '-m0=lzma2', '-ms=on', '-mmt=on'],
  },
};
const SOLID_ARCHIVE_COMPONENT_KEYS = new Set(['skills', 'mcps', 'python', 'skill-python']);

function getWindowsResourceArchiveCompression(component) {
  return SOLID_ARCHIVE_COMPONENT_KEYS.has(component.key)
    ? WINDOWS_RESOURCE_ARCHIVE_COMPRESSION.Solid
    : WINDOWS_RESOURCE_ARCHIVE_COMPRESSION.NonSolid;
}

const { shouldIncludeLlamaCppBundledComponent } = require('./resolve-nsis-offline-components.cjs');

function getWindowsResourceComponents(projectRoot) {
  const components = [
    {
      key: 'channel-runtime',
      label: 'cc-connect channel runtime',
      dir: path.join(projectRoot, 'vendor', 'channel-runtime', 'current'),
      prefix: 'channel-runtime',
      sentinel: 'channel-runtime/cc-connect-sidecar.exe',
    },
    {
      key: 'skills',
      label: 'Built-in Skills',
      dir: path.join(projectRoot, 'SKILLs'),
      prefix: 'SKILLs',
      sentinel: 'SKILLs/skills.config.json',
    },
    {
      key: 'mcps',
      label: 'Built-in MCPs',
      dir: path.join(projectRoot, 'MCPs'),
      prefix: 'MCPs',
      sentinel: 'MCPs/compatibility-review.md',
    },
    {
      key: 'python',
      label: 'Python runtime',
      dir: path.join(projectRoot, 'resources', 'python-win'),
      prefix: 'python-win',
      sentinel: 'python-win/python.exe',
    },
    {
      key: 'skill-python',
      label: 'Skill Python runtimes',
      dir: path.join(projectRoot, 'resources', 'skill-python'),
      prefix: 'skill-python',
      sentinel: 'skill-python/layers/shared/Scripts/python.exe',
    },
    {
      key: 'uv',
      label: 'uv runtime',
      dir: path.join(projectRoot, 'resources', 'uv-win'),
      prefix: 'uv-win',
      sentinel: 'uv-win/uv.exe',
    },
  ];
  if (shouldIncludeLlamaCppBundledComponent()) {
    components.push({
      key: 'llamacpp-bundled',
      label: 'Bundled llama.cpp runtime',
      dir: path.join(projectRoot, 'resources', 'llamacpp-bundled'),
      prefix: 'llamacpp-bundled',
      sentinel: 'llamacpp-bundled/manifest.json',
    });
  }
  return components;
}

function listWindowsResourceComponentFiles(component) {
  if (!fs.existsSync(component.dir)) {
    throw new Error('[windows-resource-pack] Missing ' + component.label + ': ' + component.dir);
  }
  const files = [];
  collectFiles(files, component.dir, '');
  return files.sort();
}

function computeWindowsResourceComponentId(
  component,
  files = listWindowsResourceComponentFiles(component),
) {
  const hash = crypto.createHash('sha256');
  hash.update(
    'zhiyuan-windows-resource-component-v' + WINDOWS_RESOURCE_COMPONENT_SCHEMA_VERSION + '\0',
  );
  hash.update(
    'component\0' + component.key + '\0' + component.prefix + '\0' + component.sentinel + '\0',
  );
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  for (const relativePath of files) {
    const fileDescriptor = fs.openSync(path.join(component.dir, relativePath), 'r');
    try {
      const { size } = fs.fstatSync(fileDescriptor);
      hash.update('file\0' + relativePath + '\0' + size + '\0');
      let bytesRead = 0;
      do {
        bytesRead = fs.readSync(fileDescriptor, buffer, 0, buffer.length, null);
        if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
      } while (bytesRead > 0);
    } finally {
      fs.closeSync(fileDescriptor);
    }
    hash.update('\0');
  }
  return hash.digest('hex');
}

function collectFiles(files, directory, relativeDirectory, ancestorDirectories = new Set()) {
  const realDirectory = fs.realpathSync(directory);
  if (ancestorDirectories.has(realDirectory)) {
    throw new Error('[windows-resource-pack] Symlink cycle detected at ' + directory);
  }
  const nextAncestors = new Set(ancestorDirectories).add(realDirectory);
  for (const entry of fs.readdirSync(directory)) {
    const relativePath = relativeDirectory ? relativeDirectory + '/' + entry : entry;
    if (shouldExclude(relativePath)) continue;

    const absolutePath = path.join(directory, entry);
    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) {
      collectFiles(files, absolutePath, relativePath, nextAncestors);
    } else if (stat.isFile()) {
      if (/[\r\n]/.test(relativePath)) {
        throw new Error('[windows-resource-pack] A resource filename contains a line break');
      }
      files.push(relativePath);
    }
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fileDescriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(fileDescriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fileDescriptor);
  }
  return hash.digest('hex');
}

function buildWindowsResourceComponentManifest(
  component,
  contentId,
  archiveSha256,
  archiveSizeBytes,
  sentinelSha256,
) {
  const compression = getWindowsResourceArchiveCompression(component);
  return {
    version: WINDOWS_RESOURCE_COMPONENT_SCHEMA_VERSION,
    key: component.key,
    label: component.label,
    prefix: component.prefix,
    sentinel: component.sentinel,
    contentId,
    archive: component.key + WINDOWS_RESOURCE_ARCHIVE_EXTENSION,
    archiveFormat: WINDOWS_RESOURCE_ARCHIVE_FORMAT,
    archiveCompression: compression.id,
    archiveSha256,
    archiveSizeBytes,
    sentinelSha256,
  };
}

function isWindowsResourceComponentReusable(manifestPath, archivePath, contentId, component) {
  if (!fs.existsSync(manifestPath) || !fs.existsSync(archivePath)) return false;
  try {
    const saved = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return (
      saved.version === WINDOWS_RESOURCE_COMPONENT_SCHEMA_VERSION &&
      saved.key === component.key &&
      saved.prefix === component.prefix &&
      saved.sentinel === component.sentinel &&
      saved.contentId === contentId &&
      saved.archive === component.key + WINDOWS_RESOURCE_ARCHIVE_EXTENSION &&
      saved.archiveFormat === WINDOWS_RESOURCE_ARCHIVE_FORMAT &&
      saved.archiveCompression === getWindowsResourceArchiveCompression(component).id &&
      typeof saved.archiveSha256 === 'string' &&
      saved.archiveSha256 === sha256File(archivePath) &&
      saved.archiveSizeBytes === fs.statSync(archivePath).size
    );
  } catch {
    return false;
  }
}

function buildWindowsResourceBundleManifest(componentManifests) {
  return {
    version: WINDOWS_RESOURCE_COMPONENT_SCHEMA_VERSION,
    offline: true,
    excludes: ['llama.cpp'],
    components: componentManifests,
  };
}

module.exports = {
  WINDOWS_RESOURCE_ARCHIVE_COMPRESSION,
  buildWindowsResourceBundleManifest,
  buildWindowsResourceComponentManifest,
  computeWindowsResourceComponentId,
  getWindowsResourceComponents,
  getWindowsResourceArchiveCompression,
  isWindowsResourceComponentReusable,
  listWindowsResourceComponentFiles,
  sha256File,
  shouldExclude,
};
