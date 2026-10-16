'use strict';

function globMatches(path, pattern) {
  if (/[[\]+]/.test(pattern)) throw new Error(`Unsupported filter pattern: ${pattern}; update the gate matcher.`);
  let source = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') {
        i++;
        source += '(?:.*/)?';
      } else source += '.*';
    } else if (c === '*') source += '[^/]*';
    else if (c === '?') source += '[^/]';
    else source += c.replace(/[\\^$+?.()|{}[\]]/g, '\\$&');
  }
  return new RegExp(`${source}$`).test(path);
}

function workflowApplies(workflow, files, branch) {
  const matches = (value, patterns) =>
    patterns.reduce((included, pattern) => {
      const negative = pattern.startsWith('!');
      return globMatches(value, negative ? pattern.slice(1) : pattern) ? !negative : included;
    }, false);
  if (workflow.branches && !matches(branch, workflow.branches)) return false;
  if (workflow.branchesIgnore && matches(branch, workflow.branchesIgnore)) return false;
  if (workflow.paths) return files.some((file) => matches(file, workflow.paths));
  if (workflow.pathsIgnore) return files.some((file) => !matches(file, workflow.pathsIgnore));
  return true;
}

function evaluateRuns(workflows, runs, sha) {
  const waiting = [],
    failed = [];
  for (const workflow of workflows) {
    const latest = runs
      .filter(
        (run) => run.head_sha === sha && run.event === 'pull_request' && run.path?.split('@')[0] === workflow.path,
      )
      .sort((a, b) => b.id - a.id || b.run_attempt - a.run_attempt)[0];
    if (latest?.status !== 'completed') waiting.push(workflow.name);
    else if (latest.conclusion !== 'success') failed.push(`${workflow.name}: ${latest.conclusion}`);
  }
  return { waiting, failed };
}

async function run({
  github,
  context,
  core,
  config,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const pr = context.payload.pull_request;
  if (!pr) throw new Error('This gate only runs for pull requests.');
  const files = await github.paginate(github.rest.pulls.listFiles, {
    ...context.repo,
    pull_number: pr.number,
    per_page: 100,
  });
  // GitHub returns at most 3000 changed files; fail closed rather than miss a filtered workflow.
  if (files.length !== pr.changed_files)
    throw new Error('Incomplete PR file list; split the PR or inspect the API limit.');
  const expected = config.workflows.filter((workflow) =>
    workflowApplies(
      workflow,
      files.map((file) => file.filename),
      pr.base.ref,
    ),
  );
  core.info(
    `Required existing workflows: ${expected.map((workflow) => workflow.name).join(', ') || 'none for this diff'}`,
  );
  for (let attempt = 0; attempt < 180; attempt++) {
    const current = (await github.rest.pulls.get({ ...context.repo, pull_number: pr.number })).data;
    if (current.head.sha !== pr.head.sha || current.state !== 'open')
      throw new Error('PR head changed or PR closed; use the newest gate run.');
    const runs = await github.paginate(github.rest.actions.listWorkflowRunsForRepo, {
      ...context.repo,
      event: 'pull_request',
      head_sha: pr.head.sha,
      per_page: 100,
    });
    const { waiting, failed } = evaluateRuns(expected, runs, pr.head.sha);
    if (failed.length) throw new Error(failed.join('\n'));
    if (!waiting.length) {
      core.info('All applicable CI workflows passed.');
      return;
    }
    if (attempt % 6 === 0) core.info(`Waiting for: ${waiting.join(', ')}`);
    await sleep(10000);
  }
  throw new Error(
    'CI did not finish within 30 minutes. Rerun this gate after fixing or completing the required workflows.',
  );
}

module.exports = { globMatches, workflowApplies, evaluateRuns, run };
