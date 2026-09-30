import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';

import type { CodingRoomSnapshot } from '../../../shared/codingAgent';
import { reportAppError } from '../../services/appErrorText';
import { mergeCodingRoomEventDelta } from './codingEventDelta';

export function useCodingRoomSnapshot(
  workspaceRoot: string,
  selectedLaneId: string | null,
  bootstrapAttempt: number,
  onError: (error: unknown) => void,
) {
  // Identity also distinguishes A -> B -> A from the original visit to A.
  const scope = useMemo(() => ({ workspaceRoot }), [workspaceRoot]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const mounted = useRef(false);
  const [state, setState] = useState<{
    scope: typeof scope;
    snapshot: CodingRoomSnapshot | null;
  } | null>(null);
  const [failure, setFailure] = useState<{ scope: typeof scope; message: string } | null>(null);
  const snapshot = state?.scope === scope ? state.snapshot : null;
  const bootstrapError = failure?.scope === scope ? failure.message : null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const isCurrentWorkspace = useCallback(
    () => mounted.current && currentScope.current === scope,
    [scope],
  );
  const setSnapshot = useCallback(
    (update: SetStateAction<CodingRoomSnapshot | null>) => {
      if (!isCurrentWorkspace()) return;
      setState(current => {
        if (currentScope.current !== scope) return current;
        const previous = current?.scope === scope ? current.snapshot : null;
        const next = typeof update === 'function' ? update(previous) : update;
        if (next && next.room.workspaceRoot !== workspaceRoot) return current;
        return { scope, snapshot: next };
      });
    },
    [isCurrentWorkspace, scope, workspaceRoot],
  );

  useEffect(() => {
    setFailure(null);
    if (!workspaceRoot) return;
    let cancelled = false;
    const reportFailure = (error?: unknown) => {
      if (cancelled || currentScope.current !== scope) return;
      setFailure({ scope, message: reportAppError(error, 'codingAgentActionFailed') });
    };
    void window.electron.codingAgent
      .bootstrap(workspaceRoot)
      .then(result => {
        if (cancelled || currentScope.current !== scope) return;
        if (result.success && result.snapshot?.room.workspaceRoot === workspaceRoot) {
          setSnapshot(result.snapshot);
        } else reportFailure(result.error);
      })
      .catch(reportFailure);
    const unsubscribe = window.electron.codingAgent.onChanged(next => {
      if (!cancelled && next.room.workspaceRoot === workspaceRoot) setSnapshot(next);
    });
    const unsubscribeDelta = window.electron.codingAgent.onEventDelta(delta => {
      if (cancelled || delta.workspaceRoot !== workspaceRoot) return;
      setSnapshot(current => (current ? mergeCodingRoomEventDelta(current, delta) : current));
    });
    return () => {
      cancelled = true;
      unsubscribe();
      unsubscribeDelta();
    };
  }, [bootstrapAttempt, scope, setSnapshot, workspaceRoot]);

  useEffect(() => {
    if (
      !workspaceRoot ||
      !selectedLaneId ||
      !snapshot?.lanes.some(lane => lane.id === selectedLaneId) ||
      snapshot.room.activeLaneId === selectedLaneId
    )
      return;
    let cancelled = false;
    void window.electron.codingAgent
      .selectLane({ workspaceRoot, laneId: selectedLaneId })
      .then(result => {
        if (cancelled || currentScope.current !== scope) return;
        if (result.success && result.snapshot?.room.workspaceRoot === workspaceRoot) {
          setSnapshot(result.snapshot);
        } else onError(result.error);
      })
      .catch(error => {
        if (!cancelled && currentScope.current === scope) {
          onError(error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onError, scope, selectedLaneId, setSnapshot, snapshot, workspaceRoot]);

  return { snapshot, setSnapshot, bootstrapError, isCurrentWorkspace };
}
