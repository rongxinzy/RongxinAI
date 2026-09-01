import path from 'path';

type ProcessEnvironment = Record<string, string | undefined>;

const isPathKey = (key: string): boolean =>
  process.platform === 'win32' ? key.toLowerCase() === 'path' : key === 'PATH';

const readPath = (env: ProcessEnvironment): string | undefined => {
  if (env.PATH) return env.PATH;
  const key = Object.keys(env).find(isPathKey);
  return key ? env[key] : undefined;
};

const withoutPath = (env: ProcessEnvironment): ProcessEnvironment =>
  Object.fromEntries(Object.entries(env).filter(([key]) => !isPathKey(key)));

const mergePath = (preferred: string | undefined, inherited: string | undefined): string => {
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const entry of [preferred, inherited]
    .filter((value): value is string => Boolean(value))
    .flatMap(value => value.split(path.delimiter))) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const normalized = process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    entries.push(trimmed);
  }
  return entries.join(path.delimiter);
};

/**
 * Apply MCP-specific environment overrides without discarding the application
 * environment's executable search path. Runtime helpers may add only their own
 * directories to PATH, so a normal object spread would hide system commands.
 */
export const mergeMcpSpawnEnv = (
  inheritedEnv: ProcessEnvironment,
  resolvedEnv: ProcessEnvironment | undefined,
): Record<string, string> => {
  const mergedPath = mergePath(readPath(resolvedEnv || {}), readPath(inheritedEnv));
  const merged = {
    ...withoutPath(inheritedEnv),
    ...withoutPath(resolvedEnv || {}),
    ...(mergedPath ? { PATH: mergedPath } : {}),
  };

  return Object.fromEntries(
    Object.entries(merged).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
};
