import { Badge } from '@shared/components/ui/badge';
import { ScrollArea } from '@shared/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@shared/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/components/ui/tabs';

import type {
  WorkbenchApprovalResponseInput,
  WorkbenchTaskDetail,
} from '../../../../shared/workbenchTask';
import { i18nService } from '../../../services/i18n';
import { ApprovalAuditTab } from './ApprovalAuditTab';
import { ArtifactAuditTab } from './ArtifactAuditTab';
import { AuditJsonDisclosure } from './AuditJsonDisclosure';
import { WorkbenchTaskAuditTab } from './constants';
import { EventAuditTab } from './EventAuditTab';
import { RunAuditTab } from './RunAuditTab';
import { contractLabel, formatTimestamp, statusBadgeVariant, statusLabel } from './utils';

interface WorkbenchTaskAuditSheetProps {
  detail: WorkbenchTaskDetail;
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onRespondToApproval: (input: WorkbenchApprovalResponseInput) => void;
}

export function WorkbenchTaskAuditSheet({
  detail,
  open,
  busy,
  onOpenChange,
  onRespondToApproval,
}: WorkbenchTaskAuditSheetProps) {
  const task = detail.task;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{i18nService.t('workbenchTaskDetails')}</SheetTitle>
          <SheetDescription>{i18nService.t('workbenchTaskDetailsDescription')}</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4">
          <section
            className="flex flex-col gap-3"
            aria-label={i18nService.t('workbenchTaskSummary')}
          >
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

          <Tabs defaultValue={WorkbenchTaskAuditTab.Runs} className="flex min-h-0 flex-1 flex-col">
            <TabsList variant="line" className="w-full justify-start overflow-x-auto">
              <TabsTrigger value={WorkbenchTaskAuditTab.Runs}>
                {tabLabel('workbenchTaskRuns', detail.runs.length)}
              </TabsTrigger>
              <TabsTrigger value={WorkbenchTaskAuditTab.Events}>
                {tabLabel('workbenchTaskEvents', detail.events.length)}
              </TabsTrigger>
              <TabsTrigger value={WorkbenchTaskAuditTab.Artifacts}>
                {tabLabel('workbenchTaskArtifacts', detail.artifacts.length)}
              </TabsTrigger>
              <TabsTrigger value={WorkbenchTaskAuditTab.Approvals}>
                {tabLabel('workbenchTaskApprovals', detail.approvals.length)}
              </TabsTrigger>
            </TabsList>

            <TabsContent value={WorkbenchTaskAuditTab.Runs} className="min-h-0 flex-1">
              <ScrollArea className="h-full pr-2">
                <RunAuditTab runs={detail.runs} activeRunId={task.activeRunId} />
              </ScrollArea>
            </TabsContent>
            <TabsContent value={WorkbenchTaskAuditTab.Events} className="min-h-0 flex-1">
              <ScrollArea className="h-full pr-2">
                <EventAuditTab events={detail.events} runs={detail.runs} />
              </ScrollArea>
            </TabsContent>
            <TabsContent value={WorkbenchTaskAuditTab.Artifacts} className="min-h-0 flex-1">
              <ScrollArea className="h-full">
                <ArtifactAuditTab artifacts={detail.artifacts} runs={detail.runs} />
              </ScrollArea>
            </TabsContent>
            <TabsContent value={WorkbenchTaskAuditTab.Approvals} className="min-h-0 flex-1">
              <ScrollArea className="h-full pr-2">
                <ApprovalAuditTab
                  approvals={detail.approvals}
                  runs={detail.runs}
                  busy={busy}
                  onRespond={onRespondToApproval}
                />
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
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
