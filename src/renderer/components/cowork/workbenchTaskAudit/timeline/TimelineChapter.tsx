import { Badge } from '@shared/components/ui/badge';
import { cn } from '@shared/lib/utils';
import {
  Check,
  ChevronRight,
  Circle,
  Loader2,
  Minus,
  Pause,
  ShieldQuestion,
  X,
  type LucideIcon,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';

import {
  WorkbenchRunStatus,
  WorkbenchVerificationCheckStatus,
  WorkbenchVerificationOutcome,
  type WorkbenchApprovalResponseInput,
  type WorkbenchRun,
  type WorkbenchVerificationCheck,
} from '../../../../../shared/workbenchTask';
import { i18nService } from '../../../../services/i18n';
import { AuditJsonDisclosure } from '../AuditJsonDisclosure';
import { TIMELINE_EASE } from '../constants';
import {
  statusLabel,
  triggerLabel,
  verificationCheckLabel,
  verificationOutcomeLabel,
} from '../utils';
import { TimelineEntryList } from './TimelineEntries';
import {
  formatDuration,
  formatTimeOfDay,
  type TimelineChapter as TimelineChapterModel,
} from './timelineModel';

interface TimelineChapterProps {
  chapter: TimelineChapterModel;
  runs: WorkbenchRun[];
  defaultOpen: boolean;
  busy: boolean;
  onRespondToApproval: (input: WorkbenchApprovalResponseInput) => void;
}

const chapterStatusIcon = (status: WorkbenchRun['status']): LucideIcon => {
  switch (status) {
    case WorkbenchRunStatus.Running:
      return Loader2;
    case WorkbenchRunStatus.Succeeded:
      return Check;
    case WorkbenchRunStatus.Failed:
      return X;
    case WorkbenchRunStatus.WaitingApproval:
      return ShieldQuestion;
    case WorkbenchRunStatus.Paused:
    case WorkbenchRunStatus.NeedsReview:
      return Pause;
    default:
      return Circle;
  }
};

export function TimelineChapter({
  chapter,
  runs,
  defaultOpen,
  busy,
  onRespondToApproval,
}: TimelineChapterProps) {
  const reducedMotion = useReducedMotion();
  const [open, setOpen] = useState(defaultOpen);
  const { run, entries } = chapter;
  const StatusIcon = chapterStatusIcon(run.status);
  const duration = formatDuration(run.startedAt, run.endedAt);

  const expandedContent = (
    <div className="h-64 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain">
      <div className="flex flex-col gap-4 pt-1 pb-6">
        <div className="pl-10">
          <RunSummary run={run} />
        </div>
        {entries.length > 0 ? (
          <TimelineEntryList
            entries={entries}
            run={run}
            runs={runs}
            busy={busy}
            onRespondToApproval={onRespondToApproval}
          />
        ) : (
          <p className="pl-10 text-sm text-muted-foreground">
            {i18nService.t('workbenchTaskNoEvents')}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <>
      <span
        aria-hidden="true"
        className="absolute top-0 left-0 z-10 flex size-7 items-center justify-center rounded-full border border-border bg-background"
      >
        <StatusIcon
          className={cn(
            'size-3.5',
            run.status === WorkbenchRunStatus.Running &&
              'animate-spin text-primary motion-reduce:animate-none',
            run.status === WorkbenchRunStatus.Succeeded && 'text-primary',
            run.status === WorkbenchRunStatus.Failed && 'text-destructive',
            run.status !== WorkbenchRunStatus.Running &&
              run.status !== WorkbenchRunStatus.Succeeded &&
              run.status !== WorkbenchRunStatus.Failed &&
              'text-muted-foreground',
          )}
        />
      </span>
      <button
        type="button"
        aria-expanded={open}
        aria-label={i18nService
          .t('workbenchTimelineToggleChapter')
          .replace('{attempt}', String(run.attempt))}
        onClick={() => setOpen(current => !current)}
        className="group flex min-h-7 w-full items-center gap-2 rounded-md pl-10 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px"
      >
        <span className="shrink-0 text-sm font-medium text-foreground">
          {i18nService.t('workbenchTaskRunAttempt').replace('{attempt}', String(run.attempt))}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{statusLabel(run.status)}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {triggerLabel(run.trigger)}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground tabular-nums">
          {run.startedAt !== null && <span>{formatTimeOfDay(run.startedAt)}</span>}
          {duration && <span>{duration}</span>}
        </span>
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:text-foreground motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
      </button>
      {reducedMotion ? (
        open && expandedContent
      ) : (
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="chapter-content"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: TIMELINE_EASE }}
              className="overflow-hidden"
            >
              {expandedContent}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </>
  );
}

function RunSummary({ run }: { run: WorkbenchRun }) {
  const verification = run.verificationResult;
  return (
    <div className="flex flex-col gap-3">
      {verification ? (
        <div className="flex flex-col gap-2">
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
          {verification.checks.length > 0 && (
            <ul className="flex flex-col gap-1">
              {verification.checks.map((check, index) => (
                <VerificationCheckRow key={`${check.name}-${index}`} check={check} />
              ))}
            </ul>
          )}
          {verification.evidence.length > 0 && (
            <AuditJsonDisclosure
              label={i18nService.t('workbenchTaskVerificationEvidence')}
              value={verification.evidence}
            />
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {i18nService.t('workbenchTaskNoVerification')}
        </p>
      )}
      {run.context && (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
          <RunContextItem label={i18nService.t('workbenchTaskModel')} value={run.context.model} />
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
      )}
      {run.failure && (
        <AuditJsonDisclosure
          label={i18nService.t('workbenchTaskFailureDetails')}
          value={run.failure}
          defaultOpen
        />
      )}
    </div>
  );
}

const checkIcons: Record<string, { icon: LucideIcon; className: string }> = {
  [WorkbenchVerificationCheckStatus.Passed]: { icon: Check, className: 'text-primary' },
  [WorkbenchVerificationCheckStatus.Failed]: { icon: X, className: 'text-destructive' },
  [WorkbenchVerificationCheckStatus.Skipped]: { icon: Minus, className: 'text-muted-foreground' },
};

function VerificationCheckRow({ check }: { check: WorkbenchVerificationCheck }) {
  const { icon: Icon, className } =
    checkIcons[check.status] ?? checkIcons[WorkbenchVerificationCheckStatus.Skipped];
  return (
    <li className="flex flex-wrap items-start gap-2">
      <Icon className={cn('mt-0.5 size-3.5 shrink-0', className)} />
      <span className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">
        {check.name}
      </span>
      <span className="sr-only">{verificationCheckLabel(check.status)}</span>
      {check.detail && (
        <span className="basis-full pl-5.5 text-xs text-muted-foreground">{check.detail}</span>
      )}
    </li>
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
