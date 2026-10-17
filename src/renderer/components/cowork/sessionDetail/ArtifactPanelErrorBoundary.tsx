import { Button } from '@shared/components/ui/button';
import React from 'react';

/** Keeps an artifact panel render crash from taking down the whole session view. */
export class ArtifactPanelErrorBoundary extends React.Component<
  { children: React.ReactNode; onClose: () => void },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode; onClose: () => void }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error) {
    console.error('[ArtifactPanel] render error:', error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <aside className="w-[420px] shrink-0 border-l border-border-subtle bg-background flex flex-col h-full items-center justify-center p-4">
          <p className="text-sm text-destructive mb-2">Artifact panel error</p>
          <pre className="text-xs text-muted whitespace-pre-wrap max-w-full overflow-auto mb-3">
            {this.state.error?.message}
          </pre>
          <Button
            variant="secondary"
            size="xs"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              this.props.onClose();
            }}
          >
            Close
          </Button>
        </aside>
      );
    }
    return this.props.children;
  }
}
