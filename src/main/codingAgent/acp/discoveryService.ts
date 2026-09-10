import { access, readdir, readFile, realpath } from 'fs/promises';
import { homedir } from 'os';
import path from 'path';

import {
  CodingAgentDriverKind,
  CodingAgentEnvironmentKey,
  CodingAgentManagedAdapterId,
  CodingAgentProfileStatus,
  type CodingAgentAuthMethod,
  type CodingAgentProfile,
} from '../../../shared/codingAgent';
import { BUNDLED_ACP_ADAPTERS, type BundledAcpAdapterDefinition } from './bundledAdapters';

type RegistryLaunchDistribution = {
  package?: unknown;
  executable?: unknown;
  args?: unknown;
  env?: unknown;
};
type RegistryBinaryDistribution = { cmd?: unknown; args?: unknown; env?: unknown };
type RegistryAgent = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  distribution?: {
    binary?: Record<string, RegistryBinaryDistribution>;
    npx?: RegistryLaunchDistribution;
    uvx?: RegistryLaunchDistribution;
  };
};
type RegistrySnapshot = { agents?: RegistryAgent[] };

interface PackageManifest {
  version?: unknown;
  bin?: unknown;
}

export interface AcpDiscoveryOptions {
  platform?: NodeJS.Platform;
  architecture?: string;
  environment?: NodeJS.ProcessEnv;
  home?: string;
  adapterRoot?: string;
  adapterHostExecutable?: string;
}

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
const stringArguments = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((arg): arg is string => typeof arg === 'string') : [];
const stringExecutables = (value: unknown): string[] =>
  typeof value === 'string' && value.trim() ? [value.trim()] : [];

const childDirectories = async (directory: string): Promise<string[]> => {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.filter(entry => entry.isDirectory()).map(entry => path.join(directory, entry.name));
  } catch {
    return [];
  }
};

const claudeNativeExecutablePath = (packageRoot: string): string =>
  path.join(packageRoot, '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');

/** Resolves npm and pnpm global-package layouts without executing a shell shim. */
export const resolveClaudeNativeExecutable = async (
  cliPath: string,
  platform: NodeJS.Platform,
): Promise<string> => {
  if (platform !== 'win32' || !/\.(?:cmd|ps1|bat)$/i.test(cliPath)) return cliPath;
  const binDirectory = path.dirname(cliPath);
  const packageRoots = [path.join(binDirectory, 'node_modules')];
  try {
    const pnpmGlobalDirectory = path.join(binDirectory, 'global');
    const entries = await readdir(pnpmGlobalDirectory, { withFileTypes: true });
    packageRoots.push(
      ...entries
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(pnpmGlobalDirectory, entry.name, 'node_modules')),
    );
  } catch {
    // The launcher is not installed through pnpm's global store.
  }
  for (const packageRoot of packageRoots) {
    try {
      return await realpath(claudeNativeExecutablePath(packageRoot));
    } catch {
      // Try the next known global-package layout.
    }
  }
  return cliPath;
};

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
  const environmentDirectories = [
    environment.PNPM_HOME,
    environment.NVM_BIN,
    environment.FNM_MULTISHELL_PATH ? path.join(environment.FNM_MULTISHELL_PATH, 'bin') : '',
  ].filter((directory): directory is string => Boolean(directory));
  const userDirectories =
    platform === 'win32'
      ? [
          environment.APPDATA ? path.join(environment.APPDATA, 'npm') : '',
          environment.LOCALAPPDATA ? path.join(environment.LOCALAPPDATA, 'pnpm') : '',
          environment.LOCALAPPDATA
            ? path.join(environment.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links')
            : '',
          environment.USERPROFILE ? path.join(environment.USERPROFILE, 'scoop', 'shims') : '',
          path.join(home, '.bun', 'bin'),
          path.join(home, '.cargo', 'bin'),
          path.join(home, '.kimi-code', 'bin'),
        ]
      : [
          '/opt/homebrew/bin',
          '/usr/local/bin',
          path.join(home, '.local', 'bin'),
          path.join(home, '.npm-global', 'bin'),
          path.join(home, '.bun', 'bin'),
          path.join(home, '.cargo', 'bin'),
          path.join(home, '.kimi-code', 'bin'),
          path.join(home, '.volta', 'bin'),
          path.join(home, '.local', 'share', 'mise', 'shims'),
          path.join(home, '.local', 'share', 'fnm'),
          path.join(home, '.local', 'share', 'pnpm'),
          platform === 'darwin' ? path.join(home, 'Library', 'pnpm') : '',
        ];
  return uniqueDirectories([...paths, ...packagePrefixes, ...environmentDirectories, ...userDirectories]);
};

