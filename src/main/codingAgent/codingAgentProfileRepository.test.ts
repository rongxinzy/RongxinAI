import Database from 'better-sqlite3';
import { chmod, mkdir, rm, writeFile } from 'fs/promises';
import path from 'path';
import { afterEach, expect, test } from 'vitest';

import {
  CodingAgentDriverKind,
  CodingAgentEnvironmentKey,
  CodingAgentManagedAdapterId,
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

test('upgrades legacy Codex records to the bundled bridge and preserves the profile id', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const repository = new CodingAgentProfileRepository(db);
  const root = path.join(process.cwd(), `.coding-agent-registry-${Date.now()}`);
  const binDirectory = path.join(root, 'bin');
  const codexExecutable = path.join(binDirectory, 'codex');
  const adapterRoot = path.join(root, 'app');
  const adapterPackageRoot = path.join(
    adapterRoot,
    'node_modules',
    '@agentclientprotocol',
    'codex-acp',
  );
  const registryPath = path.join(root, 'registry.json');
  try {
    await mkdir(binDirectory, { recursive: true });
    await mkdir(path.join(adapterPackageRoot, 'dist'), { recursive: true });
    await writeFile(codexExecutable, '#!/bin/sh\nexit 0\n');
    await chmod(codexExecutable, 0o755);
    await writeFile(
      path.join(adapterPackageRoot, 'package.json'),
      JSON.stringify({ version: '1.6.2', bin: { 'codex-acp': 'dist/index.js' } }),
    );
    await writeFile(path.join(adapterPackageRoot, 'dist', 'index.js'), '');
    await writeFile(registryPath, JSON.stringify({ version: '1.0.0', agents: [] }));
    repository.save({
      id: 'legacy-codex',
      name: 'Codex',
      description: 'ACP Adapter required',
      driverKind: CodingAgentDriverKind.Acp,
      status: CodingAgentProfileStatus.NeedsAdapter,
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
      command: codexExecutable,
      args: [],
      environment: {},
      isBuiltin: false,
    });
    const registry = new CodingAgentRegistry(repository, () => true, registryPath, adapterRoot, {
      environment: { PATH: binDirectory },
      home: root,
    });
    registry.hydrate();

    await registry.discoverExternalAgents();

    expect(registry.get('legacy-codex')).toMatchObject({
      id: 'legacy-codex',
      name: 'Codex',
      status: CodingAgentProfileStatus.Detected,
      command: process.execPath,
      environment: {
        [CodingAgentEnvironmentKey.ElectronRunAsNode]: '1',
        [CodingAgentEnvironmentKey.ManagedAdapterId]: CodingAgentManagedAdapterId.Codex,
        [CodingAgentEnvironmentKey.ManagedAdapterVersion]: '1.6.2',
        [CodingAgentEnvironmentKey.CodexPath]: codexExecutable,
      },
    });
    registry.markReady('legacy-codex');
    await registry.discoverExternalAgents();
    expect(registry.get('legacy-codex')?.status).toBe(CodingAgentProfileStatus.Ready);

    await rm(codexExecutable);
    await registry.discoverExternalAgents();
    expect(registry.get('legacy-codex')).toMatchObject({
      status: CodingAgentProfileStatus.Unavailable,
      command: null,
      environment: {
        [CodingAgentEnvironmentKey.ManagedAdapterId]: CodingAgentManagedAdapterId.Codex,
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
