import { chmod, mkdir, realpath, rm, writeFile } from 'fs/promises';
import path from 'path';
import { expect, test } from 'vitest';

import {
  CodingAgentEnvironmentKey,
  CodingAgentManagedAdapterId,
  CodingAgentProfileStatus,
} from '../../../shared/codingAgent';
import { AcpDiscoveryService, discoveryDirectories } from './discoveryService';
import { resolveAcpAdapterRoot } from './adapterRoot';

test('uses unpacked resources for packaged ACP adapter entrypoints', () => {
  expect(
    resolveAcpAdapterRoot({
      isPackaged: true,
      resourcesPath: '/Applications/ZhiYuan.app/Contents/Resources',
      appPath: '/Applications/ZhiYuan.app/Contents/Resources/app.asar',
    }),
  ).toBe(path.join('/Applications/ZhiYuan.app/Contents/Resources', 'app.asar.unpacked'));
  expect(
    resolveAcpAdapterRoot({
      isPackaged: false,
      resourcesPath: '/tmp/resources',
      appPath: '/workspace/application',
    }),
  ).toBe('/workspace/application');
});

test('discovers only PATH and known user-level installation directories', () => {
  const directories = discoveryDirectories(
    'darwin',
    {
      PATH: ['/usr/bin', '/custom/bin'].join(path.delimiter),
      npm_config_prefix: '/packages/npm',
      BUN_INSTALL: '/packages/bun',
      VOLTA_HOME: '/packages/volta',
    },
    '/home/agent',
  );

  expect(directories).toEqual([
    '/usr/bin',
    '/custom/bin',
    path.join('/packages/npm', 'bin'),
    path.join('/packages/bun', 'bin'),
    path.join('/packages/volta', 'bin'),
    path.join('/home/agent', '.local', 'bin'),
    path.join('/home/agent', '.npm-global', 'bin'),
    path.join('/home/agent', '.bun', 'bin'),
    path.join('/home/agent', '.local', 'share', 'pnpm'),
    path.join('/home/agent', 'Library', 'pnpm'),
  ]);
});

test('covers Windows user-level npm, pnpm, and Bun locations without scanning disks', () => {
  const directories = discoveryDirectories(
    'win32',
    {
      APPDATA: 'C:\\Users\\agent\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\agent\\AppData\\Local',
    },
    'C:\\Users\\agent',
  );

  expect(directories).toContain(path.join('C:\\Users\\agent\\AppData\\Roaming', 'npm'));
  expect(directories).toContain(path.join('C:\\Users\\agent\\AppData\\Local', 'pnpm'));
  expect(directories).toContain(path.join('C:\\Users\\agent', '.bun', 'bin'));
});

test('uses bundled ACP bridges for locally installed Codex and Claude Code', async () => {
  const root = path.join(process.cwd(), `.coding-agent-discovery-${Date.now()}`);
  const directory = path.join(root, 'bin');
  const codexExecutable = path.join(directory, 'codex');
  const claudeExecutable = path.join(directory, 'claude');
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(codexExecutable, '#!/bin/sh\nexit 0\n');
    await writeFile(claudeExecutable, '#!/bin/sh\nexit 0\n');
    await chmod(codexExecutable, 0o755);
    await chmod(claudeExecutable, 0o755);

    const profiles = await new AcpDiscoveryService(undefined, {
      environment: { PATH: path.relative(process.cwd(), directory) },
      home: root,
      adapterRoot: process.cwd(),
      adapterHostExecutable: '/Applications/ZhiYuan',
    }).discover();
    expect(profiles).toContainEqual(
      expect.objectContaining({
        name: 'Codex',
        command: '/Applications/ZhiYuan',
        args: [
          path.join(
            process.cwd(),
            'node_modules',
            '@agentclientprotocol',
            'codex-acp',
            'dist',
            'index.js',
          ),
        ],
        status: CodingAgentProfileStatus.Detected,
        environment: expect.objectContaining({
          [CodingAgentEnvironmentKey.ElectronRunAsNode]: '1',
          [CodingAgentEnvironmentKey.ManagedAdapterId]: CodingAgentManagedAdapterId.Codex,
          [CodingAgentEnvironmentKey.CodexPath]: await realpath(codexExecutable),
        }),
      }),
    );
    expect(profiles).toContainEqual(
      expect.objectContaining({
        name: 'Claude Code',
        command: '/Applications/ZhiYuan',
        args: [
          path.join(
            process.cwd(),
            'node_modules',
            '@agentclientprotocol',
            'claude-agent-acp',
            'dist',
            'index.js',
          ),
        ],
        status: CodingAgentProfileStatus.Detected,
        environment: expect.objectContaining({
          [CodingAgentEnvironmentKey.ElectronRunAsNode]: '1',
          [CodingAgentEnvironmentKey.ManagedAdapterId]: CodingAgentManagedAdapterId.ClaudeCode,
          [CodingAgentEnvironmentKey.ClaudeCodeExecutable]: await realpath(claudeExecutable),
        }),
      }),
    );
    expect(profiles.filter(profile => profile.name === 'Codex')).toHaveLength(1);
    expect(profiles.filter(profile => profile.name === 'Claude Code')).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('does not expose bundled bridges when their corresponding agents are not installed', async () => {
  const root = path.join(process.cwd(), `.coding-agent-discovery-empty-${Date.now()}`);
  const directory = path.join(root, 'bin');
  try {
    await mkdir(directory, { recursive: true });
    const profiles = await new AcpDiscoveryService(undefined, {
      environment: { PATH: directory },
      home: root,
      adapterRoot: process.cwd(),
    }).discover();
    expect(profiles.some(profile => profile.name === 'Codex')).toBe(false);
    expect(profiles.some(profile => profile.name === 'Claude Code')).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
