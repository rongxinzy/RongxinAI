export const PythonPackageIndexUrl = {
  Tsinghua: 'https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple',
  Official: 'https://pypi.org/simple',
} as const;

export const MANAGED_UV_CONFIG = [
  '[[index]]',
  "name = 'tsinghua'",
  `url = '${PythonPackageIndexUrl.Tsinghua}'`,
  '',
  '[[index]]',
  "name = 'pypi'",
  `url = '${PythonPackageIndexUrl.Official}'`,
  'default = true',
  '',
].join('\n');

export function applyUvPackageIndexDefaults(
  env: Record<string, string | undefined>,
  options: { overwrite?: boolean } = {},
): void {
  if (options.overwrite || !env.UV_INDEX) {
    env.UV_INDEX = PythonPackageIndexUrl.Tsinghua;
  }
  if (options.overwrite || !env.UV_DEFAULT_INDEX) {
    env.UV_DEFAULT_INDEX = PythonPackageIndexUrl.Official;
  }
}
