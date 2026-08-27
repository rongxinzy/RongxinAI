import {
  CodingAgentEnvironmentKey,
  CodingAgentManagedAdapterId,
  CodingAgentProfileStatus,
  type CodingAgentEnvironmentKey as CodingAgentEnvironmentKeyValue,
  type CodingAgentProfile,
} from '../../../shared/codingAgent';

export interface BundledAcpAdapterDefinition {
  id: CodingAgentManagedAdapterId;
  registryId: string;
  profileName: string;
  legacyProfileNames: string[];
  description: string;
  cliExecutable: string;
  packageName: string;
  packageBinName: string;
  cliPathEnvironmentKey: CodingAgentEnvironmentKeyValue;
}

export const BUNDLED_ACP_ADAPTERS: BundledAcpAdapterDefinition[] = [
  {
    id: CodingAgentManagedAdapterId.Codex,
    registryId: 'codex-acp',
    profileName: 'Codex',
    legacyProfileNames: ['Codex'],
    description: 'Uses the Codex installation, account, and configuration on this device.',
    cliExecutable: 'codex',
    packageName: '@agentclientprotocol/codex-acp',
    packageBinName: 'codex-acp',
    cliPathEnvironmentKey: CodingAgentEnvironmentKey.CodexPath,
  },
  {
    id: CodingAgentManagedAdapterId.ClaudeCode,
    registryId: 'claude-acp',
    profileName: 'Claude Code',
    legacyProfileNames: ['Claude Agent', 'Claude Code'],
    description: 'Uses the Claude Code installation, account, and configuration on this device.',
    cliExecutable: 'claude',
    packageName: '@agentclientprotocol/claude-agent-acp',
    packageBinName: 'claude-agent-acp',
    cliPathEnvironmentKey: CodingAgentEnvironmentKey.ClaudeCodeExecutable,
  },
];

export const bundledAdapterDefinition = (
  profile: Pick<CodingAgentProfile, 'name' | 'environment' | 'status'>,
): BundledAcpAdapterDefinition | undefined => {
  const managedId = profile.environment[CodingAgentEnvironmentKey.ManagedAdapterId];
  return BUNDLED_ACP_ADAPTERS.find(
    adapter =>
      adapter.id === managedId ||
      (adapter.legacyProfileNames.includes(profile.name) &&
        profile.status === CodingAgentProfileStatus.NeedsAdapter),
  );
};
