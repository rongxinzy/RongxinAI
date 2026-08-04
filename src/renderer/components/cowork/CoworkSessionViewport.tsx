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

  // If a live streaming snapshot has already been restored for this session,
  // show it immediately instead of a blank loading spinner. This keeps the
  // stream visible when switching back to a running session.
  if (loadingSessionId === sessionId && currentSession?.id !== sessionId) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-background">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );
  }

  // Keep the detail tree mounted while switching sessions. In particular, this
  // preserves expensive document and PPT preview renderers instead of rebuilding
  // them whenever the selected session changes.
  return <CoworkSessionDetail {...props} />;
};

export default CoworkSessionViewport;
