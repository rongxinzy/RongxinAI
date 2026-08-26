import { Skeleton } from '@shared/components/ui/skeleton';
import { useEffect, useState } from 'react';

import {
  EnterpriseRendererSurface,
  type EnterpriseRendererSettingsPage as EnterpriseRendererSettingsPageDescriptor,
} from '../../../shared/enterpriseRenderer';
import type { EnterpriseSessionResult } from '../../../shared/enterpriseSession';
import { EnterpriseRendererFrame } from './EnterpriseRendererFrame';

interface EnterpriseSettingsPageProps {
  readonly page: EnterpriseRendererSettingsPageDescriptor;
  readonly title: string;
}

export function EnterpriseSettingsPage({ page, title }: EnterpriseSettingsPageProps) {
  const [session, setSession] = useState<EnterpriseSessionResult | null>(null);

  useEffect(() => {
    let active = true;
    void window.electron.enterprise.session
      .snapshot()
      .catch((): EnterpriseSessionResult => operationFailed())
      .then(result => {
        if (active) setSession(result);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!session) {
    return (
      <div className="flex h-full flex-col gap-4 p-6" aria-busy="true">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <EnterpriseRendererFrame
      src={page.entrypoint}
      title={title}
      surface={EnterpriseRendererSurface.Settings}
      pageId={page.id}
      session={session}
      className="size-full"
    />
  );
}

function operationFailed(): EnterpriseSessionResult {
  return {
    ok: false,
    error: { code: 'OPERATION_FAILED', message: 'Enterprise session snapshot failed.' },
  };
}
