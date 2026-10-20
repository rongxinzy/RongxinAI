import { BaselineJob, JobResult, PackagingJob, PreflightJob } from './constants.ts';

type Results = Record<string, { result: string }>;

function requireResult(results: Results, name: string, expected: string = JobResult.Success): void {
  if (results[name]?.result !== expected) {
    throw new Error(`Check ${name} must be ${expected}, received ${results[name]?.result}`);
  }
}

export function verifyGateResults(results: Results): void {
  for (const name of Object.values(BaselineJob)) requireResult(results, name);
}

export function verifyPreflightResults(results: Results, includePackaging: boolean): void {
  if (typeof includePackaging !== 'boolean') throw new Error('Missing packaging decision');
  for (const name of Object.values(PreflightJob)) requireResult(results, name);
  for (const name of Object.values(PackagingJob)) {
    requireResult(results, name, includePackaging ? JobResult.Success : JobResult.Skipped);
  }
}
