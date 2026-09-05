import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { CiEvent, HeavyJob } from './constants.ts';

const planner = fileURLToPath(new URL('./plan.ts', import.meta.url));

test('Git diff includes deleted and renamed sensitive paths beyond 300 files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-gate-plan-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  try {
    git('init', '-q');
    git('config', 'user.name', 'CI Test');
    git('config', 'user.email', 'ci@example.invalid');
    mkdirSync(join(dir, 'src/main'), { recursive: true });
    writeFileSync(join(dir, 'src/main/runtime.ts'), 'sensitive runtime');
    git('add', 'src/main/runtime.ts');
    git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD');
    git('mv', 'src/main/runtime.ts', 'ordinary.ts');
    mkdirSync(join(dir, 'docs'));
    const docs = Array.from({ length: 350 }, (_, i) => `docs/${i}.md`);
    for (const doc of docs) writeFileSync(join(dir, doc), 'documentation');
    git('add', ...docs);
    git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'rename with many docs');
    const output = join(dir, 'output');
    execFileSync(process.execPath, [planner], {
      cwd: dir,
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: CiEvent.PullRequest,
        GITHUB_REF: 'refs/pull/1/merge',
        PR_BASE_SHA: base,
        PR_HEAD_SHA: git('rev-parse', 'HEAD'),
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: join(dir, 'summary'),
      },
    });
    expect(readFileSync(output, 'utf8')).toContain(`${HeavyJob.Linux}=true`);
    expect(readFileSync(join(dir, 'summary'), 'utf8')).toContain('352 changed paths');
    expect(() =>
      execFileSync(process.execPath, [planner], {
        cwd: dir,
        stdio: 'pipe',
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: CiEvent.PullRequest,
          PR_BASE_SHA: '',
          PR_HEAD_SHA: '',
          GITHUB_OUTPUT: output,
        },
      }),
    ).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
