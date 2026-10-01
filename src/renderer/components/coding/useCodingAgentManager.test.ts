// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { CodingUiEvent } from './constants';
import { useCodingAgentManager } from './useCodingAgentManager';

test('opens the manager from the sidebar event, permits closing, and removes its listener', () => {
  const removeListener = vi.spyOn(window, 'removeEventListener');
  const { result, unmount } = renderHook(() => useCodingAgentManager());
  expect(result.current[0]).toBe(false);
  act(() => window.dispatchEvent(new CustomEvent(CodingUiEvent.ManageAgents)));
  expect(result.current[0]).toBe(true);
  act(() => result.current[1](false));
  expect(result.current[0]).toBe(false);
  unmount();
  expect(removeListener).toHaveBeenCalledWith(CodingUiEvent.ManageAgents, expect.any(Function));
  removeListener.mockRestore();
});
