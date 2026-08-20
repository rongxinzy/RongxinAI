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
import { Download } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import type {
  WorkbenchApprovalResponseInput,
  WorkbenchTask,
  WorkbenchTaskDetail,
} from '../../../../shared/workbenchTask';
import { i18nService } from '../../../services/i18n';
import { ApprovalAuditTab } from './ApprovalAuditTab';
import { ArtifactAuditTab } from './ArtifactAuditTab';
import { AuditJsonDisclosure } from './AuditJsonDisclosure';
import { WorkbenchTaskRunFilter } from './constants';
import { EventAuditTab } from './EventAuditTab';
import { RunAuditTab } from './RunAuditTab';
import {
  contractLabel,
  filterTaskDetailByRun,
  formatTimestamp,
  statusBadgeVariant,
  statusLabel,
} from './utils';

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
  const [runFilter, setRunFilter] = useState<string>(WorkbenchTaskRunFilter.All);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setRunFilter(WorkbenchTaskRunFilter.All);
  }, [task.id]);

  const filteredDetail = useMemo(
    () => filterTaskDetailByRun(detail, runFilter),
    [detail, runFilter],
  );

  const exportAudit = async () => {
    setExporting(true);
    try {
      const result = await window.electron.workbenchTask.exportAudit(task.id);
      if (!result.success) {
        toast.error(
          i18nService
            .t('workbenchTaskExportFailed')
            .replace('{error}', result.error || i18nService.t('unknownError')),
        );
      } else if (!result.canceled) {
        toast.success(i18nService.t('workbenchTaskExported'));
      }
    } catch (error) {
      toast.error(
        i18nService
          .t('workbenchTaskExportFailed')
          .replace('{error}', error instanceof Error ? error.message : String(error)),
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <ScrollArea className="h-full">
      <div className="flex w-full flex-col gap-4 p-4">
        <header className="flex shrink-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-foreground">
              {i18nService.t('workbenchTaskDetails')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {i18nService.t('workbenchTaskDetailsDescription')}
            </p>
          </div>
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
        </header>

        <section
          className="flex shrink-0 flex-col gap-3 rounded-lg border border-border bg-muted p-4"
          aria-label={i18nService.t('workbenchTaskSummary')}
        >
          {tasks.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">
                {i18nService.t('workbenchTaskHistory')}
              </span>
              <Select value={task.id} onValueChange={value => value && onSelectTask(value)}>
                <SelectTrigger className="w-full" disabled={loading}>
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
            </div>
          )}
          <div className="flex flex-wrap items-start gap-2">
            <Badge variant={statusBadgeVariant(task.status)}>{statusLabel(task.status)}</Badge>
            <p className="min-w-0 flex-1 text-sm font-medium text-foreground">{task.goal}</p>
          </div>
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
        </section>

        {detail.runs.length > 1 && (
          <div className="flex items-center justify-end gap-2">
            <span className="text-xs text-muted-foreground">
              {i18nService.t('workbenchTaskRunFilter')}
            </span>
            <Select value={runFilter} onValueChange={value => value && setRunFilter(value)}>
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectGroup>
                  <SelectItem value={WorkbenchTaskRunFilter.All}>
                    {i18nService.t('workbenchTaskAllRuns')}
                  </SelectItem>
                  {detail.runs.map(run => (
                    <SelectItem key={run.id} value={run.id}>
                      {i18nService
                        .t('workbenchTaskRunAttempt')
                        .replace('{attempt}', String(run.attempt))}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
          <WorkbenchTaskAuditSection
            title={i18nService.t('workbenchTaskRuns')}
            count={filteredDetail.runs.length}
          >
            <RunAuditTab runs={filteredDetail.runs} activeRunId={task.activeRunId} />
          </WorkbenchTaskAuditSection>
          <WorkbenchTaskAuditSection
            title={i18nService.t('workbenchTaskEvents')}
            count={filteredDetail.events.length}
          >
            <EventAuditTab events={filteredDetail.events} runs={detail.runs} />
          </WorkbenchTaskAuditSection>
          <WorkbenchTaskAuditSection
            title={i18nService.t('workbenchTaskArtifacts')}
            count={filteredDetail.artifacts.length}
          >
            <ArtifactAuditTab artifacts={filteredDetail.artifacts} runs={detail.runs} />
          </WorkbenchTaskAuditSection>
          <WorkbenchTaskAuditSection
            title={i18nService.t('workbenchTaskApprovals')}
            count={filteredDetail.approvals.length}
          >
            <ApprovalAuditTab
              approvals={filteredDetail.approvals}
              runs={detail.runs}
              busy={busy}
              onRespond={onRespondToApproval}
            />
          </WorkbenchTaskAuditSection>
        </div>
      </div>
    </ScrollArea>
  );
}

function WorkbenchTaskAuditSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section
      className="min-w-0 overflow-hidden rounded-lg border border-border bg-background"
      aria-label={`${title} (${count})`}
    >
      <div className="flex h-10 items-center border-b border-border bg-muted px-4">
        <h3 className="text-sm font-semibold text-foreground">
          {title} <span className="font-normal text-muted-foreground">({count})</span>
        </h3>
      </div>
      <ScrollArea className="max-h-80 [&_[data-slot=scroll-area-viewport]]:max-h-80">
        <div className="p-3">{children}</div>
      </ScrollArea>
    </section>
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
