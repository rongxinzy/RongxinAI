import type { ComponentProps } from 'react';
import React from 'react';
import { useSelector } from 'react-redux';

import {
  selectCurrentSession,
  selectLoadingSessionId,
} from '../../store/selectors/coworkSelectors';
import { CoworkSessionColdStartSkeleton } from './CoworkSessionLoadingState';

// Session transcript pulls Streamdown / tool cards; keep it out of the empty home chunk.
const loadCoworkSessionDetail = () => import('./CoworkSessionDetail');
// Preload the session detail chunk when Cowork viewport module initializes so the
// first message submission does not flash or whiteout waiting on a cold dynamic import.
const coworkSessionDetailPromise = loadCoworkSessionDetail();
const CoworkSessionDetail = React.lazy(() => coworkSessionDetailPromise);

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
    <div className="flex min-h-0 flex-1 bg-background">
      <React.Suspense fallback={<CoworkSessionColdStartSkeleton />}>
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
