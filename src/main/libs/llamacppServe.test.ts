import { expect, test } from 'vitest';

import { buildLlamaServerArgs } from './llamacppServe';

test('disables router model autoload by default', () => {
  expect(buildLlamaServerArgs({}, '/models', '/models-preset.ini')).toEqual(
    expect.arrayContaining(['--no-models-autoload']),
  );
});

test('enables unified KV for the shared two-slot context pool by default', () => {
  expect(buildLlamaServerArgs({ parallel: '2', kvUnified: true }, '/models', '/models-preset.ini')).toEqual(
    expect.arrayContaining(['--parallel', '2', '--kv-unified']),
  );
});

test('allows opting out of unified KV for statically partitioned slots', () => {
  expect(buildLlamaServerArgs({ kvUnified: false }, '/models', '/models-preset.ini')).toEqual(
    expect.arrayContaining(['--no-kv-unified']),
  );
});
