import net from 'node:net';

const SUPPORTED_PLATFORMS = new Set([
  'telegram', 'discord', 'dingtalk', 'feishu', 'qq', 'wecom', 'weixin',
]);

type TomlValue = string | number | boolean | readonly string[];

export type CcConnectSidecarProject = {
  /** Stable ZhiYuan ChannelAccount id. It is never a user-visible cc-connect project. */
  accountId: string;
  platform: string;
  options: Readonly<Record<string, TomlValue>>;
};

export type CcConnectSidecarConfig = {
  dataDir: string;
  bridgeUrl: string;
  bridgeToken: string;
  /** The control plane stays local and is authenticated with bridgeToken. */
  cronControlListen: string;
  projects: readonly CcConnectSidecarProject[];
};

/**
 * Produces the only configuration format accepted by the ZhiYuan cc-connect
 * sidecar.  Deliberately do not expose upstream providers, commands, Web UI,
 * webhooks, or management APIs through this type.
 */
export function serializeCcConnectSidecarConfig(config: CcConnectSidecarConfig): string {
  assertNonEmpty('dataDir', config.dataDir);
  assertLoopbackUrl(config.bridgeUrl);
  assertNonEmpty('bridgeToken', config.bridgeToken);
  assertLoopbackListen(config.cronControlListen);
  // Each process owns exactly one authenticated channel account and one cron
  // control port. A multi-project config would make those projects compete for
  // the same listener inside the sidecar.
  if (config.projects.length !== 1) {
    throw new Error('cc-connect sidecar config must contain exactly one project');
  }

  const seenAccounts = new Set<string>();
  const lines = [
    `data_dir = ${tomlString(config.dataDir)}`,
    '',
    '[webhook]', 'enabled = false', '',
    '[bridge]', 'enabled = false', '',
    '[management]', 'enabled = false', '',
  ];

  for (const project of config.projects) {
    assertNonEmpty('accountId', project.accountId);
    if (!SUPPORTED_PLATFORMS.has(project.platform)) {
      throw new Error(`Unsupported cc-connect platform: ${project.platform}`);
    }
    if (seenAccounts.has(project.accountId)) {
      throw new Error(`Duplicate cc-connect accountId: ${project.accountId}`);
    }
    seenAccounts.add(project.accountId);

    lines.push(
      '[[projects]]',
      `name = ${tomlString(project.accountId)}`,
      '[projects.agent]',
      // The sidecar reads these bridge options itself and never creates this agent.
      'type = "zhiyuan-bridge"',
      '[projects.agent.options]',
      `bridge_url = ${tomlString(config.bridgeUrl)}`,
      `bridge_token = ${tomlString(config.bridgeToken)}`,
      `cron_control_listen = ${tomlString(config.cronControlListen)}`,
      '[[projects.platforms]]',
      `type = ${tomlString(project.platform)}`,
    );
    const entries = Object.entries(project.options).sort(([left], [right]) => left.localeCompare(right));
    if (entries.length > 0) lines.push('[projects.platforms.options]');
    for (const [key, value] of entries) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error(`Unsafe cc-connect option key: ${key}`);
      }
      lines.push(`${key} = ${tomlValue(value)}`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function assertNonEmpty(name: string, value: string): void {
  if (!value.trim()) throw new Error(`cc-connect ${name} is required`);
}

function assertLoopbackUrl(value: string): void {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('cc-connect bridgeUrl must be a URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || !isLoopback(url.hostname)) {
    throw new Error('cc-connect bridgeUrl must target loopback');
  }
}

function assertLoopbackListen(value: string): void {
  const normalized = value.trim();
  const separator = normalized.lastIndexOf(':');
  const host = normalized.slice(0, separator).replace(/^\[|\]$/g, '');
  const port = Number(normalized.slice(separator + 1));
  if (separator <= 0 || !isLoopback(host) || !Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('cc-connect cronControlListen must be a loopback host and port');
  }
}

function isLoopback(host: string): boolean {
  return host === 'localhost' || net.isIP(host) > 0 && (host === '::1' || host.startsWith('127.'));
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlValue(value: TomlValue): string {
  if (typeof value === 'string') return tomlString(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
    return `[${value.map(tomlString).join(', ')}]`;
  }
  throw new Error('Unsupported cc-connect option value');
}
