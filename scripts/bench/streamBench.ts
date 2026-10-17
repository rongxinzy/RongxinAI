/**
 * Streaming pipeline bench (review S1 rewrite of bench:stream).
 *
 * Compares the pre-#1119 main-process pipeline (A) against the incremental
 * pipeline of this PR at phase 1 (C) and phase 1+2 (D) under a virtual clock:
 * no real sleeping, so a 2 MB stream at 50 tokens/s costs seconds of wall
 * time instead of hours. Run with node (bun's perf_hooks numbers are not
 * trustworthy); package.json bench:stream builds with bun and executes with node.
 *
 * Usage:
 *   node streamBench.mjs [--group=A|C|D] [--rate=50|200|1000] [--size=100kb|2mb]
 *                        [--thinking] [--render] [--a-max-size=500kb] [--out=path.json]
 *
 * 1 token = 4 UTF-16 code units. Results: one JSON object per scenario on
 * stdout, plus the full run written to --out (default
 * bench-results/stream-bench.json, directory created when missing).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { runScenario, type BenchFlags } from './benchGroups';
import type { BenchGroup, BenchSize, ScenarioConfig, ScenarioResult } from './scenarioShared';

const argValue = (name: string): string | undefined => {
  const hit = process.argv.find(arg => arg.startsWith(`--${name}=`));
  return hit === undefined ? undefined : hit.slice(name.length + 3);
};

const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

const parseRate = (raw: string | undefined): number | null => {
  if (raw === undefined) return null;
  const rate = Number.parseInt(raw, 10);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`bench: invalid --rate=${raw}`);
  return rate;
};

const parseSize = (raw: string | undefined): BenchSize | null => {
  if (raw === undefined) return null;
  const normalized = raw.toLowerCase();
  if (normalized === '100kb' || normalized === '2mb') return normalized;
  throw new Error(`bench: invalid --size=${raw} (expected 100kb or 2mb)`);
};

const parseGroups = (raw: string | undefined): readonly BenchGroup[] => {
  if (raw === undefined) return ['A', 'C', 'D'];
  const groups: BenchGroup[] = [];
  for (const part of raw.split(',')) {
    const group = part.trim().toUpperCase();
    if (group !== 'A' && group !== 'C' && group !== 'D') {
      throw new Error(`bench: invalid --group=${raw} (expected A, C or D)`);
    }
    groups.push(group);
  }
  return groups;
};

const parseCharCount = (raw: string): number => {
  const match = /^(\d+)(kb|mb)?$/.exec(raw.toLowerCase());
  if (match === null) throw new Error(`bench: invalid size value ${raw}`);
  const base = Number.parseInt(match[1]!, 10);
  if (match[2] === 'kb') return base * 1000;
  if (match[2] === 'mb') return base * 1_000_000;
  return base;
};

const RATES: readonly number[] = [50, 200, 1000];
const SIZES: readonly BenchSize[] = ['100kb', '2mb'];

const buildMatrix = (
  rate: number | null,
  size: BenchSize | null,
  thinkingOnly: boolean,
  groups: readonly BenchGroup[],
): ScenarioConfig[] => {
  const rates = rate === null ? RATES : [rate];
  const sizes = size === null ? SIZES : [size];
  const scenarios: ScenarioConfig[] = [];
  for (const group of groups) {
    if (!thinkingOnly) {
      for (const scenarioSize of sizes) {
        for (const scenarioRate of rates) {
          scenarios.push({ group, rate: scenarioRate, size: scenarioSize, thinking: false });
        }
      }
    }
    // Interleaved thinking+text (half of the bytes each): defaults to 100kb —
    // LiveTextStore rebuilds the interleaved part tail on every out-of-order
    // delta, so 2mb here is a deliberate worst case you must opt into with
    // --size=2mb --thinking.
    const thinkingSize = size ?? '100kb';
    for (const scenarioRate of rates) {
      scenarios.push({ group, rate: scenarioRate, size: thinkingSize, thinking: true });
    }
  }
  return scenarios;
};

const buildMeta = (flags: BenchFlags, scenarioCount: number): Record<string, unknown> => ({
  generatedAt: new Date().toISOString(),
  node: process.version,
  scenarios: scenarioCount,
  tokenUnit: '1 token = 4 UTF-16 code units',
  aMaxChars: flags.aMaxChars,
  renderAppliedTo: 'D only (jsdom lower-bound component)',
  metricNotes: {
    cpuMsPerVirtualSecond:
      'mainCpuMs / (virtualDurationMs / 1000). Replaces ELU / event-loop-delay, which are meaningless under a virtual clock: estimate of how much of the single bench thread the pipeline occupies.',
    maxBlockingMs:
      'Wall duration of the longest synchronous callback (one Pi token, one virtual timer, or one rAF frame apply) — the event-loop blocking proxy.',
    p99BlockingMs: 'p99 of that same callback-duration distribution.',
    workerCpuMs:
      'Group A only: wall time of the synchronous prefix-diff step that main@aa288943 ran inside its text worker; already included in mainCpuMs.',
    e2eLatencyP50Ms:
      'Virtual ms from a delta being produced to the frame that made it visible in the renderer model (p95 likewise).',
    sqliteWrites:
      'Transcript store.updateMessage writes under the 200 ms leading+trailing throttle model (A: copied legacy throttles; C/D: the same model applied to the incremental pipeline).',
    rendererCommits:
      'A: rAF frames carrying at least one ContentPatch; C: rAF frames dispatching to mock Redux; D: rAF frames applying chunks (with --render: React commits of the jsdom lower-bound component).',
    ipcBytes: 'A: legacy payload {sessionId,messageId,patch}; C/D: JSON of the sequenced PiUiEvent.',
  },
});

const main = async (): Promise<void> => {
  const groups = parseGroups(argValue('group'));
  const rate = parseRate(argValue('rate'));
  const size = parseSize(argValue('size'));
  const thinkingOnly = hasFlag('thinking');
  const flags: BenchFlags = {
    render: hasFlag('render'),
    aMaxChars: parseCharCount(argValue('a-max-size') ?? '500kb'),
  };
  const scenarios = buildMatrix(rate, size, thinkingOnly, groups);
  console.error(
    `[bench:stream] ${scenarios.length} scenario(s), groups=${groups.join('+')}, render=${String(flags.render)}, aMaxChars=${flags.aMaxChars}`,
  );

  const results: ScenarioResult[] = [];
  for (const config of scenarios) {
    const result = await runScenario(config, flags);
    results.push(result);
    console.log(JSON.stringify(result));
    console.error(
      `[bench:stream] ${config.group}/${config.size}/${config.rate}tok/s${config.thinking ? '/thinking' : ''} wall=${result.wallMs}ms`,
    );
  }

  const outPath = resolve(argValue('out') ?? 'bench-results/stream-bench.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    `${JSON.stringify({ meta: buildMeta(flags, results.length), results }, null, 2)}\n`,
    'utf8',
  );
  console.error(`[bench:stream] wrote ${outPath}`);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
