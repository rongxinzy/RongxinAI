import { expect, test } from 'vitest';

import { sanitizeLlamaCppServiceConfig } from './llamacpp';

test('sanitizeLlamaCppServiceConfig keeps valid fields and drops invalid numeric and enum values', () => {
  expect(sanitizeLlamaCppServiceConfig({
    host: ' 0.0.0.0 ',
    port: 'not-a-port',
    modelsDir: ' /tmp/models ',
    modelsMax: '2',
    modelsAutoload: 'true' as unknown as boolean,
    ctxSize: '8192',
    parallel: '2x',
    gpuLayers: 'all',
    threads: '8',
    batchSize: '256',
    ubatchSize: '64',
    device: ' 0,1 ',
    mainGpu: '-1',
    splitMode: 'layer',
    tensorSplit: ' 3,2 ',
    flashAttn: 'maybe' as 'auto',
    reasoning: 'on',
    chatTemplate: 'chatml',
    reasoningFormat: 'invalid' as 'auto',
  })).toEqual({
    host: '0.0.0.0',
    modelsDir: '/tmp/models',
    modelsMax: '2',
    modelsAutoload: true,
    device: '0,1',
    splitMode: 'layer',
    tensorSplit: '3,2',
  });
});
