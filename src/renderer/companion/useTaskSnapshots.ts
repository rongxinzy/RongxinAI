import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import type { CompanionTaskSnapshot } from '../../shared/companion/tasks';
import type { CompanionWindowState } from '../../shared/companion/types';

/** Cache events even before bootstrap finishes; an older reply cannot replace newer facts. */
export function useTaskSnapshots(setState: Dispatch<SetStateAction<CompanionWindowState | null>>) {
  const snapshots = useRef(new Map<string, CompanionTaskSnapshot>());
  const remember = useCallback((snapshot: CompanionTaskSnapshot) => {
    const current = snapshots.current.get(snapshot.petId);
    if (current && current.revision >= snapshot.revision) return current;
    snapshots.current.set(snapshot.petId, snapshot);
    if (snapshots.current.size > 32)
      snapshots.current.delete(snapshots.current.keys().next().value!);
    return snapshot;
  }, []);
  const update = useCallback(
    (snapshot: CompanionTaskSnapshot) => {
      const latest = remember(snapshot);
      setState(current =>
        current && current.activePetId === latest.petId && current.taskRevision < latest.revision
          ? { ...current, tasks: latest.tasks, taskRevision: latest.revision }
          : current,
      );
    },
    [remember, setState],
  );
  return { remember, update };
}
