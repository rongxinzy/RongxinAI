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

function useDraft({
  draftKey,
  draftPrompt,
  draftDoc = null,
}: {
  draftKey: string;
  draftPrompt: string;
  draftDoc?: Record<string, unknown> | null;
}) {
  const [value, setValue] = useState(draftPrompt);
  const [doc, setDoc] = useState<Record<string, unknown> | null>(draftDoc);
  const actions = usePromptDraftSync({
    draftKey,
    draftPrompt,
    draftDoc,
    value,
    doc,
    setValue,
    setDraftState: (nextValue, nextDoc) => {
      setValue(nextValue);
      setDoc(nextDoc);
    },
    attachments: [],
    modelSupportsImage: true,
    setImageVisionHint: () => {},
  });
  return { value, doc, setValue, setDoc, ...actions };
}

test('switching a persistent editor flushes the previous un-debounced draft to its own key', () => {
  const { result, rerender } = renderHook(useDraft, {
    initialProps: { draftKey: 'session-a', draftPrompt: '' },
  });
  act(() => result.current.setValue('unsaved last keystrokes'));
  rerender({ draftKey: 'session-b', draftPrompt: 'other draft' });
  expect(dispatch).toHaveBeenCalledWith(
    setDraftPrompt({ sessionId: 'session-a', draft: 'unsaved last keystrokes', doc: null }),
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
    setDraftPrompt({ sessionId: 'real-session', draft: 'next turn draft', doc: null }),
  );
});

test('persists and restores Tiptap JSON mention attributes across session switches', () => {
  const richDoc: Record<string, unknown> = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'mention',
            attrs: { id: '/work/src/a.ts', label: 'a.ts', kind: 'file', path: '/work/src/a.ts' },
          },
          { type: 'text', text: ' check this' },
        ],
      },
    ],
  };

  const { result, rerender } = renderHook(useDraft, {
    initialProps: {
      draftKey: 'session-a',
      draftPrompt: '',
      draftDoc: null as Record<string, unknown> | null,
    },
  });
  act(() => {
    result.current.setValue('@a.ts check this');
    result.current.setDoc(richDoc);
  });

  rerender({ draftKey: 'session-b', draftPrompt: 'other draft', draftDoc: null });
  expect(dispatch).toHaveBeenCalledWith(
    setDraftPrompt({ sessionId: 'session-a', draft: '@a.ts check this', doc: richDoc }),
  );
  expect(result.current.doc).toBeNull();

  rerender({ draftKey: 'session-a', draftPrompt: '@a.ts check this', draftDoc: richDoc });
  expect(result.current.doc).toEqual(richDoc);
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
