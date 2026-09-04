import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { Label } from '@shared/components/ui/label';
import { Textarea } from '@shared/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@shared/components/ui/tooltip';
import { cn } from '@shared/lib/utils';
import {
  Activity,
  BookOpen,
  ChevronRight,
  CircleOff,
  Copy,
  ExternalLink,
  FileText,
  FlaskConical,
  FolderOpen,
  Gauge,
  LifeBuoy,
  ListChecks,
  MessageSquare,
  Pause,
  Play,
  ShieldCheck,
  ShieldQuestion,
  ShieldX,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { memo, useState } from 'react';
import { toast } from 'sonner';

import {
  WorkbenchApprovalDecision,
  WorkbenchArtifactKind,
  WorkbenchRunEventType,
  WorkbenchRunStatus,
  type WorkbenchApproval,
  type WorkbenchApprovalResponseInput,
  type WorkbenchArtifact,
  type WorkbenchRun,
  type WorkbenchRunEvent,
} from '../../../../../shared/workbenchTask';
import { i18nService } from '../../../../services/i18n';
import { AuditJsonDisclosure } from '../AuditJsonDisclosure';
import {
  decisionLabel,
  decisionSourceLabel,
  effectLabel,
  eventLabel,
  formatTimestamp,
  riskLabel,
  artifactKindLabel,
  resolveArtifactFilePath,
} from '../utils';
import { formatTimeOfDay, type TimelineEntry } from './timelineModel';

interface TimelineEntryListProps {
  entries: TimelineEntry[];
  /** The run that owns these entries. */
  run: WorkbenchRun;
  /** All task runs, used to resolve artifact file paths. */
  runs: WorkbenchRun[];
  busy: boolean;
  onRespondToApproval: (input: WorkbenchApprovalResponseInput) => void;
}

export function TimelineEntryList({
  entries,
  run,
  runs,
  busy,
  onRespondToApproval,
}: TimelineEntryListProps) {
  return (
    <TooltipProvider>
      <ol className="flex flex-col">
        {entries.map((entry, index) => {
          const connectToNext = index < entries.length - 1;
          switch (entry.kind) {
            case 'event':
              return (
                <TimelineEventItem
                  key={entry.id}
                  event={entry.event}
                  connectToNext={connectToNext}
                />
              );
            case 'eventCluster':
              return (
                <TimelineEventClusterItem
                  key={entry.id}
                  type={entry.type}
                  events={entry.events}
                  connectToNext={connectToNext}
                />
              );
            case 'approval':
              return (
                <TimelineApprovalItem
                  key={entry.id}
                  approval={entry.approval}
                  run={run}
                  busy={busy}
                  onRespond={onRespondToApproval}
                  connectToNext={connectToNext}
                />
              );
            case 'artifact':
              return (
                <TimelineArtifactItem
                  key={entry.id}
                  artifact={entry.artifact}
                  runs={runs}
                  connectToNext={connectToNext}
                />
              );
          }
        })}
      </ol>
    </TooltipProvider>
  );
}

function EntryMarker({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'absolute top-2.5 left-2.5 z-10 size-2 rounded-full',
        className,
      )}
    />
  );
}

function EntryConnector() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute top-3.5 -bottom-3.5 left-3.5 z-0 w-px -translate-x-1/2 bg-border"
    />
  );
}

