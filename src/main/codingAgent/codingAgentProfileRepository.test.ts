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

test('merges an upgraded registry agent into the profile used by existing sessions', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const repository = new CodingAgentProfileRepository(db);
  const root = path.join(process.cwd(), `.coding-agent-registry-cursor-${Date.now()}`);
  const binDirectory = path.join(root, 'bin');
  const cursorExecutable = path.join(binDirectory, 'cursor-agent');
  const registryPath = path.join(root, 'registry.json');
  try {
    await mkdir(binDirectory, { recursive: true });
    await writeFile(cursorExecutable, '#!/bin/sh\nexit 0\n');
    await chmod(cursorExecutable, 0o755);
    await writeFile(
      registryPath,
      JSON.stringify({
        agents: [
          {
            id: 'cursor-agent',
            name: 'Cursor',
            description: "Cursor's coding agent.",
            distribution: {
              binary: { 'darwin-aarch64': { cmd: './cursor-agent', args: ['acp'] } },
            },
          },
        ],
      }),
    );
    const capabilities = {
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
    repository.save({
      id: 'cursor-session-profile',
      name: 'Cursor',
      description: "Cursor's coding agent. Detected locally. Probe before using.",
      driverKind: CodingAgentDriverKind.Acp,
      status: CodingAgentProfileStatus.Ready,
      capabilities,
      authMethods: [],
      command: '/old/cursor-agent',
      args: ['acp'],
      environment: {},
      isBuiltin: false,
    });
    repository.save({
      id: 'cursor-stale-profile',
      name: 'Cursor',
      description: "Cursor's coding agent. Detected locally. Probe before using.",
      driverKind: CodingAgentDriverKind.Acp,
      status: CodingAgentProfileStatus.Detected,
      capabilities,
      authMethods: [],
      command: cursorExecutable,
      args: ['acp'],
      environment: { [CodingAgentEnvironmentKey.RegistryAgentId]: 'cursor-agent' },
      isBuiltin: false,
    });
    db.prepare(
      `INSERT INTO coding_agent_lanes
       (id, mission_id, profile_id, source_root, execution_root, config_options_json, available_commands_json, local_session_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'cursor-lane',
      'cursor-mission',
      'cursor-session-profile',
      root,
      root,
      '[]',
      '[]',
      'cursor-local-session',
      'idle',
      Date.now(),
      Date.now(),
    );
    db.prepare(
      `INSERT INTO coding_rooms
       (id, name, workspace_root, default_profile_id, active_mission_id, active_lane_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`,
    ).run(
      'cursor-workspace',
      'Cursor workspace',
      root,
      'cursor-stale-profile',
      Date.now(),
      Date.now(),
    );

    const registry = new CodingAgentRegistry(repository, () => true, registryPath, root, {
      environment: { PATH: binDirectory },
      home: root,
      platform: 'darwin',
      architecture: 'arm64',
    });
    registry.hydrate();
    await registry.discoverExternalAgents();

    expect(registry.get('cursor-session-profile')).toMatchObject({
      command: cursorExecutable,
      status: CodingAgentProfileStatus.Detected,
      environment: { [CodingAgentEnvironmentKey.RegistryAgentId]: 'cursor-agent' },
    });
    expect(registry.get('cursor-stale-profile')).toBeUndefined();
    expect(repository.listExternal().map(profile => profile.id)).toEqual(['cursor-session-profile']);
    expect(
      db
        .prepare('SELECT default_profile_id FROM coding_rooms WHERE id = ?')
        .get('cursor-workspace'),
    ).toEqual({ default_profile_id: 'cursor-session-profile' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
