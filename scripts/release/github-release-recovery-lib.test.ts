import { expect, test } from 'vitest';
import { verifyGitHubReleaseRecovery } from './github-release-recovery-lib.mjs';

function fixture() {
  const tag = 'v2026.10.19-build.12';
  const commit = 'a'.repeat(40);
  return {
    tag, commit, runId: '123',
    run: { id: 123, head_sha: commit, head_branch: tag, path: '.github/workflows/release.yml', event: 'push', status: 'completed' },
    jobs: ['prepare-release', 'quality', 'memory-regression / memory-leak', 'publish',
      'build-release / acceptance (lite)', 'build-release / acceptance (cpu)', 'build-release / acceptance (cuda)',
    ].map(name => ({ name, status: 'completed', conclusion: 'success' })).concat([
      { name: 'github-prerelease', status: 'completed', conclusion: 'failure' },
    ]),
  };
}

test('recovers only GitHub assets after all original release gates passed', () => {
  expect(verifyGitHubReleaseRecovery(fixture())).toMatchObject({ version: '2026.10.19-build.12', 'run-id': '123' });
});

test.each(['quality', 'publish', 'build-release / acceptance (cpu)'])('rejects a failed %s gate', name => {
  const value = fixture();
  value.jobs.find(job => job.name === name)!.conclusion = 'failure';
  expect(() => verifyGitHubReleaseRecovery(value)).toThrow();
});

test('rejects a different source commit, tag, event, or workflow', () => {
  for (const change of [{ head_sha: 'b'.repeat(40) }, { head_branch: 'main' }, { event: 'workflow_dispatch' }, { path: '.github/workflows/ci.yml' }]) {
    const value = fixture();
    Object.assign(value.run, change);
    expect(() => verifyGitHubReleaseRecovery(value)).toThrow('does not match');
  }
});

test('rejects missing installation acceptance even if a publish job claims success', () => {
  const value = fixture();
  value.jobs = value.jobs.filter(job => !job.name.startsWith('build-release / acceptance'));
  expect(() => verifyGitHubReleaseRecovery(value)).toThrow('installation acceptance');
});
