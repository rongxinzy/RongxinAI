import React from 'react';

interface ArtifactPanelErrorBoundaryProps {
  children: React.ReactNode;
  onClose: () => void;
}

interface ArtifactPanelErrorBoundaryState {
  hasError: boolean;
}

/**
 * Keeps an artifact renderer crash (mermaid, iframe compilation, …) from
 * taking down the surrounding view; on failure the panel simply closes.
 */
export class ArtifactPanelErrorBoundary extends React.Component<
  ArtifactPanelErrorBoundaryProps,
  ArtifactPanelErrorBoundaryState
> {
  state: ArtifactPanelErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ArtifactPanelErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[ArtifactPanel] render error:', error);
    this.props.onClose();
  }

  render() {
    return this.state.hasError ? null : this.props.children;
  }
}
