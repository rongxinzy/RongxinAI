/**
 * Bundled expert preset package fields (plugin.json) shared by catalog, session
 * snapshots, and IPC contracts. PyPI mirrors are hints for runtime uv/pip only —
 * wheels are never vendored into the installer.
 */

export const ExpertPypiMirrorId = {
  TsinghuaTuna: 'tsinghua-tuna',
  Ustc: 'ustc',
  Tencent: 'tencent',
  Aliyun: 'aliyun',
} as const;

/** Matches managed runtime default in `pythonPackageIndexes.ts` (uv/pip). */
const DEFAULT_CN_PYPI_PRIMARY_MIRROR_URL =
  'https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple';

export type ExpertPypiMirrorId = (typeof ExpertPypiMirrorId)[keyof typeof ExpertPypiMirrorId];

/** Preferred fallback order for Chinese PyPI mirrors (documented product default). */
/** Default npm registry for npx/node-based MCP and skill tooling (taobao npmmirror). */
export const DEFAULT_CN_NPM_REGISTRY_URL = 'https://registry.npmmirror.com';

export const DEFAULT_CN_PYPI_MIRROR_URLS: readonly string[] = [
  DEFAULT_CN_PYPI_PRIMARY_MIRROR_URL,
  'https://pypi.mirrors.ustc.edu.cn/simple',
  'https://mirrors.cloud.tencent.com/pypi/simple',
  'https://mirrors.aliyun.com/pypi/simple',
];

export interface ExpertPythonRequirements {
  /** Relative path inside the expert package, e.g. `./requirements.txt`. */
  requirementsPath?: string;
  /** Inline dependency spec lines when no requirements file is shipped. */
  dependencies?: string[];
}

/** External skill install hint (runtime `npx skills add`, not vendored). */
export interface ExpertSkillCatalogEntry {
  id: string;
  category: string;
  install: string;
  license?: string;
}

export interface PresetExpertPackageMetadata {
  mcpIds: string[];
  pythonRequirements?: ExpertPythonRequirements;
  pypiMirrors: string[];
  skillCatalog: ExpertSkillCatalogEntry[];
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

export const parseSkillCatalog = (
  pluginJson: Record<string, unknown>,
): ExpertSkillCatalogEntry[] => {
  const raw = pluginJson.skillCatalog;
  if (!Array.isArray(raw)) return [];
  const entries: ExpertSkillCatalogEntry[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const id = isNonEmptyString(record.id) ? record.id.trim() : '';
    const category = isNonEmptyString(record.category) ? record.category.trim() : '';
    const install = isNonEmptyString(record.install) ? record.install.trim() : '';
    if (!id || !category || !install) continue;
    entries.push({
      id,
      category,
      install,
      license: isNonEmptyString(record.license) ? record.license.trim() : undefined,
    });
  }
  return entries;
};

export const readPresetExpertPackageMetadata = (
  pluginJson: Record<string, unknown>,
): PresetExpertPackageMetadata => ({
  mcpIds: normalizeStringList(pluginJson.mcpIds),
  pythonRequirements: parsePresetPythonRequirements(pluginJson),
  pypiMirrors: resolvePresetPypiMirrors(pluginJson),
  skillCatalog: parseSkillCatalog(pluginJson),
});

export const buildSkillCatalogPromptBlock = (skillCatalog: ExpertSkillCatalogEntry[]): string => {
  if (skillCatalog.length === 0) return '';
  const linesZh = skillCatalog.map(
    entry =>
      `- \`${entry.id}\`（${entry.category}）：\`${entry.install}\`（npm 镜像 \`${DEFAULT_CN_NPM_REGISTRY_URL}\`）`,
  );
  const linesEn = skillCatalog.map(
    entry =>
      `- \`${entry.id}\` (${entry.category}): \`${entry.install}\` (npm registry \`${DEFAULT_CN_NPM_REGISTRY_URL}\`)`,
  );
  return [
    '## 推荐外部 Skill（运行时安装） / Recommended external skills (runtime install)',
    '',
    '以下 Skill 不在安装包内；需要时用 `npx skills add` 或 install 命令拉取，禁止 vendor 仓库。',
    'Skills are not bundled; install with `npx skills add` or the install command below. Do not vendor repos.',
    ...linesZh,
    '',
    'English:',
    ...linesEn,
  ].join('\n');
};

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

  const depHintEn =
    pythonRequirements.requirementsPath != null
      ? `Requirements file: \`${pythonRequirements.requirementsPath}\` (relative to expert package root).`
      : pythonRequirements.dependencies != null && pythonRequirements.dependencies.length > 0
        ? `Inline deps: ${pythonRequirements.dependencies.join(', ')}.`
        : '';

  return [
    '## Python 依赖（运行时安装） / Python dependencies (runtime install)',
    '',
    '当任务需要额外 Python 包时，使用 `python_install` 或托管 `python-runtime` 安装；禁止把 wheel 打进安装包或仓库。',
    'Use `python_install` or managed `python-runtime` for extra packages; never vendor wheels in the app or repo.',
    depHint,
    depHintEn,
    '按以下 PyPI 镜像顺序尝试（与托管运行时 UV_INDEX 首选一致，失败再换下一个）：',
    'Try these PyPI mirrors in order (primary matches managed UV_INDEX):',
    mirrorList,
    '',
    `Node/npx MCP 与工具包默认 npm 镜像 \`${DEFAULT_CN_NPM_REGISTRY_URL}\`（勿 vendor 完整 npm 包）。`,
    `Default npm registry for npx/MCP: \`${DEFAULT_CN_NPM_REGISTRY_URL}\` (do not vendor full npm packages).`,
    '',
    '安装后用 `python_execute` 验证 import / Verify imports with `python_execute` before delivery.',
  ]
    .filter(Boolean)
    .join('\n');
};

export const mergeExpertCapabilityPolicy = (input: {
  mcpIds: string[];
  pythonRequirements?: ExpertPythonRequirements;
  pypiMirrors: string[];
  skillCatalog?: ExpertSkillCatalogEntry[];
}): Record<string, unknown> => {
  const policy: Record<string, unknown> = {};
  if (input.mcpIds.length > 0) policy.mcpIds = input.mcpIds;
  if (input.pythonRequirements) policy.pythonRequirements = input.pythonRequirements;
  if (input.pypiMirrors.length > 0) policy.pypiMirrors = input.pypiMirrors;
  if (input.skillCatalog && input.skillCatalog.length > 0) policy.skillCatalog = input.skillCatalog;
  return policy;
};