const eventIcons: Partial<Record<WorkbenchRunEventType, LucideIcon>> = {
  [WorkbenchRunEventType.RunStarted]: Play,
  [WorkbenchRunEventType.ToolRead]: BookOpen,
  [WorkbenchRunEventType.ApprovalRequested]: ShieldQuestion,
  [WorkbenchRunEventType.ApprovalResolved]: ShieldCheck,
  [WorkbenchRunEventType.ToolEffectStarted]: Zap,
  [WorkbenchRunEventType.ToolEffectFinished]: Wrench,
  [WorkbenchRunEventType.VerificationStarted]: ListChecks,
  [WorkbenchRunEventType.VerificationFinished]: ListChecks,
  [WorkbenchRunEventType.RunPaused]: Pause,
  [WorkbenchRunEventType.RunCancelled]: CircleOff,
  [WorkbenchRunEventType.RunFailed]: X,
  [WorkbenchRunEventType.RecoveryRequired]: LifeBuoy,
  [WorkbenchRunEventType.HarnessProfiled]: Gauge,
  [WorkbenchRunEventType.HarnessActivation]: Gauge,
  [WorkbenchRunEventType.HarnessFailure]: Gauge,
  [WorkbenchRunEventType.HarnessQualityMeasured]: Gauge,
};

const TimelineEventItem = memo(function TimelineEventItem({
  event,
  connectToNext,
}: {
  event: WorkbenchRunEvent;
  connectToNext: boolean;
}) {
  const [payloadOpen, setPayloadOpen] = useState(false);
  const Icon = eventIcons[event.type] ?? Activity;
  const hasPayload = Object.keys(event.payload).length > 0;

  return (
    <li className="relative isolate pl-10">
      {connectToNext && <EntryConnector />}
      <EntryMarker className="bg-muted-foreground" />
      <div className="flex items-center gap-2 py-1.5">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
          {eventLabel(event.type)}
        </span>
        {hasPayload && (
          <button
            type="button"
            aria-expanded={payloadOpen}
            aria-label={i18nService.t('workbenchTaskEventPayload')}
            onClick={() => setPayloadOpen(open => !open)}
            className="flex shrink-0 items-center gap-0.5 rounded-sm text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight
              className={cn(
                'size-3 transition-transform motion-reduce:transition-none',
                payloadOpen && 'rotate-90',
              )}
            />
            {i18nService.t('workbenchTaskEventPayload')}
          </button>
        )}
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {formatTimeOfDay(event.createdAt)}
        </span>
      </div>
      {hasPayload && payloadOpen && (
        <div className="pb-2">
          <AuditJsonDisclosure
            label={i18nService.t('workbenchTaskEventPayload')}
            value={event.payload}
            defaultOpen
          />
        </div>
      )}
    </li>
  );
});

const TimelineEventClusterItem = memo(function TimelineEventClusterItem({
  type,
  events,
  connectToNext,
}: {
  type: WorkbenchRunEventType;
  events: WorkbenchRunEvent[];
  connectToNext: boolean;
}) {
  const [open, setOpen] = useState(false);
  const Icon = eventIcons[type] ?? Activity;

  return (
    <li className="relative isolate pl-10">
      {connectToNext && <EntryConnector />}
      <EntryMarker className="bg-muted-foreground" />
      <button
        type="button"
        aria-expanded={open}
        aria-label={i18nService
          .t('workbenchTimelineToggleCluster')
          .replace('{count}', String(events.length))}
        onClick={() => setOpen(current => !current)}
        className="flex w-full items-center gap-2 rounded-md py-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px"
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{eventLabel(type)}</span>
        <Badge variant="secondary">{`×${events.length}`}</Badge>
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
      </button>
      {open && (
        <ol className="flex flex-col border-l border-border pl-3">
          {events.map(event => {
            const hasPayload = Object.keys(event.payload).length > 0;
            return <ClusterEventRow key={event.id} event={event} hasPayload={hasPayload} />;
          })}
        </ol>
      )}
    </li>
  );
});

