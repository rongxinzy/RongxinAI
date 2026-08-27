import { access, realpath } from 'fs/promises';
import { homedir } from 'os';
import path from 'path';

import {
  CodingAgentDriverKind,
  CodingAgentProfileStatus,
  type CodingAgentAuthMethod,
  type CodingAgentProfile,
} from '../../../shared/codingAgent';

const CANDIDATES = [
  { executable: 'claude', name: 'Claude Code', args: ['--acp'] },
  { executable: 'codex', name: 'Codex', args: ['app-server'] },
  { executable: 'opencode', name: 'OpenCode', args: ['acp'] },
] as const;

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
  async discover(): Promise<Array<Omit<CodingAgentProfile, 'id' | 'isBuiltin'>>> {
    const paths = discoveryDirectories(process.platform, process.env);
    const profiles = await Promise.all(
      CANDIDATES.map(async candidate => {
        const resolved = await this.resolve(paths, this.executableNames(candidate.executable));
        if (!resolved) return null;
        return {
          name: candidate.name,
          description: 'Detected locally. Probe before using.',
          driverKind: CodingAgentDriverKind.Acp,
          status: CodingAgentProfileStatus.Detected,
          capabilities: NO_ACP_CAPABILITIES,
          authMethods: [] as CodingAgentAuthMethod[],
          command: resolved,
          args: candidate.args,
        } satisfies Omit<CodingAgentProfile, 'id' | 'isBuiltin'>;
      }),
    );
    return profiles.filter((profile): profile is NonNullable<typeof profile> => profile !== null);
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
