import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { afterEach, expect, test } from 'vitest';

import { GitWorktreeConflictError, GitWorktreeService } from './gitWorktreeService';

const roots: string[] = [];
const git = async (cwd: string, args: string[]) =>
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', code => (code === 0 ? resolve() : reject(new Error(`git failed: ${code}`))));
  });
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

test('creates an isolated detached worktree at the requested baseline', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'coding-worktree-'));
  roots.push(root);
  await git(root, ['init']);
  await git(root, ['config', 'user.email', 'test@example.com']);
  await git(root, ['config', 'user.name', 'Test']);
  await writeFile(path.join(root, 'state.txt'), 'baseline');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'baseline']);
  const service = new GitWorktreeService(path.join(root, '.coding-worktrees'));
  const worktree = await service.create({
    repositoryRoot: root,
    baseline: 'HEAD',
    laneId: 'lane-a',
  });
  await writeFile(path.join(worktree, 'state.txt'), 'lane');
  expect(await readFile(path.join(root, 'state.txt'), 'utf8')).toBe('baseline');
  await service.remove(root, worktree);
});

test('previews and applies a collaborator worktree diff only when it cleanly applies', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'coding-worktree-'));
  roots.push(root);
  await git(root, ['init']);
  await git(root, ['config', 'user.email', 'test@example.com']);
  await git(root, ['config', 'user.name', 'Test']);
  await writeFile(path.join(root, 'state.txt'), 'baseline');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'baseline']);
  const service = new GitWorktreeService(path.join(root, '.coding-worktrees'));
  const worktree = await service.create({
    repositoryRoot: root,
    baseline: 'HEAD',
    laneId: 'lane-a',
  });
  await writeFile(path.join(worktree, 'state.txt'), 'implemented');

  await expect(service.getWorktreeDiff(worktree)).resolves.toContain('-baseline');
  await service.applyWorktreeDiff({ repositoryRoot: root, worktreeRoot: worktree });

  expect(await readFile(path.join(root, 'state.txt'), 'utf8')).toBe('implemented');
  await service.remove(root, worktree);
});

test('previews and applies an untracked collaborator file without staging it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'coding-worktree-'));
  roots.push(root);
  await git(root, ['init']);
  await git(root, ['config', 'user.email', 'test@example.com']);
  await git(root, ['config', 'user.name', 'Test']);
  await writeFile(path.join(root, 'state.txt'), 'baseline');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'baseline']);
  const service = new GitWorktreeService(path.join(root, '.coding-worktrees'));
  const worktree = await service.create({ repositoryRoot: root, baseline: 'HEAD', laneId: 'lane-new' });
  await writeFile(path.join(worktree, 'new-module.ts'), 'export const created = true;\n');

  await expect(service.getWorktreeDiff(worktree)).resolves.toContain('new-module.ts');
  await service.applyWorktreeDiff({ repositoryRoot: root, worktreeRoot: worktree });

  await expect(readFile(path.join(root, 'new-module.ts'), 'utf8')).resolves.toContain('created');
  await service.remove(root, worktree);
});

test('applies a mixed tracked and untracked collaborator patch', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'coding-worktree-'));
  roots.push(root);
  await git(root, ['init']);
  await git(root, ['config', 'user.email', 'test@example.com']);
  await git(root, ['config', 'user.name', 'Test']);
  await writeFile(path.join(root, 'state.txt'), 'baseline');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'baseline']);
  const service = new GitWorktreeService(path.join(root, '.coding-worktrees'));
  const worktree = await service.create({ repositoryRoot: root, baseline: 'HEAD', laneId: 'lane-mixed' });
  await writeFile(path.join(worktree, 'state.txt'), 'updated');
  await writeFile(path.join(worktree, 'new-file.ts'), 'export {};\n');

  await service.applyWorktreeDiff({ repositoryRoot: root, worktreeRoot: worktree });

  await expect(readFile(path.join(root, 'state.txt'), 'utf8')).resolves.toBe('updated');
  await expect(readFile(path.join(root, 'new-file.ts'), 'utf8')).resolves.toContain('export');
  await service.remove(root, worktree);
});

test('reports a conflict and preserves the primary workspace when a patch no longer applies', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'coding-worktree-'));
  roots.push(root);
  await git(root, ['init']);
  await git(root, ['config', 'user.email', 'test@example.com']);
  await git(root, ['config', 'user.name', 'Test']);
  await writeFile(path.join(root, 'state.txt'), 'baseline');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'baseline']);
  const service = new GitWorktreeService(path.join(root, '.coding-worktrees'));
  const worktree = await service.create({
    repositoryRoot: root,
    baseline: 'HEAD',
    laneId: 'lane-conflict',
  });
  await writeFile(path.join(worktree, 'state.txt'), 'collaborator change');
  await writeFile(path.join(root, 'state.txt'), 'primary change');

  await expect(service.applyWorktreeDiff({ repositoryRoot: root, worktreeRoot: worktree })).rejects.toBeInstanceOf(
    GitWorktreeConflictError,
  );
  expect(await readFile(path.join(root, 'state.txt'), 'utf8')).toBe('primary change');
  await service.remove(root, worktree);
});

test('limits diff previews without truncating the diff used for patch application', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'coding-worktree-'));
  roots.push(root);
  await git(root, ['init']);
  await git(root, ['config', 'user.email', 'test@example.com']);
  await git(root, ['config', 'user.name', 'Test']);
  await writeFile(path.join(root, 'large.txt'), 'baseline');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'baseline']);
  const service = new GitWorktreeService(path.join(root, '.coding-worktrees'));
  const worktree = await service.create({
    repositoryRoot: root,
    baseline: 'HEAD',
    laneId: 'lane-large-diff',
  });
  await writeFile(path.join(worktree, 'large.txt'), 'x'.repeat(300 * 1024));

  await expect(service.getWorktreeDiffPreview(worktree)).resolves.toContain(
    '[Diff preview truncated]',
  );
  await expect(service.getWorktreeDiff(worktree)).resolves.toContain('x'.repeat(300));
  await service.remove(root, worktree);
});
