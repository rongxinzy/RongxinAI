import React from 'react';

import { ArtifactPanelFallback } from '../../artifacts/ArtifactPanelFallback';
import { ArtifactLayoutMode } from '../../../store/slices/artifactSlice';
import type { Artifact } from '../../../types/artifact';
import { ArtifactPanelErrorBoundary } from './ArtifactPanelErrorBoundary';

// The artifact panel only mounts when the user opens it, so keep its code
// (and the whole renderers tree behind it) out of the cowork startup chunk.
const ArtifactPanelFrame = React.lazy(() =>
  import('../../artifacts').then(module => ({ default: module.ArtifactPanelFrame })),
);

interface SessionArtifactPanelRegionProps {
  sessionId: string | null;
  cwd: string | undefined;
  artifacts: Artifact[];
  isOpen: boolean;
  isVisible: boolean;
  isTransitioning: boolean;
  layoutMode: ArtifactLayoutMode;
  minPanelWidth: number;
  maxPanelWidth: number;
  onClose: () => void;
}

/** The artifact panel column: error boundary, suspense fallback and lazy frame. */
export const SessionArtifactPanelRegion: React.FC<SessionArtifactPanelRegionProps> = ({
  sessionId,
  cwd,
  artifacts,
  isOpen,
  isVisible,
  isTransitioning,
  layoutMode,
  minPanelWidth,
  maxPanelWidth,
  onClose,
}) => {
  return (
    <ArtifactPanelErrorBoundary onClose={onClose}>
      <React.Suspense
        fallback={
          <ArtifactPanelFallback
            layoutMode={layoutMode}
            minPanelWidth={minPanelWidth}
            maxPanelWidth={maxPanelWidth}
          />
        }
      >
        <ArtifactPanelFrame
          sessionId={sessionId}
          cwd={cwd}
          artifacts={artifacts}
          isOpen={isOpen}
          isVisible={isVisible}
          isTransitioning={isTransitioning}
          layoutMode={layoutMode}
          minPanelWidth={minPanelWidth}
          maxPanelWidth={maxPanelWidth}
        />
      </React.Suspense>
    </ArtifactPanelErrorBoundary>
  );
};
