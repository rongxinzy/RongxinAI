import { expect, test } from 'vitest';

import {
  LLAMACPP_STRUCTURED_SERVICE_FIELD_KEYS,
  validateLlamaCppStructuredServiceConfig,
} from './serviceConfigSchema';

test('validateLlamaCppStructuredServiceConfig rejects Chinese values for structured fields', () => {
  const result = validateLlamaCppStructuredServiceConfig({
    mainGpu: '主卡',
    cacheReuse: '中文',
    device: '显卡0',
    gpuLayers: '自动',
    tensorSplit: '按张量拆分',
    splitMode: 'tensor',
  });

  expect(result.fieldErrors.mainGpu?.code).toBe('integer-range');
  expect(result.fieldErrors.cacheReuse?.code).toBe('integer-range');
  expect(result.fieldErrors.device?.code).toBe('device-format');
  expect(result.fieldErrors.gpuLayers?.code).toBe('gpu-layers-format');
  expect(result.fieldErrors.tensorSplit?.code).toBe('tensor-split-format');
});

test('validateLlamaCppStructuredServiceConfig accepts valid structured values', () => {
  const result = validateLlamaCppStructuredServiceConfig({
    modelsMax: '0',
    device: '0,1',
    parallel: '8',
    timeout: '120',
    threadsHttp: '4',
    cacheReuse: '256',
    cacheRam: '8192',
    ctxSize: '4096',
    tensorSplit: '3,2',
    splitMode: 'tensor',
    mainGpu: '256',
    batchSize: '2048',
    ubatchSize: '512',
    threads: '-1',
    threadsBatch: '8',
    gpuLayers: 'auto',
  });

  expect(result.hasErrors).toBe(false);
  expect(result.fieldErrors).toEqual({});
});

test('validateLlamaCppStructuredServiceConfig accepts only numeric device indexes', () => {
  expect(validateLlamaCppStructuredServiceConfig({
    device: '0,1,2',
  }).fieldErrors.device).toBeUndefined();

  expect(validateLlamaCppStructuredServiceConfig({
    device: 'CUDA0,CUDA1',
  }).fieldErrors.device?.code).toBe('device-format');
});

test('validateLlamaCppStructuredServiceConfig requires tensor split mode for tensorSplit', () => {
  const result = validateLlamaCppStructuredServiceConfig({
    tensorSplit: '3,2',
    splitMode: 'layer',
  });

  expect(result.fieldErrors.tensorSplit?.code).toBe('tensor-split-requires-mode');
});

test('validateLlamaCppStructuredServiceConfig keeps field coverage aligned with the visible structured fields', () => {
  expect(LLAMACPP_STRUCTURED_SERVICE_FIELD_KEYS).toEqual([
    'modelsMax',
    'device',
    'parallel',
    'timeout',
    'threadsHttp',
    'cacheReuse',
    'cacheRam',
    'ctxSize',
    'tensorSplit',
    'mainGpu',
    'batchSize',
    'ubatchSize',
    'threads',
    'threadsBatch',
    'gpuLayers',
  ]);
});

test('validateLlamaCppStructuredServiceConfig stays aligned with the local inference service config UI', async () => {
  const module = await import('../../renderer/components/localInference/LocalInferenceView');
  const getServiceConfigFields = (module as unknown as {
    __test__getServiceConfigFields?: () => Array<{ key: string }>;
  }).__test__getServiceConfigFields;

  expect(typeof getServiceConfigFields).toBe('function');
  if (!getServiceConfigFields) return;

  const structuredFieldSet = new Set(LLAMACPP_STRUCTURED_SERVICE_FIELD_KEYS);
  const uiStructuredKeys = getServiceConfigFields()
    .map(field => field.key)
    .filter((key): key is typeof LLAMACPP_STRUCTURED_SERVICE_FIELD_KEYS[number] =>
      structuredFieldSet.has(key as typeof LLAMACPP_STRUCTURED_SERVICE_FIELD_KEYS[number]))
    .sort();

  const schemaKeySet = new Set(LLAMACPP_STRUCTURED_SERVICE_FIELD_KEYS);
  for (const key of uiStructuredKeys) {
    expect(schemaKeySet.has(key)).toBe(true);
  }
});
