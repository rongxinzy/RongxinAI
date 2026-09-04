import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import path from 'path';

import {
  CodingAgentDriverKind,
  CodingAgentEnvironmentKey,
  CodingAgentProfileId,
  CodingAgentProfileStatus,
  type CodingAgentCapabilities,
  type CodingAgentProfile,
} from '../../shared/codingAgent';
import { AcpDiscoveryService, type AcpDiscoveryOptions } from './acp/discoveryService';
import { BUNDLED_ACP_ADAPTERS, bundledAdapterDefinition } from './acp/bundledAdapters';
import { AcpProbeService } from './acp/probeService';
import { AcpProtocolIncompatibleError } from './acp/protocol';
import type { CodingAgentProfileRepository } from './codingAgentProfileRepository';

const BUILTIN_CAPABILITIES: CodingAgentCapabilities = {
  supportsLoadSession: true,
  supportsResumeSession: true,
  supportsPlans: true,
  supportsPermissions: true,
  supportsFilesystem: true,
  supportsTerminal: true,
  supportsConfigOptions: true,
  supportsUsage: true,
  supportsElicitation: true,
};

export class CodingAgentRegistry extends EventEmitter {
  private readonly profiles = new Map<string, CodingAgentProfile>();

  constructor(
    private readonly repository?: CodingAgentProfileRepository,
    private readonly isBuiltinReady: () => boolean = () => true,
    private readonly acpRegistryPath?: string,
    private readonly acpAdapterRoot = process.cwd(),
    private readonly acpDiscoveryOptions: Omit<AcpDiscoveryOptions, 'adapterRoot'> = {},
  ) {
    super();
    this.profiles.set(CodingAgentProfileId.Builtin, {
      id: CodingAgentProfileId.Builtin,
      name: '知远编程 Agent',
      description: '无需安装外部 Agent',
      driverKind: CodingAgentDriverKind.Builtin,
      status: CodingAgentProfileStatus.Ready,
      capabilities: BUILTIN_CAPABILITIES,
      authMethods: [],
      command: null,
      args: [],
      environment: {},
      isBuiltin: true,
    });
  }

  list(): CodingAgentProfile[] {
    return [...this.profiles.values()];
  }
  get(id: string): CodingAgentProfile | undefined {
    return this.profiles.get(id);
  }
  refreshBuiltinReadiness(): CodingAgentProfile {
    const profile = this.profiles.get(CodingAgentProfileId.Builtin);
    if (!profile) throw new Error('The built-in coding agent profile was not found.');
    const status = this.isBuiltinReady()
      ? CodingAgentProfileStatus.Ready
      : CodingAgentProfileStatus.NeedsConfiguration;
    if (profile.status === status) return profile;
    const updated = { ...profile, status };
    this.profiles.set(updated.id, updated);
    this.emit('changed');
    return updated;
  }
  hydrate(): void {
    for (const profile of this.repository?.listExternal() ?? [])
      this.profiles.set(profile.id, profile);
    this.emit('changed');
  }
  registerExternal(profile: Omit<CodingAgentProfile, 'id' | 'isBuiltin'>): CodingAgentProfile {
    const registered = {
      ...profile,
      environment: profile.environment ?? {},
      id: randomUUID(),
      isBuiltin: false,
    };
    this.profiles.set(registered.id, registered);
    this.repository?.save(registered);
    this.emit('changed');
    return registered;
  }

  addUntrustedProfile(input: {
    name: string;
    description: string;
    command: string;
    args: string[];
  }): CodingAgentProfile {
    const command = input.command.trim();
    if (!path.isAbsolute(command))
      throw new Error('Custom coding agent commands must use an absolute path.');
    if (!input.name.trim()) throw new Error('Coding agent name is required.');
    if (command.includes('\0') || input.args.some(arg => !arg || arg.includes('\0'))) {
      throw new Error('Custom coding agent command arguments are invalid.');
    }
    return this.registerExternal({
      name: input.name.trim(),
      description: input.description.trim(),
      driverKind: CodingAgentDriverKind.Acp,
      status: CodingAgentProfileStatus.Untrusted,
      capabilities: {
        supportsLoadSession: false,
        supportsResumeSession: false,
        supportsPlans: false,
        supportsPermissions: false,
        supportsFilesystem: false,
        supportsTerminal: false,
        supportsConfigOptions: false,
        supportsUsage: false,
        supportsElicitation: false,
      },
      authMethods: [],
      command,
      args: input.args,
      environment: {},
    });
  }

