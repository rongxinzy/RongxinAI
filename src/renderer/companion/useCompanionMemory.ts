import { useCallback, useEffect, useRef, useState } from 'react';
import type { CompanionWindowApi } from '../../shared/companion/types';
import { MemoryLifecycleStatus, type ManagedMemoryRecord } from '../../shared/memory';

export function useCompanionMemory(
  api: CompanionWindowApi | undefined,
  petId: string,
  open: boolean,
) {
  const [records, setRecords] = useState<ManagedMemoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);
  const writing = useRef(false);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    try {
      if (!api) throw new Error('Companion bridge unavailable.');
      const result = await api.listMemories(petId);
      if (current !== generation.current) return;
      setRecords(
        result.filter(
          record =>
            record.status === MemoryLifecycleStatus.Active ||
            record.status === MemoryLifecycleStatus.NeedsReview,
        ),
      );
      setError(null);
    } catch {
      if (current === generation.current) setError('companionMemoryLoadFailed');
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [api, petId]);
  useEffect(() => {
    if (!open) return;
    void load();
    return () => {
      generation.current++;
    };
  }, [open, load]);
  const run = async (operation: () => Promise<void>): Promise<boolean> => {
    if (writing.current || !api) return false;
    writing.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await operation();
      await load();
      return true;
    } catch {
      setError('companionMemorySaveFailed');
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };
  return { records, loading, busy, error, notice, run, reload: load, setNotice };
}
