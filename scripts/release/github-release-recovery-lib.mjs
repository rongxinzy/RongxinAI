export function verifyGitHubReleaseRecovery({ tag, runId, commit, run, jobs }) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag) || !/^[1-9][0-9]*$/.test(runId)) {
    throw new Error('Expected an existing release tag and numeric candidate run ID');
  }
  if (!/^[0-9a-f]{40}$/.test(commit) ||
      String(run.id) !== runId || run.head_sha !== commit || run.head_branch !== tag ||
      run.path !== '.github/workflows/release.yml' || run.event !== 'push' ||
      run.status !== 'completed') {
    throw new Error('Candidate run does not match the immutable tag release');
  }
  for (const name of ['prepare-release', 'quality', 'memory-regression / memory-leak', 'publish']) {
    const matches = jobs.filter(job => job.name === name);
    if (matches.length !== 1 || matches[0].status !== 'completed' || matches[0].conclusion !== 'success') {
      throw new Error(`Original release gate did not pass: ${name}`);
    }
  }
  const acceptance = jobs.filter(job => job.name.startsWith('build-release / acceptance'));
  if (acceptance.length === 0 || acceptance.some(job => job.conclusion !== 'success')) {
    throw new Error('Original installation acceptance did not pass');
  }
  if (jobs.some(job => job.name !== 'github-prerelease' &&
      (job.status !== 'completed' || !['success', 'skipped'].includes(job.conclusion)))) {
    throw new Error('An original release check is still unfinished or failed');
  }
  return { tag, version: tag.slice(1), commit, 'run-id': runId };
}
