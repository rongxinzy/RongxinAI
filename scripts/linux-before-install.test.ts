import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

const scriptPath = path.resolve('scripts/linux-before-install.sh');
const builderConfigPath = path.resolve('electron-builder.json');
const builderConfig = JSON.parse(fs.readFileSync(builderConfigPath, 'utf8')) as {
  productName: string;
  executableName: string;
  deb?: { fpm?: string[] };
};
const currentExecutable = `/opt/${builderConfig.productName}/${builderConfig.executableName}`;

type ProcessFixture = {
  pid: number;
  executable: string;
  commandLine?: string;
  mount?: { point: string; device: string; type: string };
  onTerm?: 'exit' | 'recycle' | 'replace executable';
};

function runPreinstall(fixtures: ProcessFixture[]): string[] {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'zhiyuan-preinstall-'));
  try {
    for (const { pid, executable, commandLine, mount, onTerm } of fixtures) {
      const directory = path.join(root, String(pid));
      fs.mkdirSync(directory);
      fs.symlinkSync(executable, path.join(directory, 'exe'));
      const stat = (state: string, start: number) =>
        `${pid} (package worker)) ${state} ${'0 '.repeat(18)}${start}\n`;
      fs.writeFileSync(path.join(directory, 'stat'), stat('S', 100));
      fs.writeFileSync(path.join(directory, 'cmdline'), commandLine ?? executable);
      if (mount) {
        fs.writeFileSync(
          path.join(directory, 'mountinfo'),
          `42 40 ${mount.device} / ${mount.point} ro shared:7 - ${mount.type} AppImage ro\n`,
        );
      }
      if (onTerm === 'exit' || onTerm === 'recycle') {
        fs.writeFileSync(
          path.join(directory, 'next-stat'),
          onTerm === 'exit' ? stat('Z', 100) : stat('S', 200),
        );
      } else if (onTerm === 'replace executable') {
        fs.writeFileSync(path.join(directory, 'next-exe'), '/usr/bin/node');
      }
    }
    const mockControls = `
kill() {
  printf 'signal %s %s\\n' "$1" "$2"
  if [ "$1" = -TERM ]; then
    if [ -f "$fixture/$2/next-stat" ]; then
      mv "$fixture/$2/next-stat" "$fixture/$2/stat"
    fi
    if [ -f "$fixture/$2/next-exe" ]; then
      ln -sf "$(cat "$fixture/$2/next-exe")" "$fixture/$2/exe"
    fi
  fi
  return 0
}
sleep() { printf 'wait %s\\n' "$1"; }
pkill() { printf 'unsafe pkill %s\\n' "$*"; }
pgrep() { return 1; }
fixture=$1
`;
    const production = fs.readFileSync(scriptPath, 'utf8');
    const isolated = production.replace(
      /^stop_packaged_processes \/proc$/m,
      'stop_packaged_processes "$fixture"',
    );
    const script = path.join(root, 'fixture.sh');
    fs.writeFileSync(script, mockControls + isolated);
    const result = spawnSync('sh', [script, root], { encoding: 'utf8', timeout: 5000 });
    expect(result.status, result.error?.message ?? result.stderr).toBe(0);
    return result.stdout.trim().split('\n').filter(Boolean);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('Linux deb upgrade pre-install hook', () => {
  test('is syntactically valid and installed as the deb preinst hook', () => {
    const syntax = spawnSync('sh', ['-n', scriptPath], { encoding: 'utf8' });
    expect(syntax.status, syntax.stderr || syntax.stdout).toBe(0);

    expect(builderConfig.deb?.fpm).toContain('--before-install=scripts/linux-before-install.sh');
  });

  test('only signals executables in the exact deb roots and AppImage mounts', () => {
    const appImageMount = {
      point: '/tmp/.mount_知远abc012',
      device: '0:42',
      type: 'fuse.squashfuse',
    };
    expect(
      runPreinstall([
        { pid: 21, executable: currentExecutable, onTerm: 'exit' },
        { pid: 22, executable: '/opt/知远/resources/engram (deleted)', onTerm: 'exit' },
        { pid: 23, executable: '/opt/ZhiYuanAgent/ZhiYuanAgent', onTerm: 'exit' },
        {
          pid: 24,
          executable: '/tmp/.mount_知远abc012/resources/engram',
          mount: appImageMount,
          onTerm: 'exit',
        },
        {
          pid: 25,
          executable: '/var/tmp/custom path/.mount_ZhiYuaAbCdE0/ZhiYuanAgent',
          mount: {
            point: '/var/tmp/custom\\040path/.mount_ZhiYuaAbCdE0',
            device: '0:43',
            type: 'fuse',
          },
          onTerm: 'exit',
        },
        { pid: 26, executable: '/usr/bin/node', commandLine: `node ${currentExecutable}` },
        { pid: 27, executable: '/tmp/copied/opt/知远/知远' },
        { pid: 28, executable: '/opt/知远-helper/worker' },
        { pid: 29, executable: '/tmp/.mount_知远abc012-suffix/worker' },
        {
          pid: 30,
          executable: '/tmp/.mount_知远abc012/知远',
          mount: appImageMount,
          onTerm: 'exit',
        },
        { pid: 31, executable: '/tmp/.mount_知远ordinary/知远' },
        { pid: 32, executable: '/tmp/.mount_知远abc123/知远' },
        {
          pid: 33,
          executable: '/tmp/.mount_知远abc124/知远',
          mount: { point: '/tmp/.mount_知远abc124', device: '8:1', type: 'ext4' },
        },
        {
          pid: 34,
          executable: '/tmp/.mount_ZhiYuaAlPdE0/ZhiYuanOther',
          mount: { point: '/tmp/.mount_ZhiYuaAlPdE0', device: '0:45', type: 'fuse.squashfuse' },
        },
      ]),
    ).toEqual([
      'signal -TERM 21',
      'signal -TERM 22',
      'signal -TERM 23',
      'signal -TERM 24',
      'signal -TERM 25',
      'signal -TERM 30',
    ]);
  });

  test('only escalates a surviving original packaged process after a bounded wait', () => {
    const operations = runPreinstall([
      { pid: 31, executable: currentExecutable },
      { pid: 32, executable: currentExecutable, onTerm: 'recycle' },
      { pid: 33, executable: currentExecutable, onTerm: 'replace executable' },
    ]);
    expect(operations.filter(operation => operation.startsWith('signal'))).toEqual([
      'signal -TERM 31',
      'signal -TERM 32',
      'signal -TERM 33',
      'signal -KILL 31',
    ]);
    expect(operations.filter(operation => operation === 'wait 1')).toHaveLength(10);
  });
});
