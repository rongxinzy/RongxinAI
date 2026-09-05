import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { ScrollArea } from '@shared/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { cn } from '@shared/lib/utils';
import { ChevronRight, Download } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { normalizeError } from '../../../services/errorNormalization';

import {
  WorkbenchTaskStatus,
  type WorkbenchApprovalResponseInput,
  type WorkbenchTask,
  type WorkbenchTaskDetail,
} from '../../../../shared/workbenchTask';
import { i18nService } from '../../../services/i18n';
import { AuditJsonDisclosure } from './AuditJsonDisclosure';
import { WorkbenchTimeline } from './timeline/WorkbenchTimeline';
import { contractLabel, formatTimestamp, statusBadgeVariant, statusLabel } from './utils';

interface WorkbenchTaskAuditViewProps {
  detail: WorkbenchTaskDetail;
  tasks: WorkbenchTask[];
  busy: boolean;
  loading: boolean;
  toolbarActions?: ReactNode;
  onSelectTask: (taskId: string) => void;
  onRespondToApproval: (input: WorkbenchApprovalResponseInput) => void;
}

export function WorkbenchTaskAuditView({
  detail,
  tasks,
  busy,
  loading,
  toolbarActions,
  onSelectTask,
  onRespondToApproval,
}: WorkbenchTaskAuditViewProps) {
  const task = detail.task;
  const [exporting, setExporting] = useState(false);

  const exportAudit = async () => {
    setExporting(true);
    try {
      const result = await window.electron.workbenchTask.exportAudit(task.id);
      if (!result.success) {
        toast.error(
          i18nService
            .t('workbenchTaskExportFailed')
            .replace('{error}', normalizeError(result.error || i18nService.t('unknownError'))),
        );
      } else if (!result.canceled) {
        toast.success(i18nService.t('workbenchTaskExported'));
      }
    } catch (error) {
      toast.error(
        i18nService
          .t('workbenchTaskExportFailed')
          .replace('{error}', normalizeError(error)),
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto w-full max-w-3xl px-6">
        <header className="flex flex-col gap-3 pt-8 pb-6">
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              {task.status === WorkbenchTaskStatus.Running && <RunningDot />}
              <Badge variant={statusBadgeVariant(task.status)}>{statusLabel(task.status)}</Badge>
            </span>
            <div className="flex shrink-0 items-center gap-1">
              {toolbarActions}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={exporting}
                onClick={() => void exportAudit()}
              >
                <Download data-icon="inline-start" />
                {i18nService.t('workbenchTaskExport')}
              </Button>
            </div>
          </div>
          <h2 className="line-clamp-2 text-xl font-semibold tracking-tight text-foreground">
            {task.goal}
          </h2>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>{contractLabel(task.contract.kind)}</span>
            <span>{formatTimestamp(task.createdAt)}</span>
            <span>
              {i18nService
                .t('workbenchTimelineAttempts')
                .replace('{count}', String(detail.runs.length))}
            </span>
          </div>
          {tasks.length > 1 && (
            <Select value={task.id} onValueChange={value => value && onSelectTask(value)}>
              <SelectTrigger size="sm" className="w-full max-w-sm" disabled={loading}>
                <SelectValue>
                  <TaskHistorySummary task={task} />
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="start">
                <SelectGroup>
                  {tasks.map(historyTask => (
                    <SelectItem key={historyTask.id} value={historyTask.id}>
                      <TaskHistorySummary task={historyTask} />
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
          <TaskDetailsDisclosure task={task} />
        </header>

        <WorkbenchTimeline
          detail={detail}
          busy={busy}
          onRespondToApproval={onRespondToApproval}
        />
      </div>
    </ScrollArea>
  );
}

function RunningDot() {
  const reducedMotion = useReducedMotion();
  return (
    <span className="relative flex size-1.5">
      {!reducedMotion && (
        <motion.span
          aria-hidden="true"
          className="absolute inline-flex size-full rounded-full bg-primary"
          animate={{ scale: [1, 2.2], opacity: [0.7, 0] }}
          transition={{ duration: 1.5, repeat: Number.POSITIVE_INFINITY, ease: 'easeOut' }}
        />
      )}
      <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
    </span>
  );
}

function TaskDetailsDisclosure({ task }: { task: WorkbenchTask }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
        className="theme-native-audit-link flex w-fit items-center gap-1"
      >
        <ChevronRight
          className={cn(
            'size-3 transition-transform motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
        {i18nService.t('workbenchTimelineTaskDetails')}
      </button>
      {open && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted p-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
            <TaskMetadata
              label={i18nService.t('workbenchTaskContract')}
              value={contractLabel(task.contract.kind)}
            />
            <TaskMetadata
              label={i18nService.t('workbenchTaskAcceptance')}
              value={i18nService.t(
                task.contract.requiresUserAcceptance
                  ? 'workbenchTaskAcceptanceRequired'
                  : 'workbenchTaskAcceptanceNotRequired',
              )}
            />
            <TaskMetadata
              label={i18nService.t('workbenchTaskCreatedAt')}
              value={formatTimestamp(task.createdAt)}
            />
            <TaskMetadata
              label={i18nService.t('workbenchTaskCompletedAt')}
              value={formatTimestamp(task.completedAt)}
            />
          </dl>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              {i18nService.t('workbenchTaskId')}
            </span>
            <code className="break-all font-mono text-xs text-foreground">{task.id}</code>
          </div>
          {task.contract.metadata && Object.keys(task.contract.metadata).length > 0 && (
            <AuditJsonDisclosure
              label={i18nService.t('workbenchTaskContractMetadata')}
              value={task.contract.metadata}
            />
          )}
        </div>
      )}
    </div>
  );
}

function TaskMetadata({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words text-foreground">{value}</dd>
    </div>
  );
}

function TaskHistorySummary({ task }: { task: WorkbenchTask }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <Badge variant={statusBadgeVariant(task.status)}>{statusLabel(task.status)}</Badge>
      <span className="min-w-0 flex-1 truncate">{task.goal}</span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {formatTimestamp(task.createdAt)}
      </span>
    </span>
  );
}
