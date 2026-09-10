import { chmod, mkdir, readFile, realpath, rm, writeFile } from 'fs/promises';
import path from 'path';
import { expect, test } from 'vitest';

import {
  CodingAgentEnvironmentKey,
  CodingAgentManagedAdapterId,
  CodingAgentProfileStatus,
} from '../../../shared/codingAgent';
import {
  AcpDiscoveryService,
  discoveryDirectories,
  resolveClaudeNativeExecutable,
} from './discoveryService';
import { resolveAcpAdapterRoot } from './adapterRoot';

test('ships an immutable 39-agent registry with explicit uvx executable names', async () => {
  const registryPath = path.join(process.cwd(), 'resources', 'acp', 'registry.json');
  const snapshot = JSON.parse(await readFile(registryPath, 'utf8')) as {
    agents?: Array<{ distribution?: { uvx?: { executable?: unknown } } }>;
  };

  expect(snapshot.agents).toHaveLength(39);
  for (const agent of snapshot.agents ?? []) {
    const uvx = agent.distribution?.uvx;
    if (uvx) expect(uvx.executable).toEqual(expect.any(String));
  }
});

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

test('discovers PATH and known user-level installation directories', () => {
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
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join('/home/agent', '.local', 'bin'),
    path.join('/home/agent', '.npm-global', 'bin'),
    path.join('/home/agent', '.bun', 'bin'),
    path.join('/home/agent', '.cargo', 'bin'),
    path.join('/home/agent', '.kimi-code', 'bin'),
    path.join('/home/agent', '.volta', 'bin'),
    path.join('/home/agent', '.local', 'share', 'mise', 'shims'),
    path.join('/home/agent', '.local', 'share', 'fnm'),
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
  expect(directories).toContain(
    path.join('C:\\Users\\agent\\AppData\\Local', 'Microsoft', 'WinGet', 'Links'),
  );
  expect(directories).toContain(path.join('C:\\Users\\agent', '.bun', 'bin'));
  expect(directories).toContain(path.join('C:\\Users\\agent', '.cargo', 'bin'));
  expect(directories).toContain(path.join('C:\\Users\\agent', '.kimi-code', 'bin'));
});

