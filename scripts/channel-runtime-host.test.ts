import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { parseGitWorktreeList, publishRuntimeBinary, resolveSourceRoot } = require('./channel-runtime-host.cjs') as {
  parseGitWorktreeList: (output: string) => string[];
  resolveSourceRoot: (
    rootDir: string,
    options: {
      environment: Record<string, string | undefined>;
      fileSystem: { existsSync(filePath: string): boolean };
      runCommand: () => { status: number; stdout: string };
    },
  ) => string;
  publishRuntimeBinary: (
    fileSystem: { rmSync(path: string, options: { force: boolean }): void; renameSync(from: string, to: string): void },
    stagedBinary: string,
    binaryPath: string,
    revision: string,
  ) => string;
};

test('parses Git worktree porcelain output', () => {
  expect(
    parseGitWorktreeList(
      'worktree D:/src/pi-connect\nHEAD abc\nbranch refs/heads/main\n\nworktree D:/src/sidecar\nHEAD def\n',
    ),
  ).toEqual(['D:/src/pi-connect', 'D:/src/sidecar']);
});

test('prefers an explicit reviewed sidecar source', () => {
  const sourceRoot = path.resolve('D:/src/reviewed-sidecar');
  expect(
    resolveSourceRoot('D:/app', {
      environment: { ZHIYUAN_CC_CONNECT_SOURCE: sourceRoot },
      fileSystem: {
        existsSync(filePath) {
          return filePath === path.join(sourceRoot, 'cmd', 'zhiyuan-sidecar', 'main.go');
        },
      },
      runCommand: () => ({ status: 1, stdout: '' }),
    }),
  ).toBe(sourceRoot);
});

test('discovers the sidecar implementation in a pi-connect worktree', () => {
  const repository = path.resolve('D:/src/pi-connect');
  const sidecarWorktree = path.resolve('D:/src/pi-connect-sidecar');
  expect(
    resolveSourceRoot('D:/app', {
      environment: { PI_CONNECT_SRC: repository },
      fileSystem: {
        existsSync(filePath) {
          return (
            filePath === path.join(repository, '.git') ||
            filePath === path.join(sidecarWorktree, 'cmd', 'zhiyuan-sidecar', 'main.go')
          );
        },
      },
      runCommand: () => ({
        status: 0,
        stdout: `worktree ${repository}\nHEAD abc\n\nworktree ${sidecarWorktree}\nHEAD def\n`,
      }),
    }),
  ).toBe(sidecarWorktree);
});

test('publishes a revision binary when the running executable is locked', () => {
  const renames: Array<[string, string]> = [];
  const fileSystem = {
    rmSync(target: string) {
      if (target.endsWith('cc-connect-sidecar.exe')) {
        const error = new Error('locked') as NodeJS.ErrnoException;
        error.code = 'EPERM';
        throw error;
      }
    },
    renameSync(from: string, to: string) { renames.push([from, to]); },
  };
  expect(publishRuntimeBinary(
    fileSystem,
    'cc-connect-sidecar.exe.staging',
    'cc-connect-sidecar.exe',
    'f9e3063123456789',
  )).toBe('cc-connect-sidecar-f9e306312345.exe');
  expect(renames).toEqual([
    ['cc-connect-sidecar.exe.staging', 'cc-connect-sidecar-f9e306312345.exe'],
  ]);
});
