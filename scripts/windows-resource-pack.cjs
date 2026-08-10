'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { shouldExclude } = require('./pack-openclaw-tar.cjs');

const WINDOWS_RESOURCE_PACK_SCHEMA_VERSION = 2;

function getWindowsResourceSources(projectRoot) {
  return [
    {
      label: 'OpenClaw runtime',
      dir: path.join(projectRoot, 'vendor', 'openclaw-runtime', 'current'),
      prefix: 'cfmind',
    },
    { label: 'SKILLs', dir: path.join(projectRoot, 'SKILLs'), prefix: 'SKILLs' },
    { label: 'MCPs', dir: path.join(projectRoot, 'MCPs'), prefix: 'MCPs' },
    {
      label: 'PortableGit runtime',
      dir: path.join(projectRoot, 'resources', 'mingit'),
      prefix: 'mingit',
    },
    {
      label: 'Python runtime',
      dir: path.join(projectRoot, 'resources', 'python-win'),
      prefix: 'python-win',
    },
    {
      label: 'Skill Python runtimes',
      dir: path.join(projectRoot, 'resources', 'skill-python'),
      prefix: 'skill-python',
    },
    {
      label: 'uv runtime',
      dir: path.join(projectRoot, 'resources', 'uv-win'),
      prefix: 'uv-win',
    },
  ];
}

function computeWindowsResourcePackId(sources) {
  const hash = crypto.createHash('sha256');
  hash.update(`zhiyuan-windows-resource-pack-v${WINDOWS_RESOURCE_PACK_SCHEMA_VERSION}\0`);

  for (const source of sources) {
    if (!fs.existsSync(source.dir)) {
      throw new Error(`[windows-resource-pack] Missing ${source.label}: ${source.dir}`);
    }

    hash.update(`source\0${source.prefix}\0`);
    hashDirectory(hash, source.dir, '');
  }

  return hash.digest('hex');
}

function hashDirectory(hash, directory, relativeDirectory, ancestorDirectories = new Set()) {
  const realDirectory = fs.realpathSync(directory);
  if (ancestorDirectories.has(realDirectory)) {
    throw new Error(`[windows-resource-pack] Symlink cycle detected at ${directory}`);
  }
  const nextAncestors = new Set(ancestorDirectories);
  nextAncestors.add(realDirectory);
  const entries = fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, 'en'));

  for (const entry of entries) {
    const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    if (shouldExclude(relativePath)) continue;

    const absolutePath = path.join(directory, entry.name);
    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) {
      hash.update(`directory\0${relativePath}\0`);
      hashDirectory(hash, absolutePath, relativePath, nextAncestors);
      continue;
    }
    if (!stat.isFile()) continue;

    const size = stat.size;
    hash.update(`file\0${relativePath}\0${size}\0`);
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

function buildWindowsResourcePackManifest(sources, resourcePackId) {
  return {
    version: WINDOWS_RESOURCE_PACK_SCHEMA_VERSION,
    resourcePackId,
    sources: sources.map(({ label, prefix }) => ({ label, prefix })),
  };
}

function isWindowsResourcePackReusable(manifestPath, resourcePackId, sources) {
  if (!fs.existsSync(manifestPath)) return false;
  try {
    const saved = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const expected = buildWindowsResourcePackManifest(sources, resourcePackId);
    return JSON.stringify(saved) === JSON.stringify(expected);
  } catch {
    return false;
  }
}

module.exports = {
  WINDOWS_RESOURCE_PACK_SCHEMA_VERSION,
  buildWindowsResourcePackManifest,
  computeWindowsResourcePackId,
  getWindowsResourceSources,
  isWindowsResourcePackReusable,
};
