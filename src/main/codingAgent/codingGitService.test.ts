import { spawn } from 'child_process';
import { mkdtemp, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { expect, test } from 'vitest';

import { CodingGitDiffScope, CodingGitFileStatus } from '../../shared/codingAgent';
import { CodingGitService } from './codingGitService';

const git = async (cwd: string, args: string[]): Promise<string> =>
  await new Promise<string>((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => (stdout += chunk));
    child.stderr.on('data', chunk => (stderr += chunk));
    child.once('error', reject);
    child.once('exit', code =>
      code === 0
        ? resolve(stdout.trim())
        : reject(new Error(stderr.trim() || `git failed: ${code}`)),
    );
  });

const createRepository = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'coding-git-'));
  await git(root, ['init']);
  await git(root, ['config', 'user.email', 'coding-git@example.com']);
  await git(root, ['config', 'user.name', 'Coding Git Test']);
  await writeFile(path.join(root, 'tracked.txt'), 'before\n');
  await writeFile(path.join(root, 'staged.txt'), 'before\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'baseline']);
  await git(root, ['branch', '-M', 'main']);
  return root;
};

test('reports structured staged, unstaged, and untracked Git state', async () => {
  const root = await createRepository();
  await writeFile(path.join(root, 'tracked.txt'), 'before\nafter\n');
  await writeFile(path.join(root, 'staged.txt'), 'staged\n');
  await git(root, ['add', 'staged.txt']);
  await writeFile(path.join(root, 'untracked.txt'), 'one\ntwo\n');

  const service = new CodingGitService();
  const status = await service.getStatus(root, {
    isIsolated: false,
    isBusy: false,
  });

  expect(status.isRepository).toBe(true);
  expect(status.branch).toBe('main');
  expect(status.canMutate).toBe(true);
  expect(status.files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: 'tracked.txt',
        indexStatus: null,
        worktreeStatus: CodingGitFileStatus.Modified,
      }),
      expect.objectContaining({
        path: 'staged.txt',
        indexStatus: CodingGitFileStatus.Modified,
        worktreeStatus: null,
      }),
      expect.objectContaining({
        path: 'untracked.txt',
        indexStatus: null,
        worktreeStatus: CodingGitFileStatus.Untracked,
        additions: 2,
      }),
    ]),
  );
  expect(status.additions).toBeGreaterThan(0);
  expect(status.deletions).toBeGreaterThan(0);
});

test('loads file diffs and stages or unstages only explicit paths', async () => {
  const root = await createRepository();
  const service = new CodingGitService();
  await git(root, ['config', 'diff.external', 'missing-external-diff-command']);
  await writeFile(path.join(root, 'tracked.txt'), 'changed\n');
  const trackedDiff = await service.getDiff({
    workspaceRoot: root,
    sourceRoot: root,
    targetRoot: root,
    path: 'tracked.txt',
    scope: CodingGitDiffScope.Unstaged,
  });
  expect(trackedDiff).toContain('+changed');

  await writeFile(path.join(root, 'untracked file.txt'), 'new file\n');

  const diff = await service.getDiff({
    workspaceRoot: root,
    sourceRoot: root,
    targetRoot: root,
    path: 'untracked file.txt',
    scope: CodingGitDiffScope.Untracked,
  });
  expect(diff).toContain('+new file');

  await service.stage(root, ['untracked file.txt']);
  expect((await service.getStatus(root, { isIsolated: false, isBusy: false })).files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: 'untracked file.txt',
        indexStatus: CodingGitFileStatus.Added,
      }),
    ]),
  );

  await service.unstage(root, ['untracked file.txt']);
  expect((await service.getStatus(root, { isIsolated: false, isBusy: false })).files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: 'untracked file.txt',
        worktreeStatus: CodingGitFileStatus.Untracked,
      }),
    ]),
  );
});

test('commits staged changes and pushes through the configured upstream', async () => {
  const root = await createRepository();
  const remote = await mkdtemp(path.join(tmpdir(), 'coding-git-remote-'));
  await git(remote, ['init', '--bare']);
  await git(root, ['remote', 'add', 'origin', remote]);
  await git(root, ['push', '-u', 'origin', 'main']);
  await writeFile(path.join(root, 'tracked.txt'), 'committed\n');

  const service = new CodingGitService();
  await service.stage(root, ['tracked.txt']);
  await service.commit(root, 'test: commit from panel');
  await service.push(root);

  expect(await git(root, ['log', '-1', '--pretty=%s'])).toBe('test: commit from panel');
  expect(await git(remote, ['log', '-1', '--pretty=%s', 'refs/heads/main'])).toBe(
    'test: commit from panel',
  );
  expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('committed\n');
});

test('returns an explicit empty state outside Git repositories', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'coding-not-git-'));
  const status = await new CodingGitService().getStatus(root, {
    isIsolated: false,
    isBusy: false,
  });

  expect(status).toMatchObject({
    isRepository: false,
    repositoryRoot: null,
    files: [],
    canMutate: false,
  });
});
