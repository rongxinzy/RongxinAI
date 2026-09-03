import { cn } from '@shared/lib/utils';
import React, { memo, useCallback, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import {
  selectPanelWidth,
  setPanelWidth,
  ArtifactLayoutMode,
} from '@/store/slices/artifactSlice';
import type { Artifact } from '@/types/artifact';

import ArtifactPanel from './ArtifactPanel';
import { clampArtifactPanelWidth } from './artifactPanelResize';

interface ArtifactPanelFrameProps {
  sessionId: string | null;
  cwd?: string | null;
  artifacts: Artifact[];
  isOpen: boolean;
  isVisible: boolean;
  isTransitioning: boolean;
  layoutMode: ArtifactLayoutMode;
  minPanelWidth: number;
  maxPanelWidth: number;
}

const ArtifactPanelFrame: React.FC<ArtifactPanelFrameProps> = ({
  sessionId,
  cwd,
  artifacts,
  isOpen,
  isVisible,
  isTransitioning,
  layoutMode,
  minPanelWidth,
  maxPanelWidth,
}) => {
  const dispatch = useDispatch();
  const storedPanelWidth = useSelector(selectPanelWidth);
  const frameRef = useRef<HTMLDivElement>(null);
  const transientPanelWidthRef = useRef<number | null>(null);
  const panelWidth = clampArtifactPanelWidth(storedPanelWidth, minPanelWidth, maxPanelWidth);
  const isWorkspace = layoutMode === ArtifactLayoutMode.Workspace;

  const applyFrameWidth = useCallback(
    (width: number) => {
      const nextWidth = clampArtifactPanelWidth(width, minPanelWidth, maxPanelWidth);
      transientPanelWidthRef.current = nextWidth;
      if (frameRef.current) {
        frameRef.current.style.width = `${nextWidth}px`;
      }
    },
    [maxPanelWidth, minPanelWidth],
  );

  const completeResize = useCallback(
    (width: number) => {
      const nextWidth = clampArtifactPanelWidth(width, minPanelWidth, maxPanelWidth);
      // Dragging never auto-enters the workspace layout: the conversation
      // column must keep its space. Workspace stays available through its
      // explicit toggle (and Escape to leave).
      dispatch(setPanelWidth(nextWidth));
      transientPanelWidthRef.current = null;
    },
    [dispatch, maxPanelWidth, minPanelWidth],
  );

  const renderedFrameWidth = transientPanelWidthRef.current ?? panelWidth;
  const frameStyle: React.CSSProperties = {
    width: isWorkspace ? '100%' : isVisible ? renderedFrameWidth : 0,
    maxWidth: isWorkspace ? 'none' : maxPanelWidth,
  };

  return (
    <div
      ref={frameRef}
      aria-hidden={!isOpen}
      data-artifact-panel-frame=""
      className={cn(
        'h-full overflow-hidden',
        isWorkspace ? 'flex-1' : 'shrink-0',
        isTransitioning &&
          'transition-[width,opacity] duration-200 ease-out motion-reduce:transition-none',
        isVisible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
      style={frameStyle}
    >
      <div className="relative flex h-full w-full">
        <ArtifactPanel
          sessionId={sessionId}
          cwd={cwd}
          artifacts={artifacts}
          panelWidth={panelWidth}
          minPanelWidth={minPanelWidth}
          maxPanelWidth={maxPanelWidth}
          onResizeFrame={applyFrameWidth}
          onResizeComplete={completeResize}
        />
      </div>
    </div>
  );
};

export default memo(ArtifactPanelFrame);
