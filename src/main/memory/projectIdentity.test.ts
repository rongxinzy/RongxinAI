import path from 'path';
import { expect, test } from 'vitest';

import { normalizeGitRemote, resolveProjectIdentity } from './projectIdentity';

test('uses the normalized git origin so repository subdirectories share one identity', () => {
  const gitRoot = path.resolve('workspace', 'repository');
  const runGit = (_cwd: string, args: string[]) =>
    args.includes('--show-toplevel') ? gitRoot : 'git@github.com:Example/Repository.git';

  const first = resolveProjectIdentity(path.join(gitRoot, 'src'), {
    runGit,
    realpath: candidate => candidate,
  });
  const second = resolveProjectIdentity(path.join(gitRoot, 'tests'), {
    runGit,
    realpath: candidate => candidate,
  });

  expect(first.id).toBe(second.id);
  expect(first.canonicalSource).toBe('git:github.com/example/repository');
});

test('keeps unrelated non-git directories isolated', () => {
  const options = {
    runGit: () => null,
    realpath: (candidate: string) => path.resolve(candidate),
    platform: 'win32' as const,
  };

  const first = resolveProjectIdentity('C:/projects/alpha', options);
  const second = resolveProjectIdentity('C:/projects/beta', options);

  expect(first.id).not.toBe(second.id);
});

test('normalizes common remote URL forms to the same canonical source', () => {
  expect(normalizeGitRemote('https://github.com/Example/Repository.git')).toBe(
    'github.com/example/repository',
  );
  expect(normalizeGitRemote('git@github.com:Example/Repository.git')).toBe(
    'github.com/example/repository',
  );
});
