import { access, readFile, realpath } from 'fs/promises';
import { homedir } from 'os';
import path from 'path';

import {
  CodingAgentDriverKind,
  CodingAgentProfileStatus,
  type CodingAgentAuthMethod,
  type CodingAgentProfile,
} from '../../../shared/codingAgent';

type RegistryBinaryDistribution = { cmd?: unknown; args?: unknown };
type RegistryAgent = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  distribution?: {
    binary?: Record<string, RegistryBinaryDistribution>;
    npx?: { package?: unknown };
  };
};
type RegistrySnapshot = { agents?: RegistryAgent[] };

const NO_ACP_CAPABILITIES = {
  supportsLoadSession: false,
  supportsResumeSession: false,
  supportsPlans: false,
  supportsPermissions: false,
  supportsFilesystem: false,
  supportsTerminal: false,
  supportsConfigOptions: false,
  supportsUsage: false,
  supportsElicitation: false,
};

const uniqueDirectories = (directories: string[]): string[] => [
  ...new Set(directories.filter(Boolean)),
];

export const discoveryDirectories = (
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
  home = homedir(),
): string[] => {
  const paths = (environment.PATH ?? '').split(path.delimiter);
  const packagePrefixes = [
    environment.npm_config_prefix,
    environment.BUN_INSTALL,
    environment.VOLTA_HOME,
  ]
    .filter((prefix): prefix is string => Boolean(prefix))
    .map(prefix => path.join(prefix, 'bin'));
  const userDirectories =
    platform === 'win32'
      ? [
          environment.APPDATA ? path.join(environment.APPDATA, 'npm') : '',
          environment.LOCALAPPDATA ? path.join(environment.LOCALAPPDATA, 'pnpm') : '',
          path.join(home, '.bun', 'bin'),
        ]
      : [
          path.join(home, '.local', 'bin'),
          path.join(home, '.npm-global', 'bin'),
          path.join(home, '.bun', 'bin'),
          path.join(home, '.local', 'share', 'pnpm'),
          platform === 'darwin' ? path.join(home, 'Library', 'pnpm') : '',
        ];
  return uniqueDirectories([...paths, ...packagePrefixes, ...userDirectories]);
};

/** Passive discovery only: it never starts a discovered executable. */
export class AcpDiscoveryService {
  constructor(
    private readonly registryPath = path.join(process.cwd(), 'resources', 'acp', 'registry.json'),
  ) {}

  async discover(): Promise<Array<Omit<CodingAgentProfile, 'id' | 'isBuiltin'>>> {
    const paths = discoveryDirectories(process.platform, process.env);
    const agents = await this.readRegistry();
    const profiles = await Promise.all(
      agents.map(async agent => {
        const resolved = await this.resolve(paths, this.executableNames(agent.executable));
        if (!resolved) return null;
        return {
          name: agent.name,
          description: `${agent.description} Detected locally. Probe before using.`,
          driverKind: CodingAgentDriverKind.Acp,
          status: CodingAgentProfileStatus.Detected,
          capabilities: NO_ACP_CAPABILITIES,
          authMethods: [] as CodingAgentAuthMethod[],
          command: resolved,
          args: agent.args,
        } satisfies Omit<CodingAgentProfile, 'id' | 'isBuiltin'>;
      }),
    );
    return profiles.filter((profile): profile is NonNullable<typeof profile> => profile !== null);
  }

  private async readRegistry(): Promise<Array<{ name: string; description: string; executable: string; args: string[] }>> {
    const snapshot = JSON.parse(await readFile(this.registryPath, 'utf8')) as RegistrySnapshot;
    const platformKey = this.platformKey();
    return (snapshot.agents ?? []).flatMap(agent => {
      if (typeof agent.id !== 'string' || typeof agent.name !== 'string') return [];
      const binary = agent.distribution?.binary?.[platformKey];
      const npxPackage = agent.distribution?.npx?.package;
      const command =
        typeof binary?.cmd === 'string'
          ? path.basename(binary.cmd)
          : typeof npxPackage === 'string'
            ? npxPackage.replace(/@[^@]+$/, '').split('/').at(-1)
            : null;
      if (!command) return [];
      return [{
        name: agent.name,
        description: typeof agent.description === 'string' ? agent.description : 'ACP agent.',
        executable: command,
        args: Array.isArray(binary?.args)
          ? binary.args.filter((arg): arg is string => typeof arg === 'string')
          : [],
      }];
    });
  }

  private platformKey(): string {
    const architecture = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
    if (process.platform === 'darwin') return `darwin-${architecture}`;
    if (process.platform === 'win32') return `windows-${architecture}`;
    return `linux-${architecture}`;
  }

  private executableNames(executable: string): string[] {
    if (process.platform !== 'win32') return [executable];
    return [executable, `${executable}.exe`, `${executable}.cmd`, `${executable}.bat`];
  }

  private async resolve(paths: string[], executables: string[]): Promise<string | null> {
    for (const directory of paths) {
      for (const executable of executables) {
        const candidate = path.resolve(directory || process.cwd(), executable);
        try {
          await access(candidate);
          return await realpath(candidate);
        } catch {
          /* try next known user-level location */
        }
      }
    }
    return null;
  }
}
