import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';

import {
  activateSessionArtifactView,
  DEFAULT_PANEL_WIDTH,
  MIN_PANEL_WIDTH,
} from '../../../store/slices/artifactSlice';
import { resolveArtifactPanelMaxWidth } from '../../artifacts/artifactPanelResize';

const ARTIFACT_PANEL_TRANSITION_MS = 200;

interface UseArtifactPanelPresentationOptions {
  isPanelOpen: boolean;
  sessionId: string | undefined;
  contentRowRef: React.RefObject<HTMLDivElement | null>;
}

export interface ArtifactPanelPresentation {
  shouldRenderArtifactPanel: boolean;
  isArtifactPanelVisible: boolean;
  isArtifactPanelTransitioning: boolean;
  previewSessionId: string | null;
  artifactPanelMaxWidth: number;
}

/**
 * Mount/visibility/sizing state for the session artifact panel:
 * - open/close transitions (mount stays until the close transition ends),
 * - skip-animation session switches,
 * - the max-width clamp driven by the content row's live width,
 * - the session the currently mounted panel preview belongs to.
 */
export const useArtifactPanelPresentation = ({
  isPanelOpen,
  sessionId,
  contentRowRef,
}: UseArtifactPanelPresentationOptions): ArtifactPanelPresentation => {
  const dispatch = useDispatch();

  const [shouldRenderArtifactPanel, setShouldRenderArtifactPanel] = useState(isPanelOpen);
  const [isArtifactPanelVisible, setIsArtifactPanelVisible] = useState(isPanelOpen);
  const [isArtifactPanelTransitioning, setIsArtifactPanelTransitioning] = useState(false);
  const [previewSessionId, setPreviewSessionId] = useState<string | null>(() =>
    isPanelOpen ? (sessionId ?? null) : null,
  );
  const [artifactPanelMaxWidth, setArtifactPanelMaxWidth] = useState(() =>
    typeof window === 'undefined'
      ? DEFAULT_PANEL_WIDTH
      : resolveArtifactPanelMaxWidth(Math.max(MIN_PANEL_WIDTH, window.innerWidth), MIN_PANEL_WIDTH),
  );
  const previousArtifactPanelOpenRef = useRef(isPanelOpen);
  const previousArtifactSessionIdRef = useRef(sessionId);
  const skipArtifactPanelTransitionRef = useRef(false);

  useEffect(() => {
    let animationFrame: number | undefined;
    let transitionTimeout: number | undefined;
    const wasOpen = previousArtifactPanelOpenRef.current;

    previousArtifactPanelOpenRef.current = isPanelOpen;

    if (skipArtifactPanelTransitionRef.current) {
      skipArtifactPanelTransitionRef.current = false;
      setShouldRenderArtifactPanel(isPanelOpen);
      setIsArtifactPanelVisible(isPanelOpen);
      setIsArtifactPanelTransitioning(false);
      return undefined;
    }

    if (wasOpen === isPanelOpen) {
      return undefined;
    }

    if (isPanelOpen) {
      setShouldRenderArtifactPanel(true);
      setIsArtifactPanelVisible(false);
      setIsArtifactPanelTransitioning(true);
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = window.requestAnimationFrame(() => {
          setIsArtifactPanelVisible(true);
          transitionTimeout = window.setTimeout(() => {
            setIsArtifactPanelTransitioning(false);
          }, ARTIFACT_PANEL_TRANSITION_MS);
        });
      });
    } else {
      setIsArtifactPanelTransitioning(true);
      setIsArtifactPanelVisible(false);
      transitionTimeout = window.setTimeout(() => {
        setShouldRenderArtifactPanel(false);
        setPreviewSessionId(null);
        setIsArtifactPanelTransitioning(false);
      }, ARTIFACT_PANEL_TRANSITION_MS);
    }

    return () => {
      if (animationFrame !== undefined) {
        window.cancelAnimationFrame(animationFrame);
      }
      if (transitionTimeout !== undefined) {
        window.clearTimeout(transitionTimeout);
      }
    };
  }, [isPanelOpen]);

  const updateArtifactPanelMaxWidth = useCallback(() => {
    const contentWidth = contentRowRef.current?.clientWidth ?? 0;
    if (contentWidth <= 0) return;
    const nextMaxWidth = resolveArtifactPanelMaxWidth(contentWidth, MIN_PANEL_WIDTH);
    setArtifactPanelMaxWidth(prev => (prev === nextMaxWidth ? prev : nextMaxWidth));
  }, [contentRowRef]);

  // ResizeObserver must run in useEffect (async), NOT useLayoutEffect:
  // useLayoutEffect flushes state updates synchronously — when the observed
  // container resizes as a result of our own setState, the observer fires
  // again before paint, forming a sync setState → DOM → observer → setState
  // cycle that exhausts React's nested update limit.
  useEffect(() => {
    updateArtifactPanelMaxWidth();
    const container = contentRowRef.current;

    const resizeObserver = new ResizeObserver(updateArtifactPanelMaxWidth);
    if (container) {
      resizeObserver.observe(container);
    }
    return () => {
      resizeObserver.disconnect();
    };
  }, [sessionId, updateArtifactPanelMaxWidth]);

  useLayoutEffect(() => {
    if (
      previousArtifactSessionIdRef.current &&
      previousArtifactSessionIdRef.current !== sessionId
    ) {
      skipArtifactPanelTransitionRef.current = true;
    }
    previousArtifactSessionIdRef.current = sessionId;
    dispatch(activateSessionArtifactView(sessionId ?? null));
  }, [sessionId, dispatch]);

  useLayoutEffect(() => {
    if (isPanelOpen && sessionId) {
      setPreviewSessionId(sessionId);
    }
  }, [isPanelOpen, sessionId]);

  return {
    shouldRenderArtifactPanel,
    isArtifactPanelVisible,
    isArtifactPanelTransitioning,
    previewSessionId,
    artifactPanelMaxWidth,
  };
};