  trust(profileId: string): CodingAgentProfile {
    const profile = this.profiles.get(profileId);
    if (!profile || profile.isBuiltin)
      throw new Error('The coding agent profile cannot be trusted.');
    const updated = { ...profile, status: CodingAgentProfileStatus.Detected };
    this.profiles.set(updated.id, updated);
    this.repository?.save(updated);
    this.emit('changed');
    return updated;
  }

  markNeedsAuth(profileId: string): CodingAgentProfile {
    const profile = this.profiles.get(profileId);
    if (!profile || profile.isBuiltin)
      throw new Error('The coding agent profile cannot require external authentication.');
    const updated = { ...profile, status: CodingAgentProfileStatus.NeedsAuth };
    this.profiles.set(updated.id, updated);
    this.repository?.save(updated);
    this.emit('changed');
    return updated;
  }

  markReady(profileId: string): CodingAgentProfile {
    const profile = this.profiles.get(profileId);
    if (!profile) throw new Error('The coding agent profile was not found.');
    const updated = { ...profile, status: CodingAgentProfileStatus.Ready };
    this.profiles.set(updated.id, updated);
    this.repository?.save(updated);
    this.emit('changed');
    return updated;
  }

  async probe(profileId: string, cwd: string): Promise<CodingAgentProfile> {
    const profile = this.profiles.get(profileId);
    if (
      !profile ||
      profile.isBuiltin ||
      !profile.command ||
      // NeedsAuth is probeable too: a successful probe means the agent is
      // reachable again, and if it still needs login the next session
      // creation will mark it NeedsAuth once more.
      (profile.status !== CodingAgentProfileStatus.Detected &&
        profile.status !== CodingAgentProfileStatus.Unavailable &&
        profile.status !== CodingAgentProfileStatus.NeedsAuth)
    ) {
      throw new Error('The coding agent profile cannot be probed.');
    }
    try {
      const result = await new AcpProbeService().probe({
        executable: profile.command,
        args: profile.args,
        cwd,
        environment: { ...this.allowedEnvironment(), ...profile.environment },
      });
      const updated = {
        ...profile,
        capabilities: result.capabilities,
        authMethods: result.authMethods,
        status: CodingAgentProfileStatus.Ready,
      };
      this.profiles.set(updated.id, updated);
      this.repository?.save(updated);
      this.emit('changed');
      return updated;
    } catch (error) {
      const updated = {
        ...profile,
        status:
          error instanceof AcpProtocolIncompatibleError
            ? CodingAgentProfileStatus.Incompatible
            : CodingAgentProfileStatus.Unavailable,
      };
      this.profiles.set(updated.id, updated);
      this.repository?.save(updated);
      this.emit('changed');
      throw error;
    }
  }

  async discoverExternalAgents(): Promise<void> {
    const discovered = await new AcpDiscoveryService(this.acpRegistryPath, {
      ...this.acpDiscoveryOptions,
      adapterRoot: this.acpAdapterRoot,
    }).discover();
    const availableManagedAdapters = new Set<string>();
    for (const profile of discovered) {
      const managedAdapterId = profile.environment[CodingAgentEnvironmentKey.ManagedAdapterId];
      if (managedAdapterId) availableManagedAdapters.add(managedAdapterId);
      const matchingProfiles = this.findDiscoveredProfiles(profile);
      const existing = this.selectCanonicalDiscoveredProfile(matchingProfiles);
      if (!existing) {
        this.registerExternal(profile);
        continue;
      }
      const launchUnchanged = this.launchConfigurationMatches(existing, profile);
      this.replaceExternal({
        ...existing,
        ...profile,
        status: launchUnchanged ? existing.status : CodingAgentProfileStatus.Detected,
        capabilities: launchUnchanged ? existing.capabilities : profile.capabilities,
        authMethods: launchUnchanged ? existing.authMethods : profile.authMethods,
        id: existing.id,
        isBuiltin: false,
      });
      this.removeUnreferencedDuplicates(matchingProfiles, existing.id);
    }
    for (const existing of this.list().filter(profile => !profile.isBuiltin)) {
      const adapter = bundledAdapterDefinition(existing);
      if (!adapter || availableManagedAdapters.has(adapter.id)) continue;
      this.replaceExternal({
        ...existing,
        description: `${adapter.profileName} is not currently installed on this device.`,
        status: CodingAgentProfileStatus.Unavailable,
        command: null,
        args: [],
        environment: {
          [CodingAgentEnvironmentKey.ManagedAdapterId]: adapter.id,
        },
      });
    }
  }

