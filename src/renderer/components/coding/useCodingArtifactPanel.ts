import { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import type { RootState } from '../../store';
import {
  activateSessionArtifactView,
  closePanel,
  EMPTY_ARTIFACTS,
  MIN_PANEL_WIDTH,
  selectIsSessionArtifactPanelOpen,
  selectSessionArtifactLayoutMode,
  selectSessionArtifacts,
} from '../../store/slices/artifactSlice';
import { resolveArtifactPanelMaxWidth } from '../artifacts/artifactPanelResize';

/**
 * Wires the lane into the cowork artifact store: artifacts detected in coding
 * conversations are keyed by lane id; the lane's view is activated whenever
 * the selection changes, and the panel width tracks the conversation row.
 */
export function useCodingArtifactPanel(activeLaneId: string | null) {
  const dispatch = useDispatch();
  const artifactSessionKey = activeLaneId;
  const laneArtifacts = useSelector((state: RootState) =>
    artifactSessionKey ? selectSessionArtifacts(state, artifactSessionKey) : EMPTY_ARTIFACTS,
  );
  const isArtifactPanelOpen = useSelector((state: RootState) =>
    selectIsSessionArtifactPanelOpen(state, artifactSessionKey ?? undefined),
  );
  const artifactLayoutMode = useSelector((state: RootState) =>
    selectSessionArtifactLayoutMode(state, artifactSessionKey ?? undefined),
  );
  useEffect(() => {
    dispatch(activateSessionArtifactView(artifactSessionKey));
  }, [artifactSessionKey, dispatch]);
  const artifactRowRef = useRef<HTMLDivElement | null>(null);
  const [artifactPanelMaxWidth, setArtifactPanelMaxWidth] = useState(() =>
    typeof window === 'undefined'
      ? MIN_PANEL_WIDTH
      : resolveArtifactPanelMaxWidth(Math.max(MIN_PANEL_WIDTH, window.innerWidth), MIN_PANEL_WIDTH),
  );
  const updateArtifactPanelMaxWidth = useCallback(() => {
    const contentWidth = artifactRowRef.current?.clientWidth ?? 0;
    if (contentWidth <= 0) return;
    const nextMaxWidth = resolveArtifactPanelMaxWidth(contentWidth, MIN_PANEL_WIDTH);
    setArtifactPanelMaxWidth(prev => (prev === nextMaxWidth ? prev : nextMaxWidth));
  }, []);
  // ResizeObserver must run in useEffect, not useLayoutEffect: a layout-effect
  // setState triggered by our own resize feedback loops into React's nested
  // update limit.
  useEffect(() => {
    updateArtifactPanelMaxWidth();
    const container = artifactRowRef.current;
    const resizeObserver = new ResizeObserver(updateArtifactPanelMaxWidth);
    if (container) resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [activeLaneId, updateArtifactPanelMaxWidth]);
  const closeArtifactPanel = useCallback(() => dispatch(closePanel()), [dispatch]);
  return {
    artifactLayoutMode,
    artifactPanelMaxWidth,
    artifactRowRef,
    artifactSessionKey,
    closeArtifactPanel,
    isArtifactPanelOpen,
    laneArtifacts,
  };
}
