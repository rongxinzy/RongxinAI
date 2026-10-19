import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';

test('push planning includes every commit, new-branch trees and invalid ranges fail closed', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ci-plan-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const write = (file: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), file);
    git('add', file);
    git(
      '-c',
      'user.name=CI Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'fixture',
    );
    return git('rev-parse', 'HEAD');
  };
  try {
    git('init');
    const before = write('README.md');
    write('src/main/libs/agentEngine/changed.ts');
    const after = write('docs/readme.md');
    cpSync(__dirname, path.join(root, 'planner'), { recursive: true });
    const output = path.join(root, 'outputs');
    const run = (base: string) => {
      writeFileSync(output, '');
      return spawnSync(process.execPath, ['planner/plan.ts'], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: 'push',
          GITHUB_REF: 'refs/heads/main',
          PUSH_BEFORE_SHA: base,
          PUSH_AFTER_SHA: after,
          GITHUB_OUTPUT: output,
          GITHUB_STEP_SUMMARY: '',
        },
      });
    };
    expect(run(before).status).toBe(0);
    expect(readFileSync(output, 'utf8')).toContain('streaming-mutations=true');
    expect(run('0'.repeat(40)).status).toBe(0);
    expect(readFileSync(output, 'utf8')).toContain('streaming-mutations=true');
    expect(run('invalid').status).not.toBe(0);
    expect(run('f'.repeat(40)).status).not.toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