/** Passive discovery only: it never starts a discovered executable. */
export class AcpDiscoveryService {
  private readonly platform: NodeJS.Platform;
  private readonly architecture: string;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly home: string;
  private readonly adapterRoot: string;
  private readonly adapterHostExecutable: string;
  private readonly packageBins = new Map<string, Promise<string[]>>();

  constructor(
    private readonly registryPath = path.join(process.cwd(), 'resources', 'acp', 'registry.json'),
    options: AcpDiscoveryOptions = {},
  ) {
    this.platform = options.platform ?? process.platform;
    this.architecture = options.architecture ?? process.arch;
    this.environment = options.environment ?? process.env;
    this.home = options.home ?? homedir();
    this.adapterRoot = options.adapterRoot ?? process.cwd();
    this.adapterHostExecutable = options.adapterHostExecutable ?? process.execPath;
  }

  async discover(): Promise<Array<Omit<CodingAgentProfile, 'id' | 'isBuiltin'>>> {
    const directories = await this.resolutionDirectories();
    const bundledProfiles = await Promise.all(
      BUNDLED_ACP_ADAPTERS.map(adapter => this.discoverBundledAdapter(directories, adapter)),
    );
    const bundledRegistryIds = new Set(BUNDLED_ACP_ADAPTERS.map(adapter => adapter.registryId));
    const agents = (await this.readRegistry()).filter(agent => !bundledRegistryIds.has(agent.id));
    const registryProfiles = await Promise.all(
      agents.map(async agent => {
        const resolved = await this.resolve(
          directories,
          agent.executables.flatMap(executable => this.executableNames(executable)),
        );
        if (!resolved) return null;
        return this.profile({
          name: agent.name,
          description: `${agent.description} Detected locally. Probe before using.`,
          command: resolved,
          args: agent.args,
          environment: {
            ...agent.environment,
            [CodingAgentEnvironmentKey.RegistryAgentId]: agent.id,
          },
        });
      }),
    );
    return [...bundledProfiles, ...registryProfiles].filter(
      (profile): profile is NonNullable<typeof profile> => profile !== null,
    );
  }

  private async discoverBundledAdapter(
    directories: string[],
    adapter: BundledAcpAdapterDefinition,
  ): Promise<Omit<CodingAgentProfile, 'id' | 'isBuiltin'> | null> {
    const cliPath = await this.resolve(
      directories,
      this.executableNames(adapter.cliExecutable),
      true,
    );
    if (!cliPath) return null;
    const resolvedCliPath =
      adapter.id === CodingAgentManagedAdapterId.ClaudeCode
        ? await resolveClaudeNativeExecutable(cliPath, this.platform)
        : cliPath;
    const packageRoot = path.join(this.adapterRoot, 'node_modules', adapter.packageName);
    const manifest = await this.readPackageManifest(path.join(packageRoot, 'package.json'));
    if (!manifest || typeof manifest.version !== 'string') return null;
    const entry = this.packageBinEntry(manifest.bin, adapter.packageBinName);
    if (!entry) return null;
    const adapterEntrypoint = path.resolve(packageRoot, entry);
    try {
      await access(adapterEntrypoint);
    } catch {
      return null;
    }
    return this.profile({
      name: adapter.profileName,
      description: adapter.description,
      command: this.adapterHostExecutable,
      args: [adapterEntrypoint],
      environment: {
        [CodingAgentEnvironmentKey.ElectronRunAsNode]: '1',
        [CodingAgentEnvironmentKey.ManagedAdapterId]: adapter.id,
        [CodingAgentEnvironmentKey.ManagedAdapterVersion]: manifest.version,
        [adapter.cliPathEnvironmentKey]: resolvedCliPath,
      },
    });
  }

