import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const researchRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(researchRoot, '../..');
const benchmarkRoot = path.join(researchRoot, 'benchmark');
const resultsRoot = path.join(researchRoot, 'results');
const stateRoot = path.join(researchRoot, 'state');
const logsRoot = path.join(researchRoot, 'logs');
const warmups = 10;
const updatesPerRun = 160;
const runs = 60;

function run(command, args, environment = {}) {
  return execFileSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, ...environment },
  });
}

function directoryBytes(directory) {
  return readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const entryPath = path.join(directory, entry.name);
    return total + (entry.isDirectory() ? directoryBytes(entryPath) : statSync(entryPath).size);
  }, 0);
}

function percentile(sortedValues, percentileValue) {
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * percentileValue) - 1),
  );
  return sortedValues[index];
}

function summarize(entries) {
  const durations = entries.flatMap(entry => entry.durations).sort((left, right) => left - right);
  const perRunTotals = entries
    .map(entry => entry.durations.reduce((total, duration) => total + duration, 0))
    .sort((left, right) => left - right);

  return {
    commits: durations.length,
    medianCommitMs: percentile(durations, 0.5),
    p95CommitMs: percentile(durations, 0.95),
    p99CommitMs: percentile(durations, 0.99),
    p95RunTotalMs: percentile(perRunTotals, 0.95),
    runs: entries.length,
  };
}

function appendJsonl(filePath, value) {
  const existing = readFileSync(filePath, 'utf8');
  writeFileSync(filePath, `${existing}${JSON.stringify(value)}\n`);
}

function writeProgress(status, totalFindings, staleCount) {
  writeFileSync(
    path.join(stateRoot, 'progress.json'),
    `${JSON.stringify(
      {
        iteration: 1,
        total_findings: totalFindings,
        status,
        stale_count: staleCount,
        last_seen: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
}

mkdirSync(resultsRoot, { recursive: true });

run(
  path.join(repositoryRoot, 'node_modules', '.bin', 'vite'),
  ['build', '--config', path.join(benchmarkRoot, 'vite.config.ts')],
  {
    REACT_COMPILER_EVALUATION: 'disabled',
    REACT_COMPILER_EVALUATION_OUT_DIR: 'dist-baseline',
  },
);
const baselineBundleBytes = directoryBytes(path.join(benchmarkRoot, 'dist-baseline'));

run(
  path.join(repositoryRoot, 'node_modules', '.bin', 'vite'),
  ['build', '--config', path.join(benchmarkRoot, 'vite.config.ts')],
  {
    REACT_COMPILER_EVALUATION: 'enabled',
    REACT_COMPILER_EVALUATION_OUT_DIR: 'dist',
  },
);
const compilerBundleBytes = directoryBytes(path.join(benchmarkRoot, 'dist'));

const rawMeasurements = run(
  path.join(repositoryRoot, 'node_modules', '.bin', 'electron'),
  [
    path.join(benchmarkRoot, 'run-electron.cjs'),
    String(warmups),
    String(updatesPerRun),
    String(runs),
  ],
  { REACT_COMPILER_EVALUATION_OUTPUT_DIR: 'dist' },
);
const measurements = JSON.parse(rawMeasurements);
const baselineEntries = measurements.filter(entry => entry.variant === 'baseline');
const compilerEntries = measurements.filter(entry => entry.variant === 'compiler');
const baseline = summarize(baselineEntries);
const compiler = summarize(compilerEntries);
const semanticHashes = new Set(measurements.map(entry => entry.textSha256));
const p95ImprovementPercent =
  ((baseline.p95CommitMs - compiler.p95CommitMs) / baseline.p95CommitMs) * 100;
const bundleGrowthPercent =
  ((compilerBundleBytes - baselineBundleBytes) / baselineBundleBytes) * 100;
const accepted =
  semanticHashes.size === 1 && p95ImprovementPercent >= 15 && bundleGrowthPercent <= 5;

const result = {
  acceptance: {
    accepted,
    bundleGrowthPercent,
    p95ImprovementPercent,
    reason: accepted
      ? 'All pre-registered thresholds passed.'
      : 'At least one pre-registered threshold did not pass.',
    semanticHashCount: semanticHashes.size,
  },
  benchmark: {
    electronVersion: run(path.join(repositoryRoot, 'node_modules', '.bin', 'electron'), [
      '--version',
    ]).trim(),
    reactVersion: JSON.parse(
      readFileSync(path.join(repositoryRoot, 'node_modules', 'react', 'package.json')),
    ).version,
    updatesPerRun,
    warmups,
  },
  bundleBytes: {
    baseline: baselineBundleBytes,
    compiler: compilerBundleBytes,
  },
  compiler,
  baseline,
  generatedAt: new Date().toISOString(),
  measurementsSha256: createHash('sha256').update(rawMeasurements).digest('hex'),
};

writeFileSync(path.join(resultsRoot, 'iteration-1.json'), `${JSON.stringify(result, null, 2)}\n`);
appendJsonl(path.join(stateRoot, 'findings.jsonl'), {
  finding: 'Completed a paired, alternating Electron benchmark of compiler and baseline workloads.',
  generatedAt: result.generatedAt,
  result,
});
appendJsonl(path.join(stateRoot, 'iteration_log.jsonl'), {
  direction: 'compiler annotation mode against a Cowork-shaped streaming workload',
  iteration: 1,
  result: result.acceptance,
  ts: result.generatedAt,
});
appendJsonl(path.join(logsRoot, 'work.jsonl'), {
  event: 'measurement_complete',
  level: 'info',
  source: 'work',
  ts: result.generatedAt,
});
appendJsonl(path.join(logsRoot, 'orchestrator.jsonl'), {
  detail: result.acceptance.reason,
  event: 'iteration_evaluated',
  level: accepted ? 'info' : 'decision',
  source: 'orchestrator',
  ts: result.generatedAt,
});
writeProgress(accepted ? 'accepted' : 'needs_second_direction', 1, accepted ? 0 : 1);

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
