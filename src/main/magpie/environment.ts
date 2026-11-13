import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
// A concrete 0.0.0.0 host makes the gateway require a key for every non-loopback request.
const MAGPIE_LAN_GATEWAY_HOST = '0.0.0.0';
const MAGPIE_LOOPBACK_GATEWAY_HOST = '127.0.0.1';
const SETTINGS_MAX_BYTES = 1024 * 1024;
const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function renameWithRetry(source: string, target: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.rename(source, target);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !RENAME_RETRY_CODES.has(code) || attempt >= 3) throw error;
      await delay(25 * attempt);
    }
  }
}

async function writeAtomicJson(file: string, content: string): Promise<void> {
  const dir = path.dirname(file);
  const tmp = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`,
  );
  try {
    await fs.writeFile(tmp, content, { mode: 0o600 });
    await renameWithRetry(tmp, file);
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

async function backupCorruptSettings(file: string): Promise<void> {
  const backup = `${file}.corrupt-${Date.now()}`;
  try {
    await fs.rename(file, backup);
  } catch {
    // Best-effort backup; caller still overwrites with clean defaults.
  }
}
export function isolatedMagpieEnvironment(
  root: string,
  gatewayPort: number,
  webKey: string,
  source: NodeJS.ProcessEnv = process.env,
  subscriptionAccountsEnabled = false,
  lanGatewayEnabled = false,
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
    MAGPIE_ADDR: `${lanGatewayEnabled ? MAGPIE_LAN_GATEWAY_HOST : MAGPIE_LOOPBACK_GATEWAY_HOST}:${gatewayPort}`,
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
  let corrupt = false;
  try {
    const stat = await fs.stat(file);
    if (stat.size > SETTINGS_MAX_BYTES) throw new Error('Model service settings exceed size limit');
    const raw = await fs.readFile(file, 'utf8');
    const trimmed = raw.replace(/\0/g, '').trim();
    if (!trimmed || raw.includes('\0')) {
      corrupt = true;
    } else {
      const parsed: unknown = JSON.parse(trimmed);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        corrupt = true;
      } else {
        settings = parsed as Record<string, unknown>;
      }
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      corrupt = true;
    } else if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  if (corrupt) {
    console.warn(
      '[Magpie] Corrupted model service settings.json recovered; resetting to defaults.',
    );
    await backupCorruptSettings(file);
    settings = {};
  }
  await writeAtomicJson(
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
  );
}
