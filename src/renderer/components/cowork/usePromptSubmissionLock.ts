import { useCallback, useRef } from 'react';

/** React state is too late to guard two submits delivered before the next render. */
export function usePromptSubmissionLock(submit: () => Promise<void>): () => Promise<void> {
  const submitting = useRef(false);
  return useCallback(async () => {
    if (submitting.current) return;
    submitting.current = true;
    try {
      await submit();
    } finally {
      submitting.current = false;
    }
  }, [submit]);
}
