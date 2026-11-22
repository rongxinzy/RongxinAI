import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { expect, test } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
const source = readFileSync(path.join(root, 'scripts/build-macos.cjs'), 'utf8');

function captureBuild(host: string, argv: string[]) {
  const calls: string[][] = [];
  vm.runInNewContext(source, {
    __dirname: path.join(root, 'scripts'),
    process: { arch: host, argv },
    require: (name: string) =>
      name === 'node:path'
        ? path
        : {
            spawnSync: (program: string, args: string[]) => {
              calls.push([program, ...args]);
              return { status: 0 };
            },
          },
  });
  return calls;
}

test.each([
  { script: 'dist:mac', host: 'arm64', target: 'arm64' },
  { script: 'dist:mac', host: 'x64', target: 'x64' },
  { script: 'dist:mac:x64', host: 'arm64', target: 'x64' },
  { script: 'dist:mac:arm64', host: 'x64', target: 'arm64' },
])('$script on $host selects $target consistently', ({ script, host, target }) => {
  const [command, entry, ...args] = manifest.scripts[script].split(' ');
  expect(command).toBe('node');
  expect(entry).toBe('scripts/build-macos.cjs');
  const calls = captureBuild(host, [command, entry, ...args, '--dir']);
  expect(calls).toEqual([
    ['bun', 'run', 'prepare:update-release'],
    ['bun', 'run', 'build'],
    ['bun', 'run', `channel:runtime:mac-${target}`],
    ['bun', 'run', `engram:runtime:mac-${target}`],
    ['bun', 'x', 'electron-builder', '--mac', `--${target}`, '--publish', 'never', '--dir'],
  ]);
});

test('requires one of the released architectures', () => {
  expect(manifest.scripts['dist:mac:universal']).toBeUndefined();
  expect(() => captureBuild('arm64', ['node', 'build-macos.cjs', '--universal'])).toThrow(
    'Choose one macOS packaging architecture',
  );
});
