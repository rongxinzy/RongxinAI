import path from 'node:path';
import fs from 'node:fs/promises';
export function isolatedMagpieEnvironment(
  root: string,
  gatewayPort: number,
  webKey: string,
  source: NodeJS.ProcessEnv = process.env,
  subscriptionAccountsEnabled = false,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'PATH',
    'SystemRoot',
    'WINDIR',
    'COMSPEC',
    'PATHEXT',
    'LANG',
    'LC_ALL',
    'TMP',
    'TEMP',
  ]) {
    if (source[key]) env[key] = source[key];
  }
  return {
    ...env,
    DO_NOT_TRACK: '1',
    XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_CACHE_HOME: path.join(root, 'cache'),
    XDG_DATA_HOME: path.join(root, 'data'),
    XDG_STATE_HOME: path.join(root, 'state'),
    MAGPIE_NO_ACCOUNTS: subscriptionAccountsEnabled ? '0' : '1',
    MAGPIE_ADDR: `127.0.0.1:${gatewayPort}`,
    MAGPIE_WEB_KEY: webKey,
  };
}
export async function prepareMagpieHome(
  root: string,
  subscriptionAccountsEnabled = false,
): Promise<void> {
  const dir = path.join(root, 'config', 'magpie');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'settings.json');
  let settings: Record<string, unknown> = {};
  try {
    const stat = await fs.stat(file);
    if (stat.size > 1024 * 1024) throw new Error('Magpie settings exceed size limit');
    settings = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!settings || Array.isArray(settings) || typeof settings !== 'object')
      throw new Error('Invalid Magpie settings');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await fs.writeFile(
    file,
    JSON.stringify({
      ...settings,
      noAccountDiscovery: !subscriptionAccountsEnabled,
      noWSLAgents: true,
      noStats: true,
      noUsageStats: true,
      noAutoUpdate: true,
      lan: false,
      gatewayMode: 'off',
    }),
    { mode: 0o600 },
  );
}
