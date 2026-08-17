import path from 'path';
import { expect, test } from 'vitest';

import { workspaceIdForPath } from '../workspaceUtils';
import { resolveProjectIdentity } from './projectIdentity';

test('uses the application workspace identity as the project identity', () => {
  const workspaceRoot = path.resolve('workspace', 'repository');
  const identity = resolveProjectIdentity(workspaceRoot);

  expect(identity).toEqual({
    id: workspaceIdForPath(workspaceRoot),
    displayName: 'repository',
    root: workspaceRoot,
  });
});

test('keeps separate workspace paths isolated even when they belong to one repository', () => {
  const repositoryRoot = path.resolve('workspace', 'repository');
  const first = resolveProjectIdentity(path.join(repositoryRoot, 'workspace-a'));
  const second = resolveProjectIdentity(path.join(repositoryRoot, 'workspace-b'));

  expect(first.id).not.toBe(second.id);
});

test('maps task work directories back to their owning workspace', () => {
  const workspaceRoot = path.resolve('workspace', 'repository');
  const taskDirectory = path.join(workspaceRoot, '.zhiyuan-tasks', 'task-123');

  expect(resolveProjectIdentity(taskDirectory)).toEqual(resolveProjectIdentity(workspaceRoot));
});
