import { mkdtemp, mkdir, realpath, symlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, expect, test } from 'vitest';

import { WorkspaceBroker } from './workspaceBroker';

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .map(directory =>
        import('fs/promises').then(fs => fs.rm(directory, { recursive: true, force: true })),
      ),
  );
});

test('accepts a real target inside its workspace and rejects a symlink escape', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'coding-broker-'));
  cleanup.push(root);
  const workspace = path.join(root, 'workspace');
  const outside = path.join(root, 'outside');
  await mkdir(workspace);
  await mkdir(outside);
  const file = path.join(workspace, 'safe.txt');
  await writeFile(file, 'safe');
  const external = path.join(outside, 'secret.txt');
  await writeFile(external, 'secret');
  await symlink(external, path.join(workspace, 'escape'));
  const broker = new WorkspaceBroker(workspace);
  await expect(broker.resolveTarget(file)).resolves.toBe(await realpath(file));
  await expect(broker.resolveTarget('new/nested/file.ts')).resolves.toBe(
    path.join(await realpath(workspace), 'new', 'nested', 'file.ts'),
  );
  await expect(broker.resolveTarget(path.join(workspace, 'escape'))).rejects.toThrow('outside');
});

test('permits an explicitly authorized additional root only', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'coding-broker-'));
  cleanup.push(root);
  const workspace = path.join(root, 'workspace');
  const shared = path.join(root, 'shared');
  const outside = path.join(root, 'outside');
  await Promise.all([mkdir(workspace), mkdir(shared), mkdir(outside)]);
  const sharedFile = path.join(shared, 'notes.md');
  await writeFile(sharedFile, 'notes');
  const outsideFile = path.join(outside, 'secret.md');
  await writeFile(outsideFile, 'secret');
  const broker = new WorkspaceBroker(workspace, [shared]);

  await expect(broker.resolveTarget(sharedFile)).resolves.toBe(await realpath(sharedFile));
  await expect(broker.resolveTarget(outsideFile)).rejects.toThrow('outside');
});
