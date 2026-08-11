'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { shouldExclude } = require('./pack-openclaw-tar.cjs');

const WINDOWS_RESOURCE_COMPONENT_SCHEMA_VERSION = 4;
const WINDOWS_RESOURCE_ARCHIVE_EXTENSION = '.7z';
const WINDOWS_RESOURCE_ARCHIVE_FORMAT = '7z';

function getWindowsResourceComponents(projectRoot) {
  return [
    {
      key: 'openclaw',
      label: 'OpenClaw runtime',
      dir: path.join(projectRoot, 'vendor', 'openclaw-runtime', 'current'),
      prefix: 'cfmind',
      sentinel: 'cfmind/package.json',
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
      key: 'portable-git',
      label: 'PortableGit runtime',
      dir: path.join(projectRoot, 'resources', 'mingit'),
      prefix: 'mingit',
      sentinel: 'mingit/usr/bin/bash.exe',
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
      sentinel: 'skill-python/xlsx/Scripts/python.exe',
    },
    {
      key: 'uv',
      label: 'uv runtime',
      dir: path.join(projectRoot, 'resources', 'uv-win'),
      prefix: 'uv-win',
      sentinel: 'uv-win/uv.exe',
    },
  ];
}

function computeWindowsResourceComponentId(component) {
  if (!fs.existsSync(component.dir)) {
    throw new Error('[windows-resource-pack] Missing ' + component.label + ': ' + component.dir);
  }
  const hash = crypto.createHash('sha256');
  hash.update(
    'zhiyuan-windows-resource-component-v' + WINDOWS_RESOURCE_COMPONENT_SCHEMA_VERSION + '\0',
  );
  hash.update(
    'component\0' + component.key + '\0' + component.prefix + '\0' + component.sentinel + '\0',
  );
  hashDirectory(hash, component.dir, '');
  return hash.digest('hex');
}

function hashDirectory(hash, directory, relativeDirectory, ancestorDirectories = new Set()) {
  const realDirectory = fs.realpathSync(directory);
  if (ancestorDirectories.has(realDirectory)) {
    throw new Error('[windows-resource-pack] Symlink cycle detected at ' + directory);
  }
  const nextAncestors = new Set(ancestorDirectories);
  nextAncestors.add(realDirectory);
  const entries = fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, 'en'));

  for (const entry of entries) {
    const relativePath = relativeDirectory ? relativeDirectory + '/' + entry.name : entry.name;
    if (shouldExclude(relativePath)) continue;

    const absolutePath = path.join(directory, entry.name);
    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) {
      hash.update('directory\0' + relativePath + '\0');
      hashDirectory(hash, absolutePath, relativePath, nextAncestors);
      continue;
    }
    if (!stat.isFile()) continue;

    hash.update('file\0' + relativePath + '\0' + stat.size + '\0');
    const fileDescriptor = fs.openSync(absolutePath, 'r');
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
    hash.update('\0');
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
  return {
    version: WINDOWS_RESOURCE_COMPONENT_SCHEMA_VERSION,
    key: component.key,
    label: component.label,
    prefix: component.prefix,
    sentinel: component.sentinel,
    contentId,
    archive: component.key + WINDOWS_RESOURCE_ARCHIVE_EXTENSION,
    archiveFormat: WINDOWS_RESOURCE_ARCHIVE_FORMAT,
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
  WINDOWS_RESOURCE_COMPONENT_SCHEMA_VERSION,
  WINDOWS_RESOURCE_ARCHIVE_EXTENSION,
  WINDOWS_RESOURCE_ARCHIVE_FORMAT,
  buildWindowsResourceBundleManifest,
  buildWindowsResourceComponentManifest,
  computeWindowsResourceComponentId,
  getWindowsResourceComponents,
  isWindowsResourceComponentReusable,
  sha256File,
};
