import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';

export const PI_CONNECT_REPO = /rongxinzy\/pi-connect/;
export const CC_CONNECT_SOURCE = /ZHIYUAN_CC_CONNECT_SOURCE/;
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

/** Remove decoupling gate invocations without dropping unrelated text on the same line. */
export function stripWorkflowGateReferences(content) {
  return content
    .replace(/\bbun run check:openclaw-decoupling\b/g, '')
    .replace(/\bnode scripts\/ci\/check-openclaw-decoupling\.mjs\b/g, '');
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

export function isStaticallyDisabledStep(step) {
  if (!step || typeof step !== 'object' || !('if' in step)) return false;
  const ifValue = step.if;
  if (ifValue === false) return true;
  if (typeof ifValue === 'string') {
    const normalized = ifValue.trim().replace(/\s+/g, '');
    return normalized === 'false' || normalized === '${{false}}';
  }
  return false;
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

function envMappingUsesPiConnect(env, workflowFile, label) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) return [];
  for (const [key, value] of Object.entries(env)) {
    if (CC_CONNECT_SOURCE.test(key)) {
      return [
        `${workflowFile} ${label}: must not build pi-connect from source (use published channel runtime assets)`,
      ];
    }
    if (typeof value === 'string') {
      if (PI_CONNECT_REPO.test(value) || CC_CONNECT_SOURCE.test(value)) {
        return [
          `${workflowFile} ${label}: must not build pi-connect from source (use published channel runtime assets)`,
        ];
      }
    }
  }
  return [];
}

function jobUsesPiConnectSource(jobId, job, workflowFile) {
  const failures = envMappingUsesPiConnect(job?.env, workflowFile, `job ${jobId} env`);
  if (failures.length > 0) return failures;

  for (const step of job?.steps ?? []) {
    if (!step || typeof step !== 'object') continue;
    for (const text of collectStepStrings(step)) {
      if (PI_CONNECT_REPO.test(text)) {
        return [
          `${workflowFile} job ${jobId}: must not build pi-connect from source (use published channel runtime assets)`,
        ];
      }
      if (CC_CONNECT_SOURCE.test(text)) {
        return [
          `${workflowFile} job ${jobId}: must not build pi-connect from source (use published channel runtime assets)`,
        ];
      }
    }
    const repository = step.with?.repository;
    if (typeof repository === 'string' && PI_CONNECT_REPO.test(repository)) {
      return [
        `${workflowFile} job ${jobId}: must not build pi-connect from source (use published channel runtime assets)`,
      ];
    }
  }
  return [];
}

function jobSetupGoPolicy(jobId, job, workflowFile) {
  const steps = (Array.isArray(job?.steps) ? job.steps : []).filter(step => !isStaticallyDisabledStep(step));
  const hasSetupGo = steps.some(stepUsesSetupGo);
  if (!hasSetupGo) return [];
  const hasMagpieBuildRun = steps.some(step => runExecutesMagpieBuild(step?.run));
  if (hasMagpieBuildRun) return [];
  return [
    `${workflowFile} job ${jobId}: actions/setup-go is only allowed when a step run executes bun run magpie:build in the same job`,
  ];
}

export function validateWorkflowPiConnectFileFallback(workflowFile, content) {
  const stripped = stripWorkflowGateReferences(content);
  if (!PI_CONNECT_REPO.test(stripped) && !CC_CONNECT_SOURCE.test(stripped)) return [];
  return [
    `${workflowFile}: must not build pi-connect from source (file-level reference to pi-connect or ZHIYUAN_CC_CONNECT_SOURCE)`,
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

  const failures = [];
  failures.push(...envMappingUsesPiConnect(document.env, workflowFile, 'workflow env'));
  failures.push(...validateWorkflowPiConnectFileFallback(workflowFile, content));

  const jobs = document.jobs;
  if (!jobs || typeof jobs !== 'object' || Array.isArray(jobs)) {
    return failures;
  }

  for (const [jobId, job] of Object.entries(jobs)) {
    failures.push(...jobUsesPiConnectSource(jobId, job, workflowFile));
    failures.push(...jobSetupGoPolicy(jobId, job, workflowFile));
  }
  return failures;
}

export function validateAllWorkflowFiles(rootDir) {
  const failures = [];
  for (const workflowFile of listGuardedWorkflowFiles(rootDir)) {
    const content = fs.readFileSync(path.join(rootDir, workflowFile), 'utf8');
    failures.push(...validateWorkflowFile(workflowFile, content));
  }
  return failures;
}