  private profile(input: {
    name: string;
    description: string;
    command: string;
    args: string[];
    environment: Record<string, string>;
  }): Omit<CodingAgentProfile, 'id' | 'isBuiltin'> {
    return {
      ...input,
      driverKind: CodingAgentDriverKind.Acp,
      status: CodingAgentProfileStatus.Detected,
      capabilities: NO_ACP_CAPABILITIES,
      authMethods: [] as CodingAgentAuthMethod[],
    };
  }

  private async readRegistry(): Promise<
    Array<{
      id: string;
      name: string;
      description: string;
      executables: string[];
      args: string[];
      environment: Record<string, string>;
    }>
  > {
    const snapshot = JSON.parse(await readFile(this.registryPath, 'utf8')) as RegistrySnapshot;
    const platformKey = this.platformKey();
    return await Promise.all(
      (snapshot.agents ?? []).map(async agent => {
        if (typeof agent.id !== 'string' || typeof agent.name !== 'string') return [];
        const binary = agent.distribution?.binary?.[platformKey];
        const candidates = await this.registryLaunchCandidates(agent, binary);
        return candidates.map(candidate => ({
          id: agent.id as string,
          name: agent.name as string,
          description: typeof agent.description === 'string' ? agent.description : 'ACP agent.',
          ...candidate,
        }));
      }),
    ).then(entries => entries.flat());
  }

  private async registryLaunchCandidates(
    agent: RegistryAgent,
    binary: RegistryBinaryDistribution | undefined,
  ): Promise<Array<{ executables: string[]; args: string[]; environment: Record<string, string> }>> {
    if (typeof binary?.cmd === 'string') {
      return [
        {
          executables: [path.basename(binary.cmd)],
          args: stringArguments(binary.args),
          environment: this.registryEnvironment(binary.env),
        },
      ];
    }
    const npx = agent.distribution?.npx;
    const npxExecutables = await this.packageBinNames(npx?.package);
    if (npxExecutables.length) {
      return [
        {
          executables: npxExecutables,
          args: stringArguments(npx?.args),
          environment: this.registryEnvironment(npx?.env),
        },
      ];
    }
    const uvx = agent.distribution?.uvx;
    const uvxExecutables = stringExecutables(uvx?.executable);
    if (uvxExecutables.length) {
      return [
        {
          executables: uvxExecutables,
          args: stringArguments(uvx?.args),
          environment: this.registryEnvironment(uvx?.env),
        },
      ];
    }
    return [];
  }

