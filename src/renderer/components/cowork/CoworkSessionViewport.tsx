import type { ComponentProps } from 'react';
import { useSelector } from 'react-redux';

import {
  selectCurrentSession,
  selectLoadingSessionId,
} from '../../store/selectors/coworkSelectors';
import CoworkSessionDetail from './CoworkSessionDetail';
import { CoworkSessionColdStartSkeleton } from './CoworkSessionLoadingState';

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
      <CoworkSessionDetail
        {...props}
        displayedSessionId={sessionId}
        isSessionSwitching={isWaitingForTargetSession}
      />
    </div>
  );
};

export default CoworkSessionViewport;
