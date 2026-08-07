import { Spinner } from '@shared/components/ui/spinner';
import type { ComponentProps } from 'react';
import { useSelector } from 'react-redux';

import {
  selectCurrentSession,
  selectLoadingSessionId,
} from '../../store/selectors/coworkSelectors';
import CoworkSessionDetail from './CoworkSessionDetail';

type CoworkSessionViewportProps = ComponentProps<typeof CoworkSessionDetail> & {
  sessionId: string;
};

const CoworkSessionViewport = ({ sessionId, ...props }: CoworkSessionViewportProps) => {
  const loadingSessionId = useSelector(selectLoadingSessionId);
  const currentSession = useSelector(selectCurrentSession);
  const isLoadingTargetSession = loadingSessionId === sessionId;

  // Keep the current detail tree mounted until the target session is ready.
  // Replacing it during the async load creates a blank frame and throws away
  // the measured virtual-list state that can still be displayed safely.
  if (isLoadingTargetSession && !currentSession) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-background">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );
  }

  const isShowingPreviousSession = isLoadingTargetSession && currentSession?.id !== sessionId;

  return (
    <div className="flex min-h-0 flex-1" aria-busy={isShowingPreviousSession}>
      <div className="flex min-h-0 flex-1" inert={isShowingPreviousSession}>
        <CoworkSessionDetail {...props} />
      </div>
    </div>
  );
};

export default CoworkSessionViewport;
