import { describe, expect, test } from 'vitest';

import {
  formatModelInspectorContext,
  getModelInspectorContextLimit,
  getModelInspectorContextValue,
  MODEL_INSPECTOR_CONTEXT_MAX,
  parseModelInspectorContextK,
} from './modelInspectorViewModel';

describe('modelInspectorViewModel', () => {
  test('formats context values in K units', () => {
    expect(formatModelInspectorContext(4096)).toBe('4K');
    expect(formatModelInspectorContext(1536)).toBe('1.5K');
    expect(formatModelInspectorContext()).toBeUndefined();
  });

  test('caps the configurable context at the trained limit and 128K', () => {
    expect(getModelInspectorContextLimit({ name: 'small', trained_context_length: 32768 })).toBe(
      32768,
    );
    expect(getModelInspectorContextLimit({ name: 'large', trained_context_length: 262144 })).toBe(
      MODEL_INSPECTOR_CONTEXT_MAX,
    );
  });

  test('uses the saved model preference before runtime and model metadata', () => {
    expect(
      getModelInspectorContextValue({
        model: { name: 'model', trained_context_length: 65536 },
        preference: { ctxSize: 16384 },
        runningModel: { name: 'model', runtime_context_length: 32768 },
      }),
    ).toBe(16384);
  });

  test('accepts only whole-K values inside the supported range', () => {
    expect(parseModelInspectorContextK('64', 65536)).toBe(65536);
    expect(parseModelInspectorContextK('3', 65536)).toBeUndefined();
    expect(parseModelInspectorContextK('65', 65536)).toBeUndefined();
    expect(parseModelInspectorContextK('4.5', 65536)).toBeUndefined();
  });
});
