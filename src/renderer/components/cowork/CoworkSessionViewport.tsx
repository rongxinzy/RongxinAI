import { Skeleton } from '@shared/components/ui/skeleton';
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

const CoworkSessionLoadingSkeleton = () => (
  <div className="flex min-h-0 flex-1 flex-col bg-background" role="status" aria-busy="true">
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="size-8" />
    </div>

    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-end gap-6 px-8 py-6">
        <div className="flex justify-end">
          <Skeleton className="h-16 w-2/3 rounded-lg" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>

      <div className="shrink-0 px-4 pb-4">
        <Skeleton className="mx-auto h-24 w-full max-w-5xl rounded-xl" />
      </div>
    </div>
  </div>
);

const CoworkSessionViewport = ({ sessionId, ...props }: CoworkSessionViewportProps) => {
  const loadingSessionId = useSelector(selectLoadingSessionId);
  const currentSession = useSelector(selectCurrentSession);
  const isLoadingTargetSession = loadingSessionId === sessionId;
  const isWaitingForTargetSession = isLoadingTargetSession && currentSession?.id !== sessionId;

  if (isWaitingForTargetSession) {
    return <CoworkSessionLoadingSkeleton />;
  }

  return (
    <div className="flex min-h-0 flex-1">
      <CoworkSessionDetail {...props} />
    </div>
  );
};

export default CoworkSessionViewport;