test('discovers uvx-installed ACP agents through their command-line executable', async () => {
  const root = path.join(process.cwd(), `.coding-agent-discovery-uvx-${Date.now()}`);
  const directory = path.join(root, 'bin');
  const executable = path.join(directory, 'fast-agent');
  const registryPath = path.join(root, 'registry.json');
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(executable, '#!/bin/sh\nexit 0\n');
    await chmod(executable, 0o755);
    await writeFile(
      registryPath,
      JSON.stringify({
        agents: [
          {
            id: 'fast-agent',
            name: 'fast-agent',
            description: 'Python ACP agent.',
            distribution: {
              uvx: { package: 'fast-agent-acp==1.0.0', executable: 'fast-agent', args: ['-x'] },
            },
          },
        ],
      }),
    );

    const profiles = await new AcpDiscoveryService(registryPath, {
      platform: 'darwin',
      architecture: 'arm64',
      environment: { PATH: directory },
      home: root,
      adapterRoot: process.cwd(),
    }).discover();

    expect(profiles).toContainEqual(
      expect.objectContaining({
        name: 'fast-agent',
        command: await realpath(executable),
        args: ['-x'],
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('discovers a standalone Kimi installation without npm package metadata', async () => {
  const root = path.join(process.cwd(), `.coding-agent-discovery-kimi-${Date.now()}`);
  const kimiDirectory = path.join(root, '.kimi-code', 'bin');
  const kimiExecutable = path.join(kimiDirectory, 'kimi');
  const registryPath = path.join(root, 'registry.json');
  try {
    await mkdir(kimiDirectory, { recursive: true });
    await writeFile(kimiExecutable, '#!/bin/sh\nexit 0\n');
    await chmod(kimiExecutable, 0o755);
    await writeFile(
      registryPath,
      JSON.stringify({
        agents: [
          {
            id: 'kimi',
            name: 'Kimi Code',
            description: 'Moonshot AI coding agent.',
            distribution: {
              binary: {
                'darwin-aarch64': {
                  cmd: './kimi',
                  args: ['acp'],
                },
              },
            },
          },
        ],
      }),
    );

    const profiles = await new AcpDiscoveryService(registryPath, {
      platform: 'darwin',
      architecture: 'arm64',
      environment: { PATH: '' },
      home: root,
      adapterRoot: process.cwd(),
    }).discover();

    expect(profiles).toContainEqual(
      expect.objectContaining({
        name: 'Kimi Code',
        command: await realpath(kimiExecutable),
        args: ['acp'],
        status: CodingAgentProfileStatus.Detected,
        environment: {
          [CodingAgentEnvironmentKey.RegistryAgentId]: 'kimi',
        },
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('uses the native Claude executable from npm and pnpm global package layouts on Windows', async () => {
  const root = path.join(process.cwd(), `.claude-native-executable-${Date.now()}`);
  const npmLauncher = path.join(root, 'npm', 'claude.cmd');
  const pnpmLauncher = path.join(root, 'pnpm', 'claude.cmd');
  const npmExecutable = path.join(
    root,
    'npm',
    'node_modules',
    '@anthropic-ai',
    'claude-code',
    'bin',
    'claude.exe',
  );
  const pnpmExecutable = path.join(
    root,
    'pnpm',
    'global',
    '5',
    'node_modules',
    '@anthropic-ai',
    'claude-code',
    'bin',
    'claude.exe',
  );
  try {
    await mkdir(path.dirname(npmLauncher), { recursive: true });
    await mkdir(path.dirname(pnpmLauncher), { recursive: true });
    await mkdir(path.dirname(npmExecutable), { recursive: true });
    await mkdir(path.dirname(pnpmExecutable), { recursive: true });
    await Promise.all([
      writeFile(npmLauncher, '@echo off\n'),
      writeFile(pnpmLauncher, '@echo off\n'),
      writeFile(npmExecutable, ''),
      writeFile(pnpmExecutable, ''),
    ]);

    await expect(resolveClaudeNativeExecutable(npmLauncher, 'win32')).resolves.toBe(
      await realpath(npmExecutable),
    );
    await expect(resolveClaudeNativeExecutable(pnpmLauncher, 'win32')).resolves.toBe(
      await realpath(pnpmExecutable),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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

test('discovers npx packages from pnpm global node_modules layouts', async () => {
  const root = path.join(process.cwd(), `.coding-agent-discovery-pnpm-${Date.now()}`);
  const pnpmHome = path.join(root, 'pnpm');
  const binDirectory = path.join(root, 'bin');
  const executable = path.join(binDirectory, 'test-agent');
  const packageDir = path.join(pnpmHome, 'global', '9', 'node_modules', 'test-agent');
  const registryPath = path.join(root, 'registry.json');
  try {
    await mkdir(packageDir, { recursive: true });
    await mkdir(binDirectory, { recursive: true });
    await writeFile(executable, '#!/bin/sh\nexit 0\n');
    await chmod(executable, 0o755);
    await writeFile(
      path.join(packageDir, 'package.json'),
      JSON.stringify({ name: 'test-agent', version: '1.0.0', bin: { 'test-agent': 'dist/cli.js' } }),
    );
    await writeFile(
      registryPath,
      JSON.stringify({
        agents: [
          {
            id: 'test-agent',
            name: 'Test Agent',
            distribution: { npx: { package: 'test-agent@1.0.0' } },
          },
        ],
      }),
    );

    const profiles = await new AcpDiscoveryService(registryPath, {
      platform: 'darwin',
      environment: { PATH: binDirectory, PNPM_HOME: pnpmHome },
      home: root,
      adapterRoot: process.cwd(),
    }).discover();

    expect(profiles).toContainEqual(
      expect.objectContaining({ name: 'Test Agent', command: await realpath(executable) }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('discovers npx packages from nvm and fnm version directories', async () => {
  const root = path.join(process.cwd(), `.coding-agent-discovery-node-managers-${Date.now()}`);
  const nvmBin = path.join(root, '.nvm', 'versions', 'node', 'v24.0.0', 'bin');
  const fnmBin = path.join(
    root,
    '.local',
    'share',
    'fnm',
    'node-versions',
    'v24.0.0',
    'installation',
    'bin',
  );
  const nvmPackage = path.join(root, '.nvm', 'versions', 'node', 'v24.0.0', 'lib', 'node_modules', 'nvm-agent');
  const fnmPackage = path.join(
    root,
    '.local',
    'share',
    'fnm',
    'node-versions',
    'v24.0.0',
    'installation',
    'lib',
    'node_modules',
    'fnm-agent',
  );
  const registryPath = path.join(root, 'registry.json');
  try {
    await Promise.all([
      mkdir(nvmBin, { recursive: true }),
      mkdir(fnmBin, { recursive: true }),
      mkdir(nvmPackage, { recursive: true }),
      mkdir(fnmPackage, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(nvmBin, 'nvm-agent'), '#!/bin/sh\nexit 0\n'),
      writeFile(path.join(fnmBin, 'fnm-agent'), '#!/bin/sh\nexit 0\n'),
      writeFile(path.join(nvmPackage, 'package.json'), JSON.stringify({ bin: 'bin/nvm-agent' })),
      writeFile(path.join(fnmPackage, 'package.json'), JSON.stringify({ bin: 'bin/fnm-agent' })),
      writeFile(
        registryPath,
        JSON.stringify({
          agents: [
            {
              id: 'nvm-agent',
              name: 'NVM Agent',
              distribution: { npx: { package: 'nvm-agent@1.0.0' } },
            },
            {
              id: 'fnm-agent',
              name: 'FNM Agent',
              distribution: { npx: { package: 'fnm-agent@1.0.0' } },
            },
          ],
        }),
      ),
    ]);
    await Promise.all([chmod(path.join(nvmBin, 'nvm-agent'), 0o755), chmod(path.join(fnmBin, 'fnm-agent'), 0o755)]);

    const profiles = await new AcpDiscoveryService(registryPath, {
      platform: 'darwin',
      environment: { PATH: '' },
      home: root,
      adapterRoot: process.cwd(),
    }).discover();

    expect(profiles).toContainEqual(
      expect.objectContaining({
        name: 'NVM Agent',
        command: await realpath(path.join(nvmBin, 'nvm-agent')),
      }),
    );
    expect(profiles).toContainEqual(
      expect.objectContaining({
        name: 'FNM Agent',
        command: await realpath(path.join(fnmBin, 'fnm-agent')),
      }),
    );
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
      platform: 'win32',
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
