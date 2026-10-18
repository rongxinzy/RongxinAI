import { expect, test } from 'vitest';

import { buildLlamaServerArgs } from './llamacppServe';

const ROUTER_GPU_PLACEMENT_FLAGS = [
  '--device',
  '--main-gpu',
  '--tensor-split',
  '--gpu-layers',
  '--n-gpu-layers',
  '--split-mode',
] as const;

test('disables router model autoload by default', () => {
  expect(buildLlamaServerArgs({}, '/models', '/models-preset.ini')).toEqual(
    expect.arrayContaining(['--no-models-autoload']),
  );
});

test('never places GPU routing flags on the router command line', () => {
  const args = buildLlamaServerArgs(
    {
      gpuLayers: 'all',
      device: 'CUDA0,CUDA1',
      mainGpu: '1',
      splitMode: 'layer',
      tensorSplit: '3,1',
    },
    '/models',
    '/models-preset.ini',
  );

  for (const flag of ROUTER_GPU_PLACEMENT_FLAGS) {
    expect(args).not.toContain(flag);
  }
});

test('enables unified KV for the shared two-slot context pool by default', () => {
  expect(
    buildLlamaServerArgs({ parallel: '2', kvUnified: true }, '/models', '/models-preset.ini'),
  ).toEqual(expect.arrayContaining(['--parallel', '2', '--kv-unified']));
});

test('allows opting out of unified KV for statically partitioned slots', () => {
  expect(buildLlamaServerArgs({ kvUnified: false }, '/models', '/models-preset.ini')).toEqual(
    expect.arrayContaining(['--no-kv-unified']),
  );
});
