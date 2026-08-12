import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRequest,
  ConfirmationTitle,
} from '@shared/components/ai-elements/confirmation';
import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@shared/components/ui/collapsible';
import { Empty, EmptyHeader, EmptyTitle } from '@shared/components/ui/empty';
import { Label } from '@shared/components/ui/label';
import { Textarea } from '@shared/components/ui/textarea';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';

import {
  WorkbenchApprovalDecision,
  WorkbenchRunStatus,
  type WorkbenchApproval,
  type WorkbenchApprovalResponseInput,
  type WorkbenchRun,
} from '../../../../shared/workbenchTask';
import { i18nService } from '../../../services/i18n';
import { AuditJsonDisclosure } from './AuditJsonDisclosure';
import {
  decisionLabel,
  decisionSourceLabel,
  effectLabel,
  formatTimestamp,
  getRunAttempt,
  riskLabel,
} from './utils';

interface ApprovalAuditTabProps {
  approvals: WorkbenchApproval[];
  runs: WorkbenchRun[];
  busy: boolean;
  onRespond: (input: WorkbenchApprovalResponseInput) => void;
}

export function ApprovalAuditTab({ approvals, runs, busy, onRespond }: ApprovalAuditTabProps) {
  const [denialReasons, setDenialReasons] = useState<Record<string, string>>({});
  const pendingApprovals = approvals.filter(
    approval =>
      approval.decision === WorkbenchApprovalDecision.Pending &&
      runs.some(
        run => run.id === approval.runId && run.status === WorkbenchRunStatus.WaitingApproval,
      ),
  );

  if (approvals.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{i18nService.t('workbenchTaskNoApprovals')}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {pendingApprovals.map(approval => {
        const reason = denialReasons[approval.id] ?? '';
        return (
          <Confirmation key={approval.id} approval={{ id: approval.id }} state="approval-requested">
            <ConfirmationRequest>
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <ConfirmationTitle>
                    {i18nService.t('workbenchTaskApprovalRequest')}: {approval.toolName}
                  </ConfirmationTitle>
                  <Badge variant="outline">{riskLabel(approval.riskLevel)}</Badge>
                  <Badge variant="outline">
                    {i18nService
                      .t('workbenchTaskRunAttempt')
                      .replace('{attempt}', String(getRunAttempt(runs, approval.runId) ?? '-'))}
                  </Badge>
                </div>
                <AuditJsonDisclosure
                  label={i18nService.t('workbenchTaskRequestDetails')}
                  value={approval.request}
                  defaultOpen
                />
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`approval-reason-${approval.id}`}>
                    {i18nService.t('workbenchTaskDenialReason')}
                  </Label>
                  <Textarea
                    id={`approval-reason-${approval.id}`}
                    value={reason}
                    onChange={event =>
                      setDenialReasons(current => ({
                        ...current,
                        [approval.id]: event.target.value,
                      }))
                    }
                    placeholder={i18nService.t('workbenchTaskDenialReasonPlaceholder')}
                    disabled={busy}
                    rows={2}
                  />
                </div>
                <ConfirmationActions>
                  <ConfirmationAction
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      onRespond({
                        approvalId: approval.id,
                        approved: false,
                        reason: reason.trim() || undefined,
                      })
                    }
                  >
                    {i18nService.t('workbenchTaskDeny')}
                  </ConfirmationAction>
                  <ConfirmationAction
                    disabled={busy}
                    onClick={() => onRespond({ approvalId: approval.id, approved: true })}
                  >
                    {i18nService.t('workbenchTaskApprove')}
                  </ConfirmationAction>
                </ConfirmationActions>
              </div>
            </ConfirmationRequest>
          </Confirmation>
        );
      })}

      <div className="flex flex-col gap-2">
        {approvals.map(approval => (
          <ApprovalHistoryItem key={approval.id} approval={approval} runs={runs} />
        ))}
      </div>
    </div>
  );
}

function ApprovalHistoryItem({
  approval,
  runs,
}: {
  approval: WorkbenchApproval;
  runs: WorkbenchRun[];
}) {
  const [open, setOpen] = useState(false);
  const attempt = getRunAttempt(runs, approval.runId);

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
          <span className="font-medium">{approval.toolName}</span>
          <Badge variant="outline">{riskLabel(approval.riskLevel)}</Badge>
          <Badge variant="outline">{decisionLabel(approval.decision)}</Badge>
          {attempt !== null && (
            <span className="text-xs text-muted-foreground">
              {i18nService.t('workbenchTaskRunAttempt').replace('{attempt}', String(attempt))}
            </span>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {formatTimestamp(approval.createdAt)}
          </span>
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border px-3 py-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{i18nService.t('workbenchTaskDecisionSource')}</dt>
          <dd>{approval.decisionSource ? decisionSourceLabel(approval.decisionSource) : '-'}</dd>
          <dt className="text-muted-foreground">{i18nService.t('workbenchTaskEffect')}</dt>
          <dd>{effectLabel(approval.effectStatus)}</dd>
          <dt className="text-muted-foreground">{i18nService.t('workbenchTaskDecidedAt')}</dt>
          <dd>{formatTimestamp(approval.decidedAt)}</dd>
          <dt className="text-muted-foreground">{i18nService.t('workbenchTaskIdempotencyKey')}</dt>
          <dd className="break-all font-mono text-xs">{approval.idempotencyKey}</dd>
        </dl>
        <div className="mt-3 flex flex-col gap-2">
          <AuditJsonDisclosure
            label={i18nService.t('workbenchTaskRequestDetails')}
            value={approval.request}
          />
          {approval.result && (
            <AuditJsonDisclosure
              label={i18nService.t('workbenchTaskResult')}
              value={approval.result}
            />
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
