import { useSelector } from 'react-redux';

import { selectPanelWidth } from '@/store/slices/artifactSlice';

import { ARTIFACT_PANEL_RESIZE_HANDLE_WIDTH } from './artifactPanelResize';

/**
 * Suspense fallback for the lazily loaded artifact panel frame. Matches
 * the real frame's fixed width so opening the panel does not snap the
 * chat layout while the chunk loads.
 */
export const ArtifactPanelFallback: React.FC = () => {
  const panelWidth = useSelector(selectPanelWidth);
  return (
    <div
      className="h-full shrink-0 animate-pulse bg-muted/30"
      style={{ width: panelWidth + ARTIFACT_PANEL_RESIZE_HANDLE_WIDTH }}
    />
  );
};
