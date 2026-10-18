import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { CiEvent } from './constants.ts';

export const InferenceBuildMode = {
  Full: 'full',
  Smoke: 'smoke',
  Skip: 'skip',
} as const;

export type InferenceBuildMode = (typeof InferenceBuildMode)[keyof typeof InferenceBuildMode];

/** Packaging definition changes: full 7-leg matrix on pull requests. */
const fullPackaging =
  /^(?:electron-builder[^/]*\.(?:json|cjs)|vendor\/llamacpp\/|\.github\/workflows\/(?:build-inference-editions|build-platforms|release)\.ya?ml$|scripts\/release\/|scripts\/(?:build-magpie|download-llamacpp|llamacpp-runtime|electron-builder|dist\/|packaging\/|installer-shell\/))/;

/** Dependency or bundled asset drift: one Linux cpu smoke leg only. */
const packagingSmoke = /^(?:package\.json$|bun\.lock$|patches\/|build\/|resources\/|scripts\/)/;

export function classifyInferenceBuildPaths(paths: string[]): InferenceBuildMode {
  if (paths.length === 0) return InferenceBuildMode.Skip;
  if (paths.some(file => fullPackaging.test(file))) return InferenceBuildMode.Full;
  if (paths.some(file => packagingSmoke.test(file))) return InferenceBuildMode.Smoke;
  return InferenceBuildMode.Skip;
}

export function resolveInferenceBuildMode(event: string, paths: string[]): InferenceBuildMode {
  if (event === 'schedule' || event === CiEvent.Manual) return InferenceBuildMode.Full;
  if (event !== CiEvent.PullRequest) return InferenceBuildMode.Skip;
  return classifyInferenceBuildPaths(paths);
}

const runningAsCli = process.argv[1]?.includes('plan-inference-build') ?? false;
if (runningAsCli) {
  const event = process.env.GITHUB_EVENT_NAME ?? '';
  let paths: string[] = [];
  if (event === CiEvent.PullRequest) {
    const base = process.env.PR_BASE_SHA ?? '';
    const head = process.env.PR_HEAD_SHA ?? '';
    if (![base, head].every(sha => /^[a-f0-9]{40}$/.test(sha))) {
      throw new Error('PR base and head must be complete commit SHAs');
    }
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

  const mode = resolveInferenceBuildMode(event, paths);
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required');
  appendFileSync(process.env.GITHUB_OUTPUT, `mode=${mode}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Inference edition build plan\n\n- event: ${event}\n- changed paths: ${paths.length}\n- mode: **${mode}**\n`,
    );
  }
}
