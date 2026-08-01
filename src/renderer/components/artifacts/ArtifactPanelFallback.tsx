import { useSelector } from 'react-redux';

import { ArtifactLayoutMode, selectPanelWidth } from '@/store/slices/artifactSlice';

import {
  ARTIFACT_PANEL_RESIZE_HANDLE_WIDTH,
  clampArtifactPanelWidth,
} from './artifactPanelResize';

interface ArtifactPanelFallbackProps {
  layoutMode: ArtifactLayoutMode;
  minPanelWidth: number;
  maxPanelWidth: number;
}

/**
 * Suspense fallback for the lazily loaded artifact panel frame. Matches
 * the real frame's layout (workspace full-width, otherwise the clamped
 * stored width) so opening the panel does not snap the chat layout while
 * the chunk loads.
 */
export const ArtifactPanelFallback: React.FC<ArtifactPanelFallbackProps> = ({
  layoutMode,
  minPanelWidth,
  maxPanelWidth,
}) => {
  const storedWidth = useSelector(selectPanelWidth);
  const isWorkspace = layoutMode === ArtifactLayoutMode.Workspace;
  const width = isWorkspace
    ? '100%'
    : clampArtifactPanelWidth(storedWidth, minPanelWidth, maxPanelWidth) +
      ARTIFACT_PANEL_RESIZE_HANDLE_WIDTH;
  return (
    <div
      className={`h-full animate-pulse bg-muted/30 ${isWorkspace ? 'flex-1' : 'shrink-0'}`}
      style={{ width }}
    />
  );
};