function ClusterEventRow({ event, hasPayload }: { event: WorkbenchRunEvent; hasPayload: boolean }) {
  const [payloadOpen, setPayloadOpen] = useState(false);
  return (
    <li>
      <div className="flex items-center gap-2 py-1">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {eventLabel(event.type)}
        </span>
        {hasPayload && (
          <button
            type="button"
            aria-expanded={payloadOpen}
            aria-label={i18nService.t('workbenchTaskEventPayload')}
            onClick={() => setPayloadOpen(open => !open)}
            className="flex shrink-0 items-center gap-0.5 rounded-sm text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight
              className={cn(
                'size-3 transition-transform motion-reduce:transition-none',
                payloadOpen && 'rotate-90',
              )}
            />
            {i18nService.t('workbenchTaskEventPayload')}
          </button>
        )}
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {formatTimeOfDay(event.createdAt)}
        </span>
      </div>
      {hasPayload && payloadOpen && (
        <div className="pb-2">
          <AuditJsonDisclosure
            label={i18nService.t('workbenchTaskEventPayload')}
            value={event.payload}
            defaultOpen
          />
        </div>
      )}
    </li>
  );
}

const TimelineApprovalItem = memo(function TimelineApprovalItem({
  approval,
  run,
  busy,
  onRespond,
  connectToNext,
}: {
  approval: WorkbenchApproval;
  run: WorkbenchRun;
  busy: boolean;
  onRespond: (input: WorkbenchApprovalResponseInput) => void;
  connectToNext: boolean;
}) {
  const isPending =
    approval.decision === WorkbenchApprovalDecision.Pending &&
    run.status === WorkbenchRunStatus.WaitingApproval;

  if (isPending) {
    return (
      <PendingApprovalEntry
        approval={approval}
        busy={busy}
        onRespond={onRespond}
        connectToNext={connectToNext}
      />
    );
  }
  return <ResolvedApprovalEntry approval={approval} connectToNext={connectToNext} />;
});

function PendingApprovalEntry({
  approval,
  busy,
  onRespond,
  connectToNext,
}: {
  approval: WorkbenchApproval;
  busy: boolean;
  onRespond: (input: WorkbenchApprovalResponseInput) => void;
  connectToNext: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const [reason, setReason] = useState('');

  return (
    <li className="relative isolate pl-10">
      {connectToNext && <EntryConnector />}
      <span
        aria-hidden="true"
        className="absolute top-2.5 left-2.5 z-10 flex size-2 rounded-full"
      >
        {!reducedMotion && (
          <motion.span
            className="absolute inline-flex size-full rounded-full bg-primary"
            animate={{ scale: [1, 1.8], opacity: [0.7, 0] }}
            transition={{ duration: 1.6, repeat: Number.POSITIVE_INFINITY, ease: 'easeOut' }}
          />
        )}
        <span className="relative inline-flex size-2 rounded-full bg-primary" />
      </span>
      <div className="my-2 flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldQuestion className="size-3.5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {approval.toolName}
          </span>
          <Badge variant="outline">{riskLabel(approval.riskLevel)}</Badge>
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
            onChange={event => setReason(event.target.value)}
            placeholder={i18nService.t('workbenchTaskDenialReasonPlaceholder')}
            disabled={busy}
            rows={2}
          />
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
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
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => onRespond({ approvalId: approval.id, approved: true })}
          >
            {i18nService.t('workbenchTaskApprove')}
          </Button>
        </div>
      </div>
    </li>
  );
}

const decisionTone: Record<string, string> = {
  [WorkbenchApprovalDecision.Approved]: 'text-primary',
  [WorkbenchApprovalDecision.Denied]: 'text-destructive',
  [WorkbenchApprovalDecision.Expired]: 'text-destructive',
};

