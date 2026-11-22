import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { load } from 'js-yaml';
import { expect, test } from 'vitest';
import { listReleaseCandidateBundles } from '../release/release-candidate-layout.mjs';

type Step = {
  name?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: { name?: string };
};
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
    expect(
      result.legs.filter(leg => leg.platform === 'windows').map(leg => leg.inference_edition),
    ).toEqual(['lite', 'cuda']);
    expect(
      result.legs.filter(leg => leg.platform === 'linux').map(leg => leg.inference_edition),
    ).toEqual(['cuda']);
    expect(result.legs.find(leg => leg.target === 'win32-x64-cuda')?.runner).toBe('windows-2022');
    expect(
      result.legs
        .filter(leg => leg.platform === 'macos')
        .map(leg => leg.target)
        .sort(),
    ).toEqual(['darwin-arm64-cpu', 'darwin-x64-cpu']);
  },
);

test('staged Windows release leaves the Linux cuda leg and both macOS architectures', () => {
  const result = plan({ MODE: 'release', WINDOWS_RELEASE_STAGED: 'true' });
  expect(result.status).toBe(0);
  expect(result.legs.map(leg => leg.target).sort()).toEqual([
    'darwin-arm64-cpu',
    'darwin-x64-cpu',
    'linux-x64-cuda',
  ]);
});

test.each(['cuda,cuda', ''])(
  'a requested Linux build plans exactly one lane with stale edition environment %j',
  edition => {
    const result = plan({
      BUILD_WINDOWS: 'false',
      BUILD_MACOS: 'false',
      LINUX_INFERENCE_EDITIONS: edition,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.legs.map(leg => leg.target)).toEqual(['linux-x64-cuda']);
  },
);

test.each([
  ['verify', 'Upload shell acceptance evidence'],
  ['release', 'Upload signed shell acceptance evidence'],
])('%s Windows shell evidence has a unique name per matrix job and attempt', (mode, step) => {
  const result = plan({ MODE: mode, BUILD_LINUX: 'false', BUILD_MACOS: 'false' });
  expect(result.status, result.stderr).toBe(0);
  expect(result.legs.map(leg => leg.target)).toEqual(['win32-x64-lite', 'win32-x64-cuda']);
  const template = workflow.jobs.build.steps.find(item => item.name === step)?.with?.name;
  expect(template).toBeDefined();
  const names = ['1', '2'].flatMap(attempt =>
    result.legs.map(leg =>
      template!
        .replace('${{ github.run_id }}', '123')
        .replace('${{ github.run_attempt }}', attempt)
        .replace('${{ matrix.target }}', leg.target),
    ),
  );
  expect(new Set(names).size).toBe(4);
});

test('Linux matrix exposes only the platform switch', () => {
  expect(workflow.on.workflow_call.inputs).not.toHaveProperty('linux-inference-editions');
  const selected = plan({
    BUILD_WINDOWS: 'false',
    BUILD_MACOS: 'false',
  });
  expect(selected.status).toBe(0);
  expect(selected.legs.map(leg => leg.target)).toEqual(['linux-x64-cuda']);
});

test('manual unsigned verification plans the supported Linux edition', () => {
  const entry = load(readFileSync('.github/workflows/build-platforms.yml', 'utf8')) as {
    jobs: { 'verify-inference-editions': { with: Record<string, string> } };
  };
  const inputs = entry.jobs['verify-inference-editions'].with;
  expect(inputs['build-linux']).toBe('${{ inputs.build_linux }}');
  expect(inputs).not.toHaveProperty('linux-inference-editions');
  const result = plan({
    BUILD_WINDOWS: 'false',
    BUILD_MACOS: 'false',
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.legs.map(leg => leg.target)).toEqual(['linux-x64-cuda']);
});

test('POSIX packaging stages the inference runtime through the builder hook', () => {
  const action = load(
    readFileSync('.github/actions/build-inference-packages/action.yml', 'utf8'),
  ) as {
    runs: { steps: Step[] };
  };
  const steps = action.runs.steps;
  expect(steps.some(step => step.run?.includes('prepare:inference-edition-runtime'))).toBe(false);
  expect(
    steps.find(step => step.name === 'Build macOS packages')?.env?.ZHIYUAN_UPDATE_VARIANT,
  ).toBe('${{ inputs.inference-edition }}');
  const { scripts } = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts: Record<string, string>;
  };
  for (const edition of ['cpu', 'cuda']) {
    expect(scripts[`dist:linux:${edition}`]).toMatch(
      new RegExp(`ZHIYUAN_UPDATE_VARIANT=${edition} bun run dist:linux$`),
    );
    expect(scripts[`dist:linux:${edition}`]).not.toContain('prepare:inference-edition-runtime');
  }
  const index = steps.findIndex(step => step.name === 'Build Linux packages');
  expect(index).toBeGreaterThan(-1);
  const build = steps[index];
  expect(build.if).toBe(
    "${{ inputs.platform == 'linux' && (inputs.mode == 'verify' || inputs.mode == 'release') }}",
  );
  expect(build.run).toBe('bun run dist:linux');
  expect(build.env?.ZHIYUAN_UPDATE_VARIANT).toBe('${{ inputs.inference-edition }}');
  expect(build.env?.APP_BUILD_VERSION).toBe(
    "${{ inputs.mode == 'release' && inputs.app-build-version || '' }}",
  );
  expect(build.env?.UPDATE_MANIFEST_KEY_ID).toBe(
    "${{ inputs.mode == 'release' && inputs.UPDATE-MANIFEST-KEY-ID || '' }}",
  );
  expect(build.env?.UPDATE_MANIFEST_PUBLIC_KEY_BASE64).toBe(
    "${{ inputs.mode == 'release' && inputs.UPDATE-MANIFEST-PUBLIC-KEY-BASE64 || '' }}",
  );
  expect(steps.some(step => step.name === 'Build Windows release (cpu)')).toBe(false);
});
