import { useEffect, useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';

import type { CoworkPersistedArtifact } from '../../../../shared/cowork/artifacts';
import { prepareAvailableArtifacts } from '../../../services/artifactAvailability';
import { addArtifact } from '../../../store/slices/artifactSlice';
import type { Artifact } from '../../../types/artifact';

/** Reserves known card geometry while the existing availability gate resolves. */
export const usePersistedArtifactSeed = (
  sessionId: string | undefined,
  persisted: CoworkPersistedArtifact[] | undefined,
  cwd: string | undefined,
  existing: Artifact[],
): Artifact[] => {
  const dispatch = useDispatch();
  const batch = useMemo(() => ({ sessionId, persisted, cwd }), [sessionId, persisted, cwd]);
  const [resolvedBatch, setResolvedBatch] = useState<typeof batch | null>(null);
  const candidates = useMemo(
    () => (sessionId ? (persisted ?? []).map(artifact => ({ ...artifact, sessionId })) : []),
    [sessionId, persisted],
  );

  useEffect(() => {
    if (!batch.sessionId || !batch.persisted?.length) return;
    const targetSessionId = batch.sessionId;
    const existingIds = new Set(existing.map(artifact => artifact.id));
    let cancelled = false;
    void prepareAvailableArtifacts(
      candidates
        .filter(artifact => !existingIds.has(artifact.id))
        .map(artifact => ({ artifact, needsFileLoad: Boolean(artifact.filePath) })),
      false,
      batch.cwd,
    ).then(available => {
      if (cancelled) return;
      available.forEach(({ artifact }) =>
        dispatch(addArtifact({ sessionId: targetSessionId, artifact })),
      );
      setResolvedBatch(batch);
    });
    return () => {
      cancelled = true;
    };
    // Store insertions must not restart the in-flight batch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch, candidates, dispatch]);

  return useMemo(() => {
    if (resolvedBatch === batch) return [];
    const existingIds = new Set(existing.map(artifact => artifact.id));
    return candidates.filter(artifact => !existingIds.has(artifact.id));
  }, [batch, candidates, existing, resolvedBatch]);
};