  private registryEnvironment(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object') return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  }

  private async packageBinNames(packageSpec: unknown): Promise<string[]> {
    if (typeof packageSpec !== 'string') return [];
    const cached = this.packageBins.get(packageSpec);
    if (cached) return await cached;
    const resolving = this.resolvePackageBinNames(packageSpec);
    this.packageBins.set(packageSpec, resolving);
    return await resolving;
  }

  private async resolvePackageBinNames(packageSpec: string): Promise<string[]> {
    const packageName = packageSpec.replace(/@[^@]+$/, '');
    const directories = await this.resolutionDirectories();
    const manifests = [
      path.join(this.adapterRoot, 'node_modules', packageName, 'package.json'),
      ...directories.flatMap(directory => [
        // Windows npm global: %APPDATA%\npm\node_modules\<pkg>
        path.join(directory, 'node_modules', packageName, 'package.json'),
        // Unix-style: <prefix>/lib/node_modules/<pkg> (nvm, fnm, etc.)
        path.resolve(directory, '..', 'node_modules', packageName, 'package.json'),
        path.resolve(directory, '..', 'lib', 'node_modules', packageName, 'package.json'),
      ]),
      ...(await this.pnpmPackageManifests(directories, packageName)),
    ];
    for (const manifestPath of uniqueDirectories(manifests)) {
      const manifest = await this.readPackageManifest(manifestPath);
      if (!manifest) continue;
      if (typeof manifest.bin === 'string') return [path.basename(manifest.bin)];
      if (manifest.bin && typeof manifest.bin === 'object') return Object.keys(manifest.bin);
    }
    return [];
  }

  private async resolutionDirectories(): Promise<string[]> {
    const directories = discoveryDirectories(this.platform, this.environment, this.home);
    if (this.platform === 'win32') return directories;

    const nvmDirectory = this.environment.NVM_DIR || path.join(this.home, '.nvm');
    const fnmDirectory = this.environment.FNM_DIR || path.join(this.home, '.local', 'share', 'fnm');
    const [nvmVersions, fnmVersions] = await Promise.all([
      childDirectories(path.join(nvmDirectory, 'versions', 'node')),
      childDirectories(path.join(fnmDirectory, 'node-versions')),
    ]);
    return uniqueDirectories([
      ...directories,
      ...nvmVersions.map(version => path.join(version, 'bin')),
      ...fnmVersions.map(version => path.join(version, 'installation', 'bin')),
    ]);
  }

  private async pnpmPackageManifests(
    directories: string[],
    packageName: string,
  ): Promise<string[]> {
    const pnpmHomes = uniqueDirectories(
      directories.filter(
        directory =>
          directory === this.environment.PNPM_HOME || path.basename(directory).toLowerCase() === 'pnpm',
      ),
    );
    const globalDirectories = (
      await Promise.all(pnpmHomes.map(home => childDirectories(path.join(home, 'global'))))
    ).flat();
    return globalDirectories.map(globalDirectory =>
      path.join(globalDirectory, 'node_modules', packageName, 'package.json'),
    );
  }

  private async readPackageManifest(manifestPath: string): Promise<PackageManifest | null> {
    try {
      return JSON.parse(await readFile(manifestPath, 'utf8')) as PackageManifest;
    } catch {
      return null;
    }
  }

  private packageBinEntry(bin: unknown, name: string): string | null {
    if (typeof bin === 'string') return bin;
    if (!bin || typeof bin !== 'object') return null;
    const entry = (bin as Record<string, unknown>)[name];
    return typeof entry === 'string' ? entry : null;
  }

  private platformKey(): string {
    const architecture = this.architecture === 'arm64' ? 'aarch64' : 'x86_64';
    if (this.platform === 'darwin') return `darwin-${architecture}`;
    if (this.platform === 'win32') return `windows-${architecture}`;
    return `linux-${architecture}`;
  }

  private executableNames(executable: string): string[] {
    if (this.platform !== 'win32') return [executable];
    return [`${executable}.exe`, `${executable}.cmd`, `${executable}.bat`, executable];
  }

  private async resolve(
    paths: string[],
    executables: string[],
    excludeApplicationDependencies = false,
  ): Promise<string | null> {
    const applicationDependencies = path.join(this.adapterRoot, 'node_modules');
    for (const directory of paths) {
      for (const executable of executables) {
        const candidate = path.resolve(directory || process.cwd(), executable);
        try {
          await access(candidate);
          const resolved = await realpath(candidate);
          if (
            excludeApplicationDependencies &&
            this.isWithinDirectory(resolved, applicationDependencies)
          ) {
            continue;
          }
          return resolved;
        } catch {
          /* try next known user-level location */
        }
      }
    }
    return null;
  }

  private isWithinDirectory(candidate: string, directory: string): boolean {
    const relative = path.relative(directory, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  }
}
