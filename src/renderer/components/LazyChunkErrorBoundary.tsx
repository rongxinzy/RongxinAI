import { Button } from '@shared/components/ui/button';
import { TriangleAlert } from 'lucide-react';
import React from 'react';

import { i18nService } from '../services/i18n';

interface LazyChunkErrorBoundaryProps {
  children: React.ReactNode;
  /** Clears the error state when the value changes (e.g. selected view). */
  resetKey?: unknown;
}

interface LazyChunkErrorBoundaryState {
  hasError: boolean;
  resetKey?: unknown;
}

/**
 * Catches rejected dynamic imports (and render errors) from React.lazy
 * boundaries so a missing or corrupt chunk shows a retry affordance
 * instead of unmounting the whole UI (issue #141). React.lazy caches
 * rejected imports, so retrying reloads the window.
 */
export class LazyChunkErrorBoundary extends React.Component<
  LazyChunkErrorBoundaryProps,
  LazyChunkErrorBoundaryState
> {
  state: LazyChunkErrorBoundaryState = {
    hasError: false,
    resetKey: this.props.resetKey,
  };

  static getDerivedStateFromProps(
    props: LazyChunkErrorBoundaryProps,
    state: LazyChunkErrorBoundaryState,
  ): Partial<LazyChunkErrorBoundaryState> | null {
    if (props.resetKey !== state.resetKey) {
      return { hasError: false, resetKey: props.resetKey };
    }
    return null;
  }

  static getDerivedStateFromError(): Partial<LazyChunkErrorBoundaryState> {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    console.error('[LazyChunkErrorBoundary] failed to load view chunk:', error);
  }

  private readonly handleRetry = () => {
    window.location.reload();
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-full min-h-0 items-center justify-center">
          <Button
            type="button"
            variant="ghost"
            onClick={this.handleRetry}
            className="theme-page-lazy-chunk-error-boundary-button-1 inline-flex items-center"
          >
            <TriangleAlert className="size-4" />
            {i18nService.t('viewLoadFailedRetry')}
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
