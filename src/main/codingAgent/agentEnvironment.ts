const AGENT_ENVIRONMENT_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
  'APPDATA',
  'LOCALAPPDATA',
  'COMSPEC',
  'PATHEXT',
  'SystemRoot',
  'USERPROFILE',
  'USERNAME',
  'ProgramFiles',
  'ProgramFiles(x86)',
  // Follow the application's current proxy preference for every new process.
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
] as const;

/** Forward runtime and transport settings without inheriting provider secrets. */
export function getCodingAgentEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): Record<string, string | undefined> {
  return Object.fromEntries(AGENT_ENVIRONMENT_KEYS.map(key => [key, environment[key]]));
}
