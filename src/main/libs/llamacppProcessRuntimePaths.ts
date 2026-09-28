import path from 'path';

export function resolveExecutableDir(executablePath: string, platform: NodeJS.Platform): string {
  const normalizedPath = executablePath.trim();
  if (!normalizedPath) return '';
  return platform === 'win32' ? path.win32.dirname(normalizedPath) : path.dirname(normalizedPath);
}

export function prependEnvPathEntry(
  env: NodeJS.ProcessEnv,
  variableName: 'PATH' | 'LD_LIBRARY_PATH',
  entry: string,
  platform: NodeJS.Platform,
): void {
  const delimiter = platform === 'win32' ? ';' : ':';
  const key = Object.keys(env).find(name => name.toUpperCase() === variableName) ?? variableName;
  const currentValue = env[key]?.trim() ?? '';
  const entries = currentValue
    ? currentValue
        .split(delimiter)
        .map(item => item.trim())
        .filter(Boolean)
    : [];
  if (entries.includes(entry)) {
    env[key] = entries.join(delimiter);
    return;
  }
  env[key] = [entry, ...entries].join(delimiter);
}