const ResolvedApprovalEntry = memo(function ResolvedApprovalEntry({
  approval,
  connectToNext,
}: {
  approval: WorkbenchApproval;
  connectToNext: boolean;
}) {
  const [open, setOpen] = useState(false);
  const approved = approval.decision === WorkbenchApprovalDecision.Approved;
  const negative =
    approval.decision === WorkbenchApprovalDecision.Denied ||
    approval.decision === WorkbenchApprovalDecision.Expired;
  const Icon = approved ? ShieldCheck : negative ? ShieldX : ShieldQuestion;

  return (
    <li className="relative isolate pl-10">
      {connectToNext && <EntryConnector />}
      <EntryMarker
        className={approved ? 'bg-primary' : negative ? 'bg-destructive' : 'bg-muted-foreground'}
      />
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
        className="flex w-full items-center gap-2 rounded-md py-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px"
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{approval.toolName}</span>
        <span
          className={cn(
            'shrink-0 text-xs',
            decisionTone[approval.decision] ?? 'text-muted-foreground',
          )}
        >
          {decisionLabel(approval.decision)}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {formatTimeOfDay(approval.createdAt)}
        </span>
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
      </button>
      {open && (
        <div className="flex flex-col gap-2 pb-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
            <dt className="text-muted-foreground">
              {i18nService.t('workbenchTaskDecisionSource')}
            </dt>
            <dd className="text-foreground">
              {approval.decisionSource ? decisionSourceLabel(approval.decisionSource) : '-'}
            </dd>
            <dt className="text-muted-foreground">{i18nService.t('workbenchTaskEffect')}</dt>
            <dd className="text-foreground">{effectLabel(approval.effectStatus)}</dd>
            <dt className="text-muted-foreground">{i18nService.t('workbenchTaskDecidedAt')}</dt>
            <dd className="text-foreground">{formatTimestamp(approval.decidedAt)}</dd>
            <dt className="text-muted-foreground">
              {i18nService.t('workbenchTaskIdempotencyKey')}
            </dt>
            <dd className="break-all font-mono text-foreground">{approval.idempotencyKey}</dd>
          </dl>
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
      )}
    </li>
  );
});

const artifactIcons: Record<WorkbenchArtifactKind, LucideIcon> = {
  [WorkbenchArtifactKind.File]: FileText,
  [WorkbenchArtifactKind.MessageBlock]: MessageSquare,
  [WorkbenchArtifactKind.Evidence]: FlaskConical,
};

const TimelineArtifactItem = memo(function TimelineArtifactItem({
  artifact,
  runs,
  connectToNext,
}: {
  artifact: WorkbenchArtifact;
  runs: WorkbenchRun[];
  connectToNext: boolean;
}) {
  const filePath = resolveArtifactFilePath(artifact, runs);
  const Icon = artifactIcons[artifact.kind] ?? FileText;

  const showActionError = (error?: string) =>
    toast.error(
      i18nService
        .t('workbenchTaskArtifactActionFailed')
        .replace('{error}', error || i18nService.t('unknownError')),
    );

  const openArtifact = async (target: string) => {
    try {
      const result = await window.electron.shell.openPath(target);
      if (!result.success) showActionError(result.error);
    } catch (error) {
      showActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const revealArtifact = async (target: string) => {
    try {
      const result = await window.electron.shell.showItemInFolder(target);
      if (!result.success) showActionError(result.error);
    } catch (error) {
      showActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const copyHash = async (hash: string) => {
    try {
      await navigator.clipboard.writeText(hash);
      toast.success(i18nService.t('workbenchTaskHashCopied'));
    } catch (error) {
      showActionError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <li className="group relative isolate pl-10">
      {connectToNext && <EntryConnector />}
      <EntryMarker className="bg-primary" />
      <div className="flex items-center gap-2 py-1.5">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
          {artifact.reference}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {artifactKindLabel(artifact.kind)}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {formatTimeOfDay(artifact.createdAt)}
        </span>
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none">
          {filePath && (
            <>
              <ArtifactAction
                label={i18nService.t('workbenchTaskOpenArtifact')}
                icon={ExternalLink}
                onClick={() => void openArtifact(filePath)}
              />
              <ArtifactAction
                label={i18nService.t('workbenchTaskRevealArtifact')}
                icon={FolderOpen}
                onClick={() => void revealArtifact(filePath)}
              />
            </>
          )}
          <ArtifactAction
            label={i18nService.t('workbenchTaskCopyHash')}
            icon={Copy}
            onClick={() => void copyHash(artifact.contentHash)}
          />
        </span>
      </div>
    </li>
  );
});

function ArtifactAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            onClick={onClick}
          />
        }
      >
        <Icon />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
