import React from 'react';
import { Skeleton } from '@shared/components/ui/skeleton';
import type { Artifact } from '../../types/artifact';

const CodeRenderer = React.lazy(() => import('./renderers/CodeRenderer'));

export function ArtifactSourcePreview({ artifact }: { artifact: Artifact }) {
  return (
    <React.Suspense
      fallback={
        <div className="h-full min-h-0 p-4" aria-busy="true">
          <Skeleton className="theme-scene-preview-loading h-full w-full" />
        </div>
      }
    >
      <CodeRenderer artifact={artifact} />
    </React.Suspense>
  );
}
