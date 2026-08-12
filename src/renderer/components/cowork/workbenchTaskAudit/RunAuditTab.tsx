import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@shared/components/ui/collapsible';
import { Empty, EmptyHeader, EmptyTitle } from '@shared/components/ui/empty';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';

import {
  WorkbenchVerificationCheckStatus,
  WorkbenchVerificationOutcome,
  type WorkbenchRun,
} from '../../../../shared/workbenchTask';
import { i18nService } from '../../../services/i18n';
import { AuditJsonDisclosure } from './AuditJsonDisclosure';
import {
  formatTimestamp,
  statusBadgeVariant,
  statusLabel,
  triggerLabel,
  verificationCheckLabel,
  verificationOutcomeLabel,
} from './utils';

interface RunAuditTabProps {
  runs: WorkbenchRun[];
  activeRunId: string | null;
}

export function RunAuditTab({ runs, activeRunId }: RunAuditTabProps) {
  if (runs.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{i18nService.t('workbenchTaskNoRuns')}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {runs.map(run => (
        <RunAuditItem key={run.id} run={run} defaultOpen={run.id === activeRunId} />
      ))}
    </div>
  );
}

function RunAuditItem({ run, defaultOpen }: { run: WorkbenchRun; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const verification = run.verificationResult;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border">
      <CollapsibleTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            className="h-auto w-full justify-start rounded-lg px-3 py-3 text-left"
          />
        }
      >
        <ChevronRight
          className={
            open
              ? 'size-4 shrink-0 rotate-90 transition-transform'
              : 'size-4 shrink-0 transition-transform'
          }
        />
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="font-medium">
            {i18nService.t('workbenchTaskRunAttempt').replace('{attempt}', String(run.attempt))}
          </span>
          <Badge variant={statusBadgeVariant(run.status)}>{statusLabel(run.status)}</Badge>
          <span className="text-xs text-muted-foreground">{triggerLabel(run.trigger)}</span>
          <span className="ml-auto text-xs text-muted-foreground">
            {formatTimestamp(run.startedAt)} - {formatTimestamp(run.endedAt)}
          </span>
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border px-3 py-3">
        <div className="flex flex-col gap-3">
          {verification ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    verification.outcome === WorkbenchVerificationOutcome.Failed
                      ? 'destructive'
                      : 'outline'
                  }
                >
                  {verificationOutcomeLabel(verification.outcome)}
                </Badge>
                <span className="text-sm text-muted-foreground">{verification.summary}</span>
              </div>
              <div className="flex flex-col gap-2">
                {verification.checks.map((check, index) => (
                  <div
                    key={`${check.name}-${index}`}
                    className="flex flex-wrap items-start gap-2 rounded-md bg-muted px-3 py-2"
                  >
                    <Badge
                      variant={
                        check.status === WorkbenchVerificationCheckStatus.Failed
                          ? 'destructive'
                          : 'outline'
                      }
                    >
                      {verificationCheckLabel(check.status)}
                    </Badge>
                    <span className="font-mono text-xs text-foreground">{check.name}</span>
                    {check.detail && (
                      <span className="basis-full text-xs text-muted-foreground">
                        {check.detail}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {verification.evidence.length > 0 && (
                <AuditJsonDisclosure
                  label={i18nService.t('workbenchTaskVerificationEvidence')}
                  value={verification.evidence}
                />
              )}
            </>
          ) : (
            <span className="text-sm text-muted-foreground">
              {i18nService.t('workbenchTaskNoVerification')}
            </span>
          )}
          {run.context && (
            <section className="flex flex-col gap-2">
              <span className="text-xs font-medium text-foreground">
                {i18nService.t('workbenchTaskRunContext')}
              </span>
              <dl className="grid grid-cols-1 gap-2 rounded-md bg-muted px-3 py-2 text-xs sm:grid-cols-2">
                <RunContextItem
                  label={i18nService.t('workbenchTaskModel')}
                  value={run.context.model}
                />
                <RunContextItem
                  label={i18nService.t('workbenchTaskProvider')}
                  value={run.context.provider}
                />
                <RunContextItem
                  label={i18nService.t('workbenchTaskReasoningProfile')}
                  value={run.context.reasoningProfile}
                />
                <RunContextItem
                  label={i18nService.t('workbenchTaskSkills')}
                  value={
                    run.context.skillIds.length > 0
                      ? run.context.skillIds.join(', ')
                      : i18nService.t('workbenchTaskNoSkills')
                  }
                />
                <RunContextItem
                  className="sm:col-span-2"
                  label={i18nService.t('workbenchTaskWorkspace')}
                  value={run.context.workspaceRoot}
                />
              </dl>
            </section>
          )}
          {run.failure && (
            <AuditJsonDisclosure
              label={i18nService.t('workbenchTaskFailureDetails')}
              value={run.failure}
              defaultOpen
            />
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function RunContextItem({
  className,
  label,
  value,
}: {
  className?: string;
  label: string;
  value: string;
}) {
  return (
    <div className={className}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all font-mono text-foreground">{value}</dd>
    </div>
  );
}
