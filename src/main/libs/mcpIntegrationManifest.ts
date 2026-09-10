export const IntegrationKind = {
  Official: 'official',
  Custom: 'custom',
} as const;
export type IntegrationKind = (typeof IntegrationKind)[keyof typeof IntegrationKind];

export const IntegrationInstallMode = {
  BundledCli: 'bundled-cli',
  None: 'none',
} as const;
export type IntegrationInstallMode =
  (typeof IntegrationInstallMode)[keyof typeof IntegrationInstallMode];

export const IntegrationAuthenticationMode = {
  DeviceCode: 'device-code',
  None: 'none',
} as const;
export type IntegrationAuthenticationMode =
  (typeof IntegrationAuthenticationMode)[keyof typeof IntegrationAuthenticationMode];

export const ConnectorToolRisk = {
  Read: 'read',
  Write: 'write',
} as const;
export type ConnectorToolRisk = (typeof ConnectorToolRisk)[keyof typeof ConnectorToolRisk];

export interface ConnectorToolManifestEntry {
  id: string;
  risk: ConnectorToolRisk;
  description: string;
}

export interface OfficialIntegrationManifest {
  id: string;
  kind: typeof IntegrationKind.Official;
  displayName: string;
  version: string;
  installMode: IntegrationInstallMode;
  authenticationMode: IntegrationAuthenticationMode;
  packageName?: string;
  toolAllowlist: ConnectorToolManifestEntry[];
}

export const OfficialIntegrationId = {
  Feishu: 'feishu',
} as const;
export type OfficialIntegrationId =
  (typeof OfficialIntegrationId)[keyof typeof OfficialIntegrationId];

/**
 * Bundled manifests are product-owned, version-pinned capability contracts.
 * Do not infer Pi tool access from a connector's dynamic CLI or MCP discovery.
 */
export const OfficialIntegrationManifests: Record<
  OfficialIntegrationId,
  OfficialIntegrationManifest
> = {
  [OfficialIntegrationId.Feishu]: {
    id: OfficialIntegrationId.Feishu,
    kind: IntegrationKind.Official,
    displayName: 'Feishu',
    version: '1.0.93',
    installMode: IntegrationInstallMode.BundledCli,
    authenticationMode: IntegrationAuthenticationMode.DeviceCode,
    packageName: '@larksuite/cli@1.0.93',
    // The current CLI/skill integration has no verified MCP tool protocol.
    // Keep this empty until each tool has an executable smoke test, parameter
    // schema, approval policy, and audit contract.
    toolAllowlist: [],
  },
};

export function getOfficialIntegrationManifest(
  id: string,
): OfficialIntegrationManifest | undefined {
  return Object.values(OfficialIntegrationManifests).find(manifest => manifest.id === id);
}

export function hasVerifiedAgentTools(manifest: OfficialIntegrationManifest): boolean {
  return manifest.toolAllowlist.length > 0;
}
