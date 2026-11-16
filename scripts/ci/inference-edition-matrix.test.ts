import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { load } from 'js-yaml';
import { expect, test } from 'vitest';
import { listReleaseCandidateBundles } from '../release/release-candidate-layout.mjs';

type Step = { name?: string; run?: string; if?: string; env?: Record<string, string> };
type MatrixLeg = { platform: string; target: string; runner: string; inference_edition: string };
const workflow = load(readFileSync('.github/workflows/build-inference-editions.yml', 'utf8')) as {
  on: { workflow_call: { inputs: Record<string, { default?: string }> } };
  jobs: Record<string, { steps: Step[] }>;
};

function plan(overrides: Record<string, string> = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'inference-matrix-'));
  const output = path.join(directory, 'output');
  try {
    const result = spawnSync('bash', ['-e', '-c', workflow.jobs['plan-matrix'].steps[0].run!], {
      encoding: 'utf8',
      env: {
        ...process.env,
        BUILD_WINDOWS: 'true',
        BUILD_LINUX: 'true',
        BUILD_MACOS: 'true',
        MODE: 'verify',
        WINDOWS_RELEASE_STAGED: 'false',
        LINUX_INFERENCE_EDITIONS:
          workflow.on.workflow_call.inputs['linux-inference-editions'].default!,
        ...overrides,
        GITHUB_OUTPUT: output,
      },
    });
    const legs: MatrixLeg[] =
      result.status === 0
        ? JSON.parse(readFileSync(output, 'utf8').trim().slice('matrix='.length)).include
        : [];
    return { ...result, legs };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test.each(['verify', 'release'])(
  '%s builds exactly the supported release candidate editions',
  mode => {
    const result = plan({ MODE: mode });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.legs.map(leg => leg.target).sort()).toEqual(
      listReleaseCandidateBundles()
        .map(bundle => bundle.bundleId)
        .sort(),
    );
    for (const platform of ['windows', 'linux']) {
      expect(
        result.legs.filter(leg => leg.platform === platform).map(leg => leg.inference_edition),
      ).toEqual(['lite', 'cuda']);
    }
    expect(result.legs.find(leg => leg.target === 'win32-x64-cuda')?.runner).toBe('windows-2022');
    expect(
      result.legs
        .filter(leg => leg.platform === 'macos')
        .map(leg => leg.target)
        .sort(),
    ).toEqual(['darwin-arm64-cpu', 'darwin-x64-cpu']);
  },
);

test('staged Windows release leaves both Linux editions and both macOS architectures', () => {
  const result = plan({ MODE: 'release', WINDOWS_RELEASE_STAGED: 'true' });
  expect(result.status).toBe(0);
  expect(result.legs.map(leg => leg.target).sort()).toEqual([
    'darwin-arm64-cpu',
    'darwin-x64-cpu',
    'linux-x64-cuda',
    'linux-x64-lite',
  ]);
});

test('Linux matrix permits Lite/CUDA subsets and rejects CPU-only builds', () => {
  const selected = plan({
    BUILD_WINDOWS: 'false',
    BUILD_MACOS: 'false',
    LINUX_INFERENCE_EDITIONS: 'lite',
  });
  expect(selected.status).toBe(0);
  expect(selected.legs.map(leg => leg.target)).toEqual(['linux-x64-lite']);
  const removed = plan({ LINUX_INFERENCE_EDITIONS: 'cpu,cuda' });
  expect(removed.status).not.toBe(0);
  expect(removed.stderr).toContain('Unsupported Linux inference edition: cpu');
});

test('Linux packaging uses staged runtimes and preserves the selected edition in both modes', () => {
  const action = load(
    readFileSync('.github/actions/build-inference-packages/action.yml', 'utf8'),
  ) as {
    runs: { steps: Step[] };
  };
  const steps = action.runs.steps;
  const stageIndex = steps.findIndex(step => step.name === 'Stage bundled llama.cpp runtime');
  expect(stageIndex).toBeGreaterThan(-1);
  expect(steps[stageIndex].if).toBe("${{ inputs.inference-edition != 'lite' }}");
  for (const name of ['Build Linux (verify)', 'Build Linux release']) {
    const index = steps.findIndex(step => step.name === name);
    expect(index).toBeGreaterThan(stageIndex);
    expect(steps[index].run).toBe('bun run dist:linux');
    expect(steps[index].env?.ZHIYUAN_UPDATE_VARIANT).toBe('${{ inputs.inference-edition }}');
  }
  expect(steps.some(step => step.name === 'Build Windows release (cpu)')).toBe(false);
});
