import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { CiEvent } from './constants.ts';
import { planGates } from './policy.ts';

const event = process.env.GITHUB_EVENT_NAME ?? '';
let paths: string[] = [];
if (event === CiEvent.PullRequest) {
  const base = process.env.PR_BASE_SHA ?? '';
  const head = process.env.PR_HEAD_SHA ?? '';
  if (![base, head].every(sha => /^[a-f0-9]{40}$/.test(sha))) {
    throw new Error('PR base and head must be complete commit SHAs');
  }
  // Local Git has no API file-count cap. --no-renames includes both old and new
  // paths so moving a sensitive file out of its directory cannot bypass checks.
  paths = execFileSync(
    'git',
    ['diff', '--name-only', '--no-renames', '-z', `${base}...${head}`, '--'],
    {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    },
  )
    .split('\0')
    .filter(Boolean);
}
const plan = planGates(paths, event, process.env.GITHUB_REF ?? '');
if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required');
appendFileSync(process.env.GITHUB_OUTPUT, `plan=${JSON.stringify(plan)}\n`);
for (const [name, enabled] of Object.entries(plan)) {
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${enabled}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### CI gate plan\n\nCompared ${paths.length} changed paths. Baseline checks always run.\n\n` +
      Object.entries(plan)
        .map(([name, enabled]) => `- ${name}: ${enabled ? 'required' : 'not required'}`)
        .join('\n') +
      '\n',
  );
}
