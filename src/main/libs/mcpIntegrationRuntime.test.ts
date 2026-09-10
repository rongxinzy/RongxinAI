import { expect, test, vi } from 'vitest';

import {
  IntegrationOperation,
  IntegrationRuntimePhase,
  McpIntegrationRuntime,
  type OfficialConnector,
} from './mcpIntegrationRuntime';
import {
  IntegrationAuthenticationMode,
  IntegrationInstallMode,
  IntegrationKind,
} from './mcpIntegrationManifest';

const createConnector = (): OfficialConnector => ({
  manifest: {
    id: 'example',
    kind: IntegrationKind.Official,
    displayName: 'Example',
    version: '1.0.0',
    installMode: IntegrationInstallMode.None,
    authenticationMode: IntegrationAuthenticationMode.None,
    toolAllowlist: [],
  },
  provision: vi.fn(async () => {}),
  authenticate: vi.fn(async () => {}),
  verify: vi.fn(async () => {}),
  repair: vi.fn(async () => {}),
  uninstall: vi.fn(async () => {}),
});

test('moves an official connector through provision and authentication', async () => {
  const runtime = new McpIntegrationRuntime();
  const connector = createConnector();
  runtime.register(connector);

  const provisioned = await runtime.run('example', IntegrationOperation.Provision);
  const authenticated = await runtime.run('example', IntegrationOperation.Authenticate);

  expect(provisioned).toMatchObject({
    phase: IntegrationRuntimePhase.NeedsAuthorization,
    nextOperation: IntegrationOperation.Authenticate,
  });
  expect(authenticated.phase).toBe(IntegrationRuntimePhase.Ready);
  expect(connector.provision).toHaveBeenCalledOnce();
  expect(connector.authenticate).toHaveBeenCalledOnce();
});

test('returns repair diagnostics instead of throwing connector failures', async () => {
  const runtime = new McpIntegrationRuntime();
  const connector = createConnector();
  vi.mocked(connector.verify).mockRejectedValueOnce(new Error('CLI is unavailable'));
  runtime.register(connector);

  const status = await runtime.run('example', IntegrationOperation.Verify);

  expect(status).toEqual({
    integrationId: 'example',
    phase: IntegrationRuntimePhase.NeedsRepair,
    error: 'CLI is unavailable',
    nextOperation: IntegrationOperation.Repair,
  });
});
