// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { expect, test } from 'vitest';

import {
  ModelConnectionStatus,
  useModelConnectionStatus,
} from './useModelConnectionStatus';

test('reads unknown for models that were never tested', () => {
  const { result } = renderHook(() => useModelConnectionStatus());

  expect(result.current.getModelConnectionStatus('qwen', 'glm-4.5')).toBe(
    ModelConnectionStatus.Unknown,
  );
});

test('merges batched progress without dropping statuses written earlier', () => {
  const { result } = renderHook(() => useModelConnectionStatus());

  act(() => {
    result.current.setModelConnectionStatus('qwen', 'glm-4.5', ModelConnectionStatus.Success);
    result.current.mergeProviderModelConnectionStatuses('qwen', { 'qwen3-max': ModelConnectionStatus.Failure });
  });

  expect(result.current.getModelConnectionStatus('qwen', 'glm-4.5')).toBe(
    ModelConnectionStatus.Success,
  );
  expect(result.current.getModelConnectionStatus('qwen', 'qwen3-max')).toBe(
    ModelConnectionStatus.Failure,
  );
});

test('overwrites the whole provider map only on the explicit full write', () => {
  const { result } = renderHook(() => useModelConnectionStatus());

  act(() => {
    result.current.mergeProviderModelConnectionStatuses('qwen', {
      'glm-4.5': ModelConnectionStatus.Success,
      'qwen3-max': ModelConnectionStatus.Success,
    });
    result.current.setProviderModelConnectionStatuses('qwen', {
      'glm-4.5': ModelConnectionStatus.Failure,
    });
  });

  expect(result.current.getModelConnectionStatus('qwen', 'glm-4.5')).toBe(
    ModelConnectionStatus.Failure,
  );
  expect(result.current.getModelConnectionStatus('qwen', 'qwen3-max')).toBe(
    ModelConnectionStatus.Unknown,
  );
});

test('keeps other providers untouched when one provider is reset', () => {
  const { result } = renderHook(() => useModelConnectionStatus());

  act(() => {
    result.current.setModelConnectionStatus('qwen', 'glm-4.5', ModelConnectionStatus.Success);
    result.current.setModelConnectionStatus('openai', 'gpt-5', ModelConnectionStatus.Success);
  });

  act(() => {
    result.current.resetProviderModelConnectionStatuses('qwen');
  });

  expect(result.current.getModelConnectionStatus('qwen', 'glm-4.5')).toBe(
    ModelConnectionStatus.Unknown,
  );
  expect(result.current.getModelConnectionStatus('openai', 'gpt-5')).toBe(
    ModelConnectionStatus.Success,
  );
});
