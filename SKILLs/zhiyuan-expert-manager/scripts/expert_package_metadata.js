/**
 * Shared parsing for optional expert package metadata (mcpIds, python deps, PyPI mirrors).
 * Kept in JS so validate_expert.js and register_expert.js stay dependency-free.
 */

const DEFAULT_CN_PYPI_MIRROR_URLS = [
  'https://pypi.tuna.tsinghua.edu.cn/simple',
  'https://pypi.mirrors.ustc.edu.cn/simple',
  'https://mirrors.cloud.tencent.com/pypi/simple',
  'https://mirrors.byted.org/pypi/simple',
  'https://mirrors.aliyun.com/pypi/simple',
];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isNonEmptyString).map(entry => entry.trim()))];
}

function resolvePypiMirrors(pluginJson) {
  const overrides = normalizeStringList(pluginJson.pypiMirrors);
  return overrides.length > 0 ? overrides : [...DEFAULT_CN_PYPI_MIRROR_URLS];
}

function resolveMcpIds(pluginJson) {
  return normalizeStringList(pluginJson.mcpIds);
}

function parsePythonRequirements(pluginJson) {
  const raw = pluginJson.pythonRequirements;
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;

  const requirementsPath = isNonEmptyString(raw.requirementsPath) ? raw.requirementsPath.trim() : undefined;
  const dependencies = normalizeStringList(raw.dependencies);
  if (!requirementsPath && dependencies.length === 0) return undefined;
  return { requirementsPath, dependencies };
}

function validatePackageMetadata(pluginJson, expertDir, result) {
  const mcpIds = pluginJson.mcpIds;
  if (mcpIds !== undefined) {
    if (!Array.isArray(mcpIds)) {
      result.error("plugin.json: 'mcpIds' must be an array when provided");
    } else if (mcpIds.some(id => !isNonEmptyString(id))) {
      result.error("plugin.json: 'mcpIds' must contain only non-empty strings");
    }
  }

  const pythonRequirements = pluginJson.pythonRequirements;
  if (pythonRequirements !== undefined) {
    if (typeof pythonRequirements !== 'object' || pythonRequirements === null || Array.isArray(pythonRequirements)) {
      result.error("plugin.json: 'pythonRequirements' must be an object when provided");
    } else {
      const hasPath = isNonEmptyString(pythonRequirements.requirementsPath);
      const deps = normalizeStringList(pythonRequirements.dependencies);
      if (!hasPath && deps.length === 0) {
        result.error(
          "plugin.json: 'pythonRequirements' must include requirementsPath or a non-empty dependencies array",
        );
      }
      if (hasPath) {
        const fs = require('fs');
        const path = require('path');
        const resolved = path.resolve(expertDir, pythonRequirements.requirementsPath.trim());
        const root = path.resolve(expertDir);
        const relative = path.relative(root, resolved);
        if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
          result.error("plugin.json: 'pythonRequirements.requirementsPath' must stay inside the expert package");
        } else if (!fs.existsSync(resolved)) {
          result.error(`plugin.json: requirements file not found: ${pythonRequirements.requirementsPath}`);
        }
      }
      if (pythonRequirements.dependencies !== undefined && !Array.isArray(pythonRequirements.dependencies)) {
        result.error("plugin.json: 'pythonRequirements.dependencies' must be an array when provided");
      }
    }
  }

  const mirrors = pluginJson.pypiMirrors;
  if (mirrors !== undefined) {
    if (!Array.isArray(mirrors) || mirrors.some(url => !isNonEmptyString(url))) {
      result.error("plugin.json: 'pypiMirrors' must be an array of non-empty URL strings when provided");
    }
  }
}

module.exports = {
  DEFAULT_CN_PYPI_MIRROR_URLS,
  resolvePypiMirrors,
  resolveMcpIds,
  parsePythonRequirements,
  validatePackageMetadata,
};
