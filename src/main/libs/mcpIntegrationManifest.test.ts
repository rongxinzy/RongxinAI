import { expect, test } from 'vitest';

import {
  IntegrationAuthenticationMode,
  IntegrationInstallMode,
  IntegrationKind,
  OfficialIntegrationId,
  OfficialIntegrationManifests,
  getOfficialIntegrationManifest,
  hasVerifiedAgentTools,
} from './mcpIntegrationManifest';

test('defines the Feishu connector as a version-pinned official integration', () => {
  const manifest = getOfficialIntegrationManifest(OfficialIntegrationId.Feishu);

  expect(manifest).toEqual({
    id: OfficialIntegrationId.Feishu,
    kind: IntegrationKind.Official,
    displayName: 'Feishu',
    version: '1.0.93',
    installMode: IntegrationInstallMode.BundledCli,
    authenticationMode: IntegrationAuthenticationMode.DeviceCode,
    packageName: '@larksuite/cli@1.0.93',
    toolAllowlist: [],
  });
  expect(OfficialIntegrationManifests[OfficialIntegrationId.Feishu].packageName).not.toContain(
    '@latest',
  );
  expect(hasVerifiedAgentTools(OfficialIntegrationManifests[OfficialIntegrationId.Feishu])).toBe(
    false,
  );
});
