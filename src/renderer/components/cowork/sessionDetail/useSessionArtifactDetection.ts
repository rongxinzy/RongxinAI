import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';

import { prepareAvailableArtifacts } from '../../../services/artifactAvailability';
import { detectArtifactsFromMessages } from '../../../services/artifactParser';
import type { DetectedArtifact } from '../../../services/artifactParser';
import { ArtifactDetectionService } from '../../../services/artifactDetectionService';
import { addArtifact } from '../../../store/slices/artifactSlice';
import type { CoworkSession } from '../../../types/cowork';

interface UseSessionArtifactDetectionOptions {
  sessionId: string | undefined;
  currentSession: CoworkSession | null;
  isStreaming: boolean;
  messagesLength: number;
}

/**
 * Watches a session's messages for declared artifacts and lands them in the
 * artifact store:
 * - a synchronous first-paint pass for inline artifacts,
 * - an async Web Worker pass (with readability probing) for file candidates,
 * - ordered batch delivery so "newest deliverable wins" never races.
 */
export const useSessionArtifactDetection = ({
  sessionId,
  currentSession,
  isStreaming,
  messagesLength,
}: UseSessionArtifactDetectionOptions): void => {
  const dispatch = useDispatch();

  const artifactDetectionServiceRef = useRef<ArtifactDetectionService | null>(null);
  // Whether this session produced anything while we were watching it. Revealing the
  // artifact panel is a live-delivery signal: opening an old session must not pop
  // the panel for artifacts it already had.
  const liveRunRef = useRef(false);
  const isStreamingRef = useRef(isStreaming);
  const detectionQueueRef = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    isStreamingRef.current = isStreaming;
    // Sticky on purpose: detection runs once the run has settled, so liveness has
    // to outlive the streaming flag.
    if (isStreaming) liveRunRef.current = true;
  }, [isStreaming]);
  // A session that is already streaming has no transition to observe, so liveness
  // follows the current streaming state on every session switch.
  useEffect(() => {
    liveRunRef.current = isStreamingRef.current;
  }, [sessionId]);

  // Adds a detection batch, revealing only the artifacts the agent declared as
  // deliverables during a live run and whose file is actually readable. The
  // readability probe runs for the whole batch before anything is dispatched, so
  // insertion order (and therefore "newest deliverable wins") never depends on
  // which file happened to be read first.
  const addDetectedArtifacts = useCallback(
    async (detected: DetectedArtifact[]) => {
      const targetSessionId = sessionId;
      if (!targetSessionId) return;

      const available = await prepareAvailableArtifacts(
        detected,
        liveRunRef.current,
        currentSession?.cwd,
      );

      available.forEach(({ artifact, reveal }) => {
        dispatch(addArtifact({ sessionId: targetSessionId, artifact, reveal }));
      });
    },
    [dispatch, sessionId, currentSession?.cwd],
  );

  // Initialize/replace artifact detection service when session changes
  useEffect(() => {
    if (!sessionId) {
      artifactDetectionServiceRef.current?.terminate();
      artifactDetectionServiceRef.current = null;
      return undefined;
    }

    const service = new ArtifactDetectionService(detected => {
      // Batches must land in detection order: a slow readability probe in an older
      // batch must not settle the selection after a newer batch was added.
      detectionQueueRef.current = detectionQueueRef.current
        .then(() => addDetectedArtifacts(detected))
        .catch(error => {
          console.error('[ArtifactDetection] failed to add detected artifacts:', error);
        });
    });
    artifactDetectionServiceRef.current = service;

    return () => {
      service.terminate();
    };
  }, [sessionId, dispatch, addDetectedArtifacts]);

  // Synchronous artifact detection on session mount so artifact cards
  // appear in the first-paint frame instead of popping in after the async
  // Web Worker pass completes (which would change turn heights and jank).
  useLayoutEffect(() => {
    if (!sessionId || !currentSession?.messages?.length) return;
    if (isStreaming) return;

    const detected = detectArtifactsFromMessages(currentSession.messages, sessionId);
    if (detected.length > 0) {
      for (const { artifact } of detected) {
        // Inline content is immediately available; file candidates use the validated worker batch.
        if (artifact.filePath) continue;
        dispatch(addArtifact({ sessionId, artifact }));
      }
      // The async useEffect pass below will also call processMessages.
      // addArtifact is idempotent (merges by id / filePath).
    }
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sessionId || !currentSession?.messages?.length) return;
    if (isStreaming) return;

    const service = artifactDetectionServiceRef.current;
    if (!service) return;

    service.processMessages(currentSession.messages, sessionId).catch(err => {
      console.error('[ArtifactDetection] failed:', err);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- message count and updatedAt cover message additions and content updates
  }, [sessionId, messagesLength, currentSession?.updatedAt, isStreaming]);
};