  private findDiscoveredProfiles(
    discovered: Omit<CodingAgentProfile, 'id' | 'isBuiltin'>,
  ): CodingAgentProfile[] {
    const managedAdapterId = discovered.environment[CodingAgentEnvironmentKey.ManagedAdapterId];
    if (managedAdapterId) {
      const adapter = BUNDLED_ACP_ADAPTERS.find(candidate => candidate.id === managedAdapterId);
      return this.list().filter(
        existing =>
          !existing.isBuiltin &&
          (existing.environment[CodingAgentEnvironmentKey.ManagedAdapterId] === managedAdapterId ||
            (adapter?.legacyProfileNames.includes(existing.name) &&
              existing.status !== CodingAgentProfileStatus.Untrusted)),
      );
    }
    const registryAgentId = discovered.environment[CodingAgentEnvironmentKey.RegistryAgentId];
    return this.list().filter(existing => {
      if (existing.isBuiltin) return false;
      if (registryAgentId) {
        return (
          existing.environment[CodingAgentEnvironmentKey.RegistryAgentId] === registryAgentId ||
          this.isLegacyRegistryProfile(existing, discovered)
        );
      }
      return (
        existing.command === discovered.command &&
        this.argumentsMatch(existing.args, discovered.args)
      );
    });
  }

  private selectCanonicalDiscoveredProfile(
    profiles: CodingAgentProfile[],
  ): CodingAgentProfile | undefined {
    return profiles.find(profile => this.repository?.isReferenced(profile.id)) ??
      profiles.find(profile => profile.status === CodingAgentProfileStatus.Ready) ??
      profiles[0];
  }

  private isLegacyRegistryProfile(
    existing: CodingAgentProfile,
    discovered: Omit<CodingAgentProfile, 'id' | 'isBuiltin'>,
  ): boolean {
    return (
      existing.driverKind === CodingAgentDriverKind.Acp &&
      existing.status !== CodingAgentProfileStatus.Untrusted &&
      existing.name === discovered.name &&
      existing.description.endsWith('Detected locally. Probe before using.') &&
      this.argumentsMatch(existing.args, discovered.args)
    );
  }

  private removeUnreferencedDuplicates(
    profiles: CodingAgentProfile[],
    canonicalProfileId: string,
  ): void {
    for (const profile of profiles) {
      if (profile.id === canonicalProfileId) continue;
      if (
        this.repository &&
        !this.repository.removeIfUnreferenced(profile.id, canonicalProfileId)
      ) {
        continue;
      }
      this.profiles.delete(profile.id);
    }
  }

  private launchConfigurationMatches(
    existing: CodingAgentProfile,
    discovered: Omit<CodingAgentProfile, 'id' | 'isBuiltin'>,
  ): boolean {
    return (
      existing.command === discovered.command &&
      this.argumentsMatch(existing.args, discovered.args) &&
      JSON.stringify(existing.environment) === JSON.stringify(discovered.environment)
    );
  }

  private argumentsMatch(left: string[], right: string[]): boolean {
    return (
      left.length === right.length && left.every((argument, index) => argument === right[index])
    );
  }

  private replaceExternal(profile: CodingAgentProfile): void {
    this.profiles.set(profile.id, profile);
    this.repository?.save(profile);
    this.emit('changed');
  }

  private allowedEnvironment(): Record<string, string | undefined> {
    const keys = ['PATH', 'HOME', 'USER', 'SHELL', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL'];
    return Object.fromEntries(keys.map(key => [key, process.env[key]]));
  }
}
