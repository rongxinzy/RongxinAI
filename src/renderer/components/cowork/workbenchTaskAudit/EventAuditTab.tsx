import { Badge } from '@shared/components/ui/badge';
import { Empty, EmptyHeader, EmptyTitle } from '@shared/components/ui/empty';

import type { WorkbenchRun, WorkbenchRunEvent } from '../../../../shared/workbenchTask';
import { i18nService } from '../../../services/i18n';
import { AuditJsonDisclosure } from './AuditJsonDisclosure';
import { eventLabel, formatTimestamp, getRunAttempt } from './utils';

interface EventAuditTabProps {
  events: WorkbenchRunEvent[];
  runs: WorkbenchRun[];
}

export function EventAuditTab({ events, runs }: EventAuditTabProps) {
  if (events.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{i18nService.t('workbenchTaskNoEvents')}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ol className="flex flex-col gap-2" aria-label={i18nService.t('workbenchTaskEvents')}>
      {events.map(event => {
        const attempt = getRunAttempt(runs, event.runId);
        const hasPayload = Object.keys(event.payload).length > 0;
        return (
          <li key={event.id} className="rounded-lg border border-border px-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">{eventLabel(event.type)}</span>
              {attempt !== null && (
                <Badge variant="outline">
                  {i18nService.t('workbenchTaskRunAttempt').replace('{attempt}', String(attempt))}
                </Badge>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {formatTimestamp(event.createdAt)}
              </span>
            </div>
            {hasPayload && (
              <div className="mt-2">
                <AuditJsonDisclosure
                  label={i18nService.t('workbenchTaskEventPayload')}
                  value={event.payload}
                />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
