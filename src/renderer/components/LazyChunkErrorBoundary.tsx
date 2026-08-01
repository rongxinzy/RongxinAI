import { TriangleAlert } from 'lucide-react';
import React from 'react';

import { i18nService } from '../services/i18n';

interface LazyChunkErrorBoundaryProps {
  children: React.ReactNode;
}

interface LazyChunkErrorBoundaryState {
  hasError: boolean;
}

/**
 * Catches rejected dynamic imports (and render errors) from React.lazy
 * boundaries so a missing or corrupt chunk shows a retry affordance
 * instead of unmounting the whole UI (issue #141).
 */
export class LazyChunkErrorBoundary extends React.Component<
  LazyChunkErrorBoundaryProps,
  LazyChunkErrorBoundaryState
> {
  state: LazyChunkErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): LazyChunkErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    console.error('[LazyChunkErrorBoundary] failed to load view chunk:', error);
  }

  private readonly handleRetry = () => {
    this.setState({ hasError: false });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-full min-h-0 items-center justify-center">
          <button
            type="button"
            onClick={this.handleRetry}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground"
          >
            <TriangleAlert className="size-4" />
            {i18nService.t('viewLoadFailedRetry')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
