import { useEffect } from 'react';
import { useDispatch } from 'react-redux';

import { addArtifact } from '../../store/slices/artifactSlice';

/**
 * Folds a scope's ledger rows (a coding lane) into the artifact store once per
 * scope. Silent and idempotent: rows the live `artifact:upsert` subscription
 * already landed merge onto themselves, and history never opens the panel.
 */
export const useLedgerArtifacts = (scopeId: string | null): void => {
  const dispatch = useDispatch();

  useEffect(() => {
    const list = window.electron?.artifacts?.list;
    if (!scopeId || typeof list !== 'function') return;
    let cancelled = false;
    void list(scopeId)
      .then(result => {
        if (cancelled) return;
        if (!result.success) {
          if (result.error) console.error('[CodingArtifacts] ledger read failed:', result.error);
          return;
        }
        for (const artifact of result.artifacts ?? []) {
          dispatch(
            addArtifact({ sessionId: scopeId, artifact: { ...artifact, sessionId: scopeId } }),
          );
        }
      })
      .catch(error => {
        if (!cancelled) console.error('[CodingArtifacts] ledger read failed:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [scopeId, dispatch]);
};
