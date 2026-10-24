/**
 * Bundled expert preset package fields (plugin.json) shared by catalog, session
 * snapshots, and IPC contracts. PyPI mirrors are hints for runtime uv/pip only —
 * wheels are never vendored into the installer.
 */

export const ExpertPypiMirrorId = {
  TsinghuaTuna: 'tsinghua-tuna',
  Ustc: 'ustc',
  Tencent: 'tencent',
  ByteDance: 'bytedance',
  Aliyun: 'aliyun',
} as const;

export type ExpertPypiMirrorId = (typeof ExpertPypiMirrorId)[keyof typeof ExpertPypiMirrorId];

/** Preferred fallback order for Chinese PyPI mirrors (documented product default). */
/** Default npm registry for npx/node-based MCP and skill tooling (taobao npmmirror). */
export const DEFAULT_CN_NPM_REGISTRY_URL = 'https://registry.npmmirror.com';

export const DEFAULT_CN_PYPI_MIRROR_URLS: readonly string[] = [
  'https://pypi.tuna.tsinghua.edu.cn/simple',
  'https://pypi.mirrors.ustc.edu.cn/simple',
  'https://mirrors.cloud.tencent.com/pypi/simple',
  'https://mirrors.byted.org/pypi/simple',
  'https://mirrors.aliyun.com/pypi/simple',
];

export interface ExpertPythonRequirements {
  /** Relative path inside the expert package, e.g. `./requirements.txt`. */
  requirementsPath?: string;
  /** Inline dependency spec lines when no requirements file is shipped. */
  dependencies?: string[];
}

export interface PresetExpertPackageMetadata {
  mcpIds: string[];
  pythonRequirements?: ExpertPythonRequirements;
  pypiMirrors: string[];
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const normalizeStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isNonEmptyString).map(entry => entry.trim()))];
};

export const resolvePresetPypiMirrors = (pluginJson: Record<string, unknown>): string[] => {
  const overrides = normalizeStringList(pluginJson.pypiMirrors);
  return overrides.length > 0 ? overrides : [...DEFAULT_CN_PYPI_MIRROR_URLS];
};

export const parsePresetPythonRequirements = (
  pluginJson: Record<string, unknown>,
): ExpertPythonRequirements | undefined => {
  const raw = pluginJson.pythonRequirements;
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;

  const record = raw as Record<string, unknown>;
  const requirementsPath = isNonEmptyString(record.requirementsPath)
    ? record.requirementsPath.trim()
    : undefined;
  const dependencies = normalizeStringList(record.dependencies);

  if (!requirementsPath && dependencies.length === 0) return undefined;
  return { requirementsPath, dependencies };
};

export const readPresetExpertPackageMetadata = (
  pluginJson: Record<string, unknown>,
): PresetExpertPackageMetadata => ({
  mcpIds: normalizeStringList(pluginJson.mcpIds),
  pythonRequirements: parsePresetPythonRequirements(pluginJson),
  pypiMirrors: resolvePresetPypiMirrors(pluginJson),
});

export const buildPythonDependencyPromptBlock = (
  metadata: Pick<PresetExpertPackageMetadata, 'pythonRequirements' | 'pypiMirrors'>,
): string => {
  const { pythonRequirements, pypiMirrors } = metadata;
  if (!pythonRequirements) return '';

  const mirrorList = pypiMirrors.map((url, index) => `${index + 1}. ${url}`).join('\n');
  const depHint =
    pythonRequirements.requirementsPath != null
      ? `依赖清单文件：\`${pythonRequirements.requirementsPath}\`（相对专家包根目录）。`
      : pythonRequirements.dependencies != null && pythonRequirements.dependencies.length > 0
        ? `内联依赖：${pythonRequirements.dependencies.join('、')}。`
        : '';

  return [
    '## Python 依赖（运行时安装）',
    '',
    '当任务需要额外 Python 包时，使用 `python_install` 或托管 `python-runtime` 工具安装；禁止把 wheel 打进安装包或仓库。',
    depHint,
    '按以下 PyPI 镜像顺序尝试（失败再换下一个）：',
    mirrorList,
    '',
    `Node/npx 拉取 MCP 或前端工具包时，应用运行时会优先使用 npm 镜像 \`${DEFAULT_CN_NPM_REGISTRY_URL}\`（勿在仓库内 vendor 完整 npm 包）。`,
    '',
    '安装完成后用 `python_execute` 验证 import，再继续交付。',
  ]
    .filter(Boolean)
    .join('\n');
};

export const mergeExpertCapabilityPolicy = (input: {
  mcpIds: string[];
  pythonRequirements?: ExpertPythonRequirements;
  pypiMirrors: string[];
}): Record<string, unknown> => {
  const policy: Record<string, unknown> = {};
  if (input.mcpIds.length > 0) policy.mcpIds = input.mcpIds;
  if (input.pythonRequirements) policy.pythonRequirements = input.pythonRequirements;
  if (input.pypiMirrors.length > 0) policy.pypiMirrors = input.pypiMirrors;
  return policy;
};
