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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/components/ui/tabs';
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
import { WorkbenchTaskAuditTab, WorkbenchTaskRunFilter } from './constants';
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
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
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
          className="flex shrink-0 flex-col gap-3"
          aria-label={i18nService.t('workbenchTaskSummary')}
        >
          {tasks.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">
                {i18nService.t('workbenchTaskHistory')}
              </span>
              <Select value={task.id} onValueChange={value => value && onSelectTask(value)}>
                <SelectTrigger className="w-full" disabled={loading}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    {tasks.map(historyTask => (
                      <SelectItem key={historyTask.id} value={historyTask.id}>
                        <span className="flex min-w-0 items-center gap-2">
                          <Badge variant={statusBadgeVariant(historyTask.status)}>
                            {statusLabel(historyTask.status)}
                          </Badge>
                          <span className="max-w-96 truncate">{historyTask.goal}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatTimestamp(historyTask.createdAt)}
                          </span>
                        </span>
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

        <Tabs defaultValue={WorkbenchTaskAuditTab.Runs} className="gap-0">
          <div className="shrink-0 border-b border-border">
            <TabsList
              variant="line"
              className="w-full justify-start overflow-x-auto overflow-y-hidden"
            >
              <TabsTrigger value={WorkbenchTaskAuditTab.Runs} className="after:bottom-[-1px]">
                {tabLabel('workbenchTaskRuns', filteredDetail.runs.length)}
              </TabsTrigger>
              <TabsTrigger value={WorkbenchTaskAuditTab.Events} className="after:bottom-[-1px]">
                {tabLabel('workbenchTaskEvents', filteredDetail.events.length)}
              </TabsTrigger>
              <TabsTrigger value={WorkbenchTaskAuditTab.Artifacts} className="after:bottom-[-1px]">
                {tabLabel('workbenchTaskArtifacts', filteredDetail.artifacts.length)}
              </TabsTrigger>
              <TabsTrigger value={WorkbenchTaskAuditTab.Approvals} className="after:bottom-[-1px]">
                {tabLabel('workbenchTaskApprovals', filteredDetail.approvals.length)}
              </TabsTrigger>
            </TabsList>
          </div>

          {detail.runs.length > 1 && (
            <div className="flex items-center gap-2 pt-3">
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

          <TabsContent value={WorkbenchTaskAuditTab.Runs} className="flex-none pt-3">
            <RunAuditTab runs={filteredDetail.runs} activeRunId={task.activeRunId} />
          </TabsContent>
          <TabsContent value={WorkbenchTaskAuditTab.Events} className="flex-none pt-3">
            <EventAuditTab events={filteredDetail.events} runs={detail.runs} />
          </TabsContent>
          <TabsContent value={WorkbenchTaskAuditTab.Artifacts} className="flex-none pt-3">
            <ArtifactAuditTab artifacts={filteredDetail.artifacts} runs={detail.runs} />
          </TabsContent>
          <TabsContent value={WorkbenchTaskAuditTab.Approvals} className="flex-none pt-3">
            <ApprovalAuditTab
              approvals={filteredDetail.approvals}
              runs={detail.runs}
              busy={busy}
              onRespond={onRespondToApproval}
            />
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
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

function tabLabel(key: string, count: number): string {
  return `${i18nService.t(key)} (${count})`;
}
