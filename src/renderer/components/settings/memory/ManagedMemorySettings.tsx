import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Brain, Check, RefreshCw, RotateCcw, ShieldAlert, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shared/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@shared/components/ui/empty';
import { Skeleton } from '@shared/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shared/components/ui/table';
import {
  MemoryDeliveryStatus,
  MemoryLifecycleStatus,
  MemoryScope,
  MemorySensitivity,
  type ManagedMemoryRecord,
} from '../../../../shared/memory';
import { i18nService } from '../../../services/i18n';
import { memoryService } from '../../../services/memory';

interface ForgetTarget {
  record: ManagedMemoryRecord;
}

export function ManagedMemorySettings() {
  const [records, setRecords] = useState<ManagedMemoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [forgetTarget, setForgetTarget] = useState<ForgetTarget | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRecords(await memoryService.list());
    } catch (error) {
      toast.error(i18nService.t('managedMemoryLoadFailed'));
      console.error('[ManagedMemory] Failed to load memory projection:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingCount = useMemo(
    () => records.filter(record => record.deliveryStatus === MemoryDeliveryStatus.Pending).length,
    [records],
  );

  const runAction = async (id: string, action: () => Promise<unknown>, successKey: string) => {
    setBusyId(id);
    try {
      await action();
      toast.success(i18nService.t(successKey));
      await load();
    } catch (error) {
      toast.error(i18nService.t('managedMemoryActionFailed'));
      console.error('[ManagedMemory] Memory action failed:', error);
    } finally {
      setBusyId(null);
    }
  };

  const handleRetry = async () => {
    setBusyId('outbox');
    try {
      await memoryService.retryPending();
      await load();
    } catch (error) {
      toast.error(i18nService.t('managedMemoryRetryFailed'));
      console.error('[ManagedMemory] Failed to retry pending propagation:', error);
    } finally {
      setBusyId(null);
    }
  };

  const handleForget = async (hardDelete: boolean) => {
    const target = forgetTarget?.record;
    if (!target) return;
    setForgetTarget(null);
    await runAction(
      target.id,
      () => memoryService.forget(target.id, hardDelete),
      hardDelete ? 'managedMemoryHardDeleted' : 'managedMemoryForgotten',
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{i18nService.t('managedMemoryTitle')}</CardTitle>
        <CardDescription>{i18nService.t('managedMemoryDescription')}</CardDescription>
        <CardAction>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleRetry()}
            disabled={busyId !== null}
          >
            <RefreshCw data-icon="inline-start" />
            {pendingCount > 0
              ? i18nService.t('managedMemoryRetryPending').replace('{count}', String(pendingCount))
              : i18nService.t('refresh')}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex flex-col gap-2" aria-label={i18nService.t('loading')}>
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : records.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Brain />
              </EmptyMedia>
              <EmptyTitle>{i18nService.t('managedMemoryEmptyTitle')}</EmptyTitle>
              <EmptyDescription>{i18nService.t('managedMemoryEmptyDescription')}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button type="button" variant="outline" onClick={() => void load()}>
                <RefreshCw data-icon="inline-start" />
                {i18nService.t('refresh')}
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{i18nService.t('managedMemoryColumnMemory')}</TableHead>
                  <TableHead>{i18nService.t('managedMemoryColumnScope')}</TableHead>
                  <TableHead>{i18nService.t('managedMemoryColumnStatus')}</TableHead>
                  <TableHead>{i18nService.t('managedMemoryColumnSource')}</TableHead>
                  <TableHead className="text-right">
                    {i18nService.t('managedMemoryColumnActions')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map(record => (
                  <TableRow key={record.id}>
                    <TableCell className="max-w-md whitespace-normal">
                      <div className="flex flex-col gap-1">
                        <div className="font-medium text-foreground">{record.title}</div>
                        <div className="text-sm text-muted-foreground">{record.content}</div>
                        {record.sensitivity === MemorySensitivity.Sensitive && (
                          <Badge variant="outline">
                            <ShieldAlert data-icon="inline-start" />
                            {i18nService.t('managedMemorySensitive')}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{scopeLabel(record.scope)}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <Badge variant={statusVariant(record.status)}>
                          {statusLabel(record.status)}
                        </Badge>
                        {record.deliveryStatus === MemoryDeliveryStatus.Pending && (
                          <Badge variant="secondary">
                            {i18nService.t('managedMemoryPropagationPending')}
                          </Badge>
                        )}
                        {record.deliveryError && (
                          <span className="text-xs text-destructive">{record.deliveryError}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                        <span>{sourceLabel(record)}</span>
                        <span>{formatDate(record.updatedAt)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {record.status === MemoryLifecycleStatus.NeedsReview && (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() =>
                              void runAction(
                                record.id,
                                () => memoryService.confirmCandidate(record.id),
                                'managedMemoryConfirmed',
                              )
                            }
                            disabled={
                              busyId !== null ||
                              record.deliveryStatus === MemoryDeliveryStatus.Pending
                            }
                          >
                            <Check data-icon="inline-start" />
                            {i18nService.t('managedMemoryConfirm')}
                          </Button>
                        )}
                        {record.status === MemoryLifecycleStatus.Active && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              void runAction(
                                record.id,
                                () => memoryService.archive(record.id),
                                'managedMemoryArchived',
                              )
                            }
                            disabled={busyId !== null}
                          >
                            <Archive data-icon="inline-start" />
                            {i18nService.t('managedMemoryStopUsing')}
                          </Button>
                        )}
                        {(record.status === MemoryLifecycleStatus.Archived ||
                          record.status === MemoryLifecycleStatus.Expired) && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              void runAction(
                                record.id,
                                () => memoryService.restore(record.id),
                                'managedMemoryRestored',
                              )
                            }
                            disabled={busyId !== null}
                          >
                            <RotateCcw data-icon="inline-start" />
                            {i18nService.t('managedMemoryRestore')}
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={i18nService.t('delete')}
                          onClick={() => setForgetTarget({ record })}
                          disabled={busyId !== null}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={forgetTarget !== null} onOpenChange={open => !open && setForgetTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{i18nService.t('managedMemoryForgetTitle')}</DialogTitle>
            <DialogDescription>
              {forgetTarget?.record.memoryId === null
                ? i18nService.t('managedMemoryRejectDescription')
                : i18nService.t('managedMemoryForgetDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setForgetTarget(null)}>
              {i18nService.t('cancel')}
            </Button>
            {forgetTarget?.record.status !== MemoryLifecycleStatus.Deleted && (
              <Button type="button" variant="destructive" onClick={() => void handleForget(false)}>
                {forgetTarget?.record.memoryId === null
                  ? i18nService.t('managedMemoryRejectCandidate')
                  : i18nService.t('managedMemorySoftDelete')}
              </Button>
            )}
            {forgetTarget?.record.memoryId !== null && (
              <Button type="button" variant="destructive" onClick={() => void handleForget(true)}>
                {i18nService.t('managedMemoryHardDelete')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function scopeLabel(scope: ManagedMemoryRecord['scope']): string {
  if (scope === MemoryScope.Personal) return i18nService.t('managedMemoryScopePersonal');
  if (scope === MemoryScope.Session) return i18nService.t('managedMemoryScopeSession');
  return i18nService.t('managedMemoryScopeProject');
}

function statusLabel(status: ManagedMemoryRecord['status']): string {
  const keys: Record<ManagedMemoryRecord['status'], string> = {
    [MemoryLifecycleStatus.Active]: 'managedMemoryStatusActive',
    [MemoryLifecycleStatus.NeedsReview]: 'managedMemoryStatusNeedsReview',
    [MemoryLifecycleStatus.Superseded]: 'managedMemoryStatusSuperseded',
    [MemoryLifecycleStatus.Expired]: 'managedMemoryStatusExpired',
    [MemoryLifecycleStatus.Archived]: 'managedMemoryStatusArchived',
    [MemoryLifecycleStatus.Deleted]: 'managedMemoryStatusDeleted',
  };
  return i18nService.t(keys[status]);
}

function statusVariant(status: ManagedMemoryRecord['status']): 'default' | 'secondary' | 'outline' {
  if (status === MemoryLifecycleStatus.Active) return 'default';
  if (status === MemoryLifecycleStatus.NeedsReview) return 'secondary';
  return 'outline';
}

function sourceLabel(record: ManagedMemoryRecord): string {
  const id = record.taskId ?? record.runId ?? record.sessionId;
  return i18nService.t('managedMemorySource').replace('{id}', id);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(i18nService.getLanguage() === 'zh' ? 'zh-CN' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
