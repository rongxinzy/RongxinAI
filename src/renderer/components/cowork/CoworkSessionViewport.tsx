import type { ComponentProps } from 'react';
import React from 'react';
import { useSelector } from 'react-redux';

import { Skeleton } from '@shared/components/ui/skeleton';

import {
  selectCurrentSession,
  selectLoadingSessionId,
} from '../../store/selectors/coworkSelectors';
import { CoworkSessionColdStartSkeleton } from './CoworkSessionLoadingState';

// Session transcript pulls Streamdown / tool cards; keep it out of the empty home chunk.
const CoworkSessionDetail = React.lazy(() => import('./CoworkSessionDetail'));

const sessionDetailFallback = (
  <div className="flex min-h-0 flex-1 flex-col gap-3 p-6" aria-busy="true">
    <Skeleton className="h-10 w-48" />
    <Skeleton className="h-28 w-full" />
    <Skeleton className="h-28 w-full" />
  </div>
);

type CoworkSessionViewportProps = Omit<
  ComponentProps<typeof CoworkSessionDetail>,
  'displayedSessionId' | 'isSessionSwitching'
> & {
  sessionId: string;
};

const CoworkSessionViewport = ({ sessionId, ...props }: CoworkSessionViewportProps) => {
  const loadingSessionId = useSelector(selectLoadingSessionId);
  const currentSession = useSelector(selectCurrentSession);
  const isLoadingTargetSession = loadingSessionId === sessionId;
  const isWaitingForTargetSession = isLoadingTargetSession && currentSession?.id !== sessionId;

  if (isWaitingForTargetSession && !currentSession) {
    return <CoworkSessionColdStartSkeleton />;
  }

  return (
    <div className="flex min-h-0 flex-1">
      <React.Suspense fallback={sessionDetailFallback}>
        <CoworkSessionDetail
          {...props}
          displayedSessionId={sessionId}
          isSessionSwitching={isWaitingForTargetSession}
        />
      </React.Suspense>
    </div>
  );
};

export default CoworkSessionViewport;
