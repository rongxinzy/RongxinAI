import { chmod, mkdir, realpath, rm, writeFile } from 'fs/promises';
import path from 'path';
import { expect, test } from 'vitest';

import { AcpDiscoveryService, discoveryDirectories } from './discoveryService';

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
    '/packages/npm/bin',
    '/packages/bun/bin',
    '/packages/volta/bin',
    '/home/agent/.local/bin',
    '/home/agent/.npm-global/bin',
    '/home/agent/.bun/bin',
    '/home/agent/.local/share/pnpm',
    '/home/agent/Library/pnpm',
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

test('records a resolved absolute executable when PATH contains a relative directory', async () => {
  const directory = path.join(process.cwd(), `.coding-agent-discovery-${Date.now()}`);
  const executable = path.join(directory, 'codex');
  const originalPath = process.env.PATH;
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(executable, '#!/bin/sh\nexit 0\n');
    await chmod(executable, 0o755);
    process.env.PATH = path.basename(directory);

    const profiles = await new AcpDiscoveryService().discover();
    expect(profiles).toContainEqual(
      expect.objectContaining({
        name: 'Codex',
        command: await realpath(executable),
        args: ['app-server'],
        status: 'detected',
      }),
    );
  } finally {
    process.env.PATH = originalPath;
    await rm(directory, { recursive: true, force: true });
  }
});
