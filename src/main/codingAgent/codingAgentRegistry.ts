import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import path from 'path';

import {
  CodingAgentDriverKind,
  CodingAgentProfileStatus,
  type CodingAgentCapabilities,
  type CodingAgentProfile,
} from '../../shared/codingAgent';
import { AcpDiscoveryService } from './acp/discoveryService';
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
  supportsConfigOptions: false,
  supportsUsage: true,
  supportsElicitation: true,
};

const BUILTIN_PROFILE_ID = 'builtin-zhiyuan-coding';

export class CodingAgentRegistry extends EventEmitter {
  private readonly profiles = new Map<string, CodingAgentProfile>();

  constructor(
    private readonly repository?: CodingAgentProfileRepository,
    private readonly isBuiltinReady: () => boolean = () => true,
  ) {
    super();
    this.profiles.set(BUILTIN_PROFILE_ID, {
      id: BUILTIN_PROFILE_ID,
      name: '知远编程 Agent',
      description: '无需安装外部 Agent',
      driverKind: CodingAgentDriverKind.Builtin,
      status: CodingAgentProfileStatus.Ready,
      capabilities: BUILTIN_CAPABILITIES,
      authMethods: [],
      command: null,
      args: [],
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
    const profile = this.profiles.get(BUILTIN_PROFILE_ID);
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
    const registered = { ...profile, id: randomUUID(), isBuiltin: false };
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
      (profile.status !== CodingAgentProfileStatus.Detected &&
        profile.status !== CodingAgentProfileStatus.Unavailable)
    ) {
      throw new Error('The coding agent profile cannot be probed.');
    }
    try {
      const result = await new AcpProbeService().probe({
        executable: profile.command,
        args: profile.args,
        cwd,
        environment: this.allowedEnvironment(),
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
    const discovered = await new AcpDiscoveryService().discover();
    for (const profile of discovered) {
      if (this.list().some(existing => existing.command === profile.command)) continue;
      this.registerExternal(profile);
    }
  }

  private allowedEnvironment(): Record<string, string | undefined> {
    const keys = ['PATH', 'HOME', 'USER', 'SHELL', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL'];
    return Object.fromEntries(keys.map(key => [key, process.env[key]]));
  }
}
