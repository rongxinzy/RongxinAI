import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';

const PI_CONNECT_REPO = /rongxinzy\/pi-connect/;
const CC_CONNECT_SOURCE = /ZHIYUAN_CC_CONNECT_SOURCE/;
const SETUP_GO_USES = /^actions\/setup-go@/i;
const MAGPIE_BUILD_RUN = /\bbun\s+run\s+magpie:build\b/;

export function listGuardedWorkflowFiles(rootDir) {
  const workflowsDir = path.join(rootDir, '.github', 'workflows');
  if (!fs.existsSync(workflowsDir)) return [];
  return fs
    .readdirSync(workflowsDir)
    .filter(name => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map(name => path.join('.github', 'workflows', name))
    .sort();
}

function stripShellComments(runScript) {
  return runScript
    .split(/\r?\n/)
    .map(line => {
      const hashIndex = line.indexOf('#');
      if (hashIndex === -1) return line;
      return line.slice(0, hashIndex);
    })
    .join('\n');
}

export function runExecutesMagpieBuild(run) {
  if (typeof run !== 'string' || !run.trim()) return false;
  return MAGPIE_BUILD_RUN.test(stripShellComments(run));
}

export function stepUsesSetupGo(step) {
  return typeof step?.uses === 'string' && SETUP_GO_USES.test(step.uses.trim());
}

function collectStepStrings(step) {
  const values = [];
  if (typeof step?.run === 'string') values.push(step.run);
  if (typeof step?.uses === 'string') values.push(step.uses);
  if (typeof step?.name === 'string') values.push(step.name);
  if (step?.with && typeof step.with === 'object' && !Array.isArray(step.with)) {
    for (const value of Object.values(step.with)) {
      if (typeof value === 'string') values.push(value);
    }
  }
  if (step?.env && typeof step.env === 'object' && !Array.isArray(step.env)) {
    for (const [key, value] of Object.entries(step.env)) {
      values.push(key);
      if (typeof value === 'string') values.push(value);
    }
  }
  return values;
}

function jobUsesPiConnectSource(jobId, job, workflowFile) {
  const failures = [];
  const jobEnv =
    job?.env && typeof job.env === 'object' && !Array.isArray(job.env) ? job.env : {};
  for (const [key, value] of Object.entries(jobEnv)) {
    if (CC_CONNECT_SOURCE.test(key) || (typeof value === 'string' && CC_CONNECT_SOURCE.test(value))) {
      failures.push(
        `${workflowFile} job ${jobId}: must not build pi-connect from source (use published channel runtime assets)`,
      );
      return failures;
    }
  }

  for (const step of job?.steps ?? []) {
    if (!step || typeof step !== 'object') continue;
    for (const text of collectStepStrings(step)) {
      if (PI_CONNECT_REPO.test(text)) {
        failures.push(
          `${workflowFile} job ${jobId}: must not build pi-connect from source (use published channel runtime assets)`,
        );
        return failures;
      }
      if (CC_CONNECT_SOURCE.test(text)) {
        failures.push(
          `${workflowFile} job ${jobId}: must not build pi-connect from source (use published channel runtime assets)`,
        );
        return failures;
      }
    }
    const repository = step.with?.repository;
    if (typeof repository === 'string' && PI_CONNECT_REPO.test(repository)) {
      failures.push(
        `${workflowFile} job ${jobId}: must not build pi-connect from source (use published channel runtime assets)`,
      );
      return failures;
    }
  }
  return failures;
}

function jobSetupGoPolicy(jobId, job, workflowFile) {
  const steps = Array.isArray(job?.steps) ? job.steps : [];
  const hasSetupGo = steps.some(stepUsesSetupGo);
  if (!hasSetupGo) return [];
  const hasMagpieBuildRun = steps.some(step => runExecutesMagpieBuild(step?.run));
  if (hasMagpieBuildRun) return [];
  return [
    `${workflowFile} job ${jobId}: actions/setup-go is only allowed when a step run executes bun run magpie:build in the same job`,
  ];
}

/**
 * @param {string} workflowFile
 * @param {string} content
 * @returns {string[]}
 */
export function validateWorkflowFile(workflowFile, content) {
  let document;
  try {
    document = yaml.load(content);
  } catch (error) {
    return [`${workflowFile}: invalid workflow YAML (${error.message})`];
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    return [`${workflowFile}: workflow root must be a mapping`];
  }
  const jobs = document.jobs;
  if (!jobs || typeof jobs !== 'object' || Array.isArray(jobs)) {
    return [];
  }

  const failures = [];
  for (const [jobId, job] of Object.entries(jobs)) {
    failures.push(...jobUsesPiConnectSource(jobId, job, workflowFile));
    failures.push(...jobSetupGoPolicy(jobId, job, workflowFile));
  }
  return failures;
}
