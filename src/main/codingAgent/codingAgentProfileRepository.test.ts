import Database from 'better-sqlite3';
import { afterEach, expect, test } from 'vitest';

import {
  CodingAgentDriverKind,
  CodingAgentProfileStatus,
  type CodingAgentProfile,
} from '../../shared/codingAgent';
import { CodingAgentProfileRepository } from './codingAgentProfileRepository';
import { CodingAgentRegistry } from './codingAgentRegistry';
import { initializeCodingAgentSchema } from './schema';

let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

test('requires explicit trust before a custom profile can be probed', () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const registry = new CodingAgentRegistry(new CodingAgentProfileRepository(db));
  const profile = registry.addUntrustedProfile({
    name: 'Custom Agent',
    description: 'User supplied command',
    command: '/usr/local/bin/custom-agent',
    args: ['acp'],
  });
  expect(profile.status).toBe(CodingAgentProfileStatus.Untrusted);
  expect(registry.trust(profile.id).status).toBe(CodingAgentProfileStatus.Detected);
  expect(registry.markNeedsAuth(profile.id).status).toBe(CodingAgentProfileStatus.NeedsAuth);
  expect(registry.markReady(profile.id).status).toBe(CodingAgentProfileStatus.Ready);
  expect(() =>
    registry.addUntrustedProfile({ name: 'Relative', description: '', command: 'agent', args: [] }),
  ).toThrow('absolute');
  expect(() =>
    registry.addUntrustedProfile({
      name: 'Invalid',
      description: '',
      command: '/usr/bin/agent',
      args: ['\0'],
    }),
  ).toThrow('invalid');
});

test('keeps the built-in agent visible while reflecting model configuration readiness', () => {
  const registry = new CodingAgentRegistry(undefined, () => false);

  const profile = registry.refreshBuiltinReadiness();

  expect(profile).toMatchObject({
    id: 'builtin-zhiyuan-coding',
    isBuiltin: true,
    status: CodingAgentProfileStatus.NeedsConfiguration,
  });
  expect(registry.list()).toHaveLength(1);
});

test('persists external agent profiles without storing credentials', () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const repository = new CodingAgentProfileRepository(db);
  const profile: CodingAgentProfile = {
    id: 'external-agent',
    name: 'External Agent',
    description: 'Detected adapter',
    driverKind: CodingAgentDriverKind.Acp,
    status: CodingAgentProfileStatus.Detected,
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
    command: '/usr/local/bin/agent',
    args: ['acp'],
    environment: {},
    isBuiltin: false,
  };

  repository.save(profile);

  expect(repository.listExternal()).toEqual([profile]);
  const registry = new CodingAgentRegistry(repository);
  registry.hydrate();
  expect(registry.list()).toEqual([
    expect.objectContaining({ id: 'builtin-zhiyuan-coding', isBuiltin: true }),
    profile,
  ]);
});
