// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { usePromptDraftSync } from './usePromptDraftSync';
import { setDraftPrompt } from '../../../store/slices/coworkSlice';

const dispatch = vi.hoisted(() => vi.fn());
vi.mock('react-redux', () => ({ useDispatch: () => dispatch }));
beforeEach(() => {
  vi.useFakeTimers();
  dispatch.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function useDraft({ draftKey, draftPrompt }: { draftKey: string; draftPrompt: string }) {
  const [value, setValue] = useState(draftPrompt);
  const actions = usePromptDraftSync({
    draftKey,
    draftPrompt,
    value,
    setValue,
    attachments: [],
    modelSupportsImage: true,
    setImageVisionHint: () => {},
  });
  return { value, setValue, ...actions };
}

test('switching a persistent editor flushes the previous un-debounced draft to its own key', () => {
  const { result, rerender } = renderHook(useDraft, {
    initialProps: { draftKey: 'session-a', draftPrompt: '' },
  });
  act(() => result.current.setValue('unsaved last keystrokes'));
  rerender({ draftKey: 'session-b', draftPrompt: 'other draft' });
  expect(dispatch).toHaveBeenCalledWith(
    setDraftPrompt({ sessionId: 'session-a', draft: 'unsaved last keystrokes' }),
  );
  expect(result.current.value).toBe('other draft');
});

test('temporary session promotion preserves the next input under the real session key', () => {
  const { result, rerender } = renderHook(useDraft, {
    initialProps: { draftKey: 'temp-session', draftPrompt: '' },
  });
  act(() => result.current.setValue('next turn draft'));
  rerender({ draftKey: 'real-session', draftPrompt: '' });
  expect(result.current.value).toBe('next turn draft');
  expect(dispatch).toHaveBeenCalledWith(
    setDraftPrompt({ sessionId: 'real-session', draft: 'next turn draft' }),
  );
});

test('submitted home text cannot return when the persistent editor becomes a session composer', () => {
  const { result, rerender } = renderHook(useDraft, {
    initialProps: { draftKey: '__home__', draftPrompt: 'submitted prompt' },
  });
  act(() => {
    result.current.markDraftCleared();
    result.current.setValue('');
  });
  rerender({ draftKey: 'temp-session', draftPrompt: '' });
  expect(result.current.value).toBe('');
  expect(dispatch).not.toHaveBeenCalledWith(
    setDraftPrompt({ sessionId: '__home__', draft: 'submitted prompt' }),
  );
});
