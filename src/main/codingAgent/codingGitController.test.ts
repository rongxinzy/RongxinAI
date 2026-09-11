import { spawn } from 'child_process';
import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { expect, test } from 'vitest';

import { CodingLaneStatus } from '../../shared/codingAgent';
import type { CodingRoomRepository } from './codingRoomRepository';
import { CodingGitController } from './codingGitController';

const git = async (cwd: string, args: string[]): Promise<string> =>
  await new Promise<string>((resolve, reject) => {
    const child = spawn('git', args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
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
        : reject(new Error(stderr.trim() || `git failed with exit code ${code}.`)),
    );
  });

test('creates and switches a branch while the active agent is running', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'coding-git-controller-'));
  await git(root, ['init']);
  await git(root, ['config', 'user.email', 'coding-git-controller@example.com']);
  await git(root, ['config', 'user.name', 'Coding Git Controller Test']);
  await writeFile(path.join(root, 'tracked.txt'), 'baseline\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'baseline']);

  const repository = {
    getRoomByRoot: () => ({ id: 'room', workspaceRoot: root }),
    listRooms: () => [],
    listMissions: () => [{ id: 'mission' }],
    listLanes: () => [
      {
        id: 'lane',
        sourceRoot: root,
        executionRoot: root,
        status: CodingLaneStatus.Running,
      },
    ],
    getWriterLease: () => null,
  } as unknown as CodingRoomRepository;
  const controller = new CodingGitController(repository);

  await controller.createBranch({
    workspaceRoot: root,
    laneId: 'lane',
    branch: 'feature/active-agent',
  });

  expect(await git(root, ['branch', '--show-current'])).toBe('feature/active-agent');
});
