import { Spinner } from '@shared/components/ui/spinner';
import type { ComponentProps } from 'react';
import { useSelector } from 'react-redux';

import { selectLoadingSessionId } from '../../store/selectors/coworkSelectors';
import CoworkSessionDetail from './CoworkSessionDetail';

type CoworkSessionViewportProps = ComponentProps<typeof CoworkSessionDetail> & {
  sessionId: string;
};

const CoworkSessionViewport = ({ sessionId, ...props }: CoworkSessionViewportProps) => {
  const loadingSessionId = useSelector(selectLoadingSessionId);

  if (loadingSessionId) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-background">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );
  }

  return <CoworkSessionDetail key={sessionId} {...props} />;
};

export default CoworkSessionViewport;
