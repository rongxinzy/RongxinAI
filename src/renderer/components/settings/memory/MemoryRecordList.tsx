import { useMemo, useState } from 'react';
import {
  Archive,
  Brain,
  Check,
  EllipsisVertical,
  Funnel,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  Trash2,
} from 'lucide-react';

import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@shared/components/ui/empty';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@shared/components/ui/input-group';
import { ScrollArea } from '@shared/components/ui/scroll-area';
import { Separator } from '@shared/components/ui/separator';
import { Skeleton } from '@shared/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/components/ui/tooltip';
import {
  MemoryDeliveryStatus,
  MemoryKind,
  MemoryLifecycleStatus,
  MemoryScope,
  MemorySensitivity,
  MemorySourceKind,
  type ManagedMemoryRecord,
} from '../../../../shared/memory';
import { i18nService } from '../../../services/i18n';
import OverflowingSessionTitle from '../../agentSidebar/OverflowingSessionTitle';
import {
  ManagedMemoryScopeFilter,
  ManagedMemoryStatusFilter,
  ManagedMemoryView,
  type ManagedMemoryScopeFilter as ManagedMemoryScopeFilterValue,
  type ManagedMemoryStatusFilter as ManagedMemoryStatusFilterValue,
  type ManagedMemoryView as ManagedMemoryViewValue,
} from './constants';
import {
  countManagedMemories,
  filterAndSortManagedMemories,
  isLegacySessionSummaryAwaitingUpgrade,
} from './memoryViewModel';

interface MemoryRecordListProps {
  view: ManagedMemoryViewValue;
  workspaceName: string;
  records: ManagedMemoryRecord[];
  sessionTitles: ReadonlyMap<string, string>;
  loading: boolean;
  busy: boolean;
  onCreate: () => void;
  onEdit: (record: ManagedMemoryRecord) => void;
  onConfirm: (record: ManagedMemoryRecord) => void;
  onArchive: (record: ManagedMemoryRecord) => void;
  onRestore: (record: ManagedMemoryRecord) => void;
  onForget: (record: ManagedMemoryRecord) => void;
}

interface MemoryRecordActionProps {
  record: ManagedMemoryRecord;
  busy: boolean;
  inlineLifecycleActions?: boolean;
  onEdit: () => void;
  onConfirm: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onForget: () => void;
}

export function MemoryRecordList(props: MemoryRecordListProps) {
  const {
    view,
    workspaceName,
    records,
    sessionTitles,
    loading,
    busy,
    onCreate,
    onEdit,
    onConfirm,
    onArchive,
    onRestore,
    onForget,
  } = props;
  const [scope, setScope] = useState<ManagedMemoryScopeFilterValue>(ManagedMemoryScopeFilter.All);
  const [status, setStatus] = useState<ManagedMemoryStatusFilterValue>(
    ManagedMemoryStatusFilter.All,
  );
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const counts = useMemo(() => countManagedMemories(records), [records]);
  const activeFilterCount =
    Number(status !== ManagedMemoryStatusFilter.All) +
    Number(scope !== ManagedMemoryScopeFilter.All);
  const filteredRecords = useMemo(
    () =>
      filterAndSortManagedMemories(records, {
        view,
        scope: view === ManagedMemoryView.LongTerm ? scope : ManagedMemoryScopeFilter.All,
        status,
        query,
      }),
    [query, records, scope, status, view],
  );
  const viewTotal = view === ManagedMemoryView.LongTerm ? counts.longTerm : counts.session;
  const readOnly = view === ManagedMemoryView.Session;
  const selectedRecord = useMemo(
    () => records.find(record => record.id === selectedId) ?? null,
    [records, selectedId],
  );

  const actionProps = (record: ManagedMemoryRecord) => ({
    busy,
    onEdit: () => onEdit(record),
    onConfirm: () => onConfirm(record),
    onArchive: () => onArchive(record),
    onRestore: () => onRestore(record),
    onForget: () => onForget(record),
  });

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex shrink-0 items-center gap-2">
          <InputGroup className="min-w-0 flex-1">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={i18nService.t(
                readOnly
                  ? 'managedMemorySessionSearchPlaceholder'
                  : 'managedMemorySearchPlaceholder',
              )}
              aria-label={i18nService.t(
                readOnly
                  ? 'managedMemorySessionSearchPlaceholder'
                  : 'managedMemorySearchPlaceholder',
              )}
            />
          </InputGroup>
          {!readOnly && (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" variant="outline" />}>
                <Funnel data-icon="inline-start" />
                {activeFilterCount > 0
                  ? i18nService
                      .t('managedMemoryFilterActive')
                      .replace('{count}', String(activeFilterCount))
                  : i18nService.t('managedMemoryFilter')}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{i18nService.t('managedMemoryFieldScope')}</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={scope}
                    onValueChange={value => setScope(value as ManagedMemoryScopeFilterValue)}
                  >
                    <DropdownMenuRadioItem value={ManagedMemoryScopeFilter.All}>
                      {i18nService.t('managedMemoryFilterScopeAll')}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value={ManagedMemoryScopeFilter.Personal}>
                      {i18nService.t('managedMemoryScopePersonal')}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value={ManagedMemoryScopeFilter.Project}>
                      {i18nService.t('managedMemoryScopeProject')}
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    {i18nService.t('managedMemoryColumnStatus')}
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={status}
                    onValueChange={value => setStatus(value as ManagedMemoryStatusFilterValue)}
                  >
                    <DropdownMenuRadioItem value={ManagedMemoryStatusFilter.All}>
                      {i18nService.t('managedMemoryFilterStatusAll')}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value={ManagedMemoryStatusFilter.NeedsReview}>
                      {i18nService.t('managedMemoryStatusNeedsReview')}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value={ManagedMemoryStatusFilter.Active}>
                      {i18nService.t('managedMemoryStatusActive')}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value={ManagedMemoryStatusFilter.Inactive}>
                      {i18nService.t('managedMemoryFilterStatusInactive')}
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {loading ? (
          <div
            className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
            style={{ scrollbarGutter: 'stable' }}
          >
            <div className="pr-3">
              <MemoryListSkeleton />
            </div>
          </div>
        ) : (
          <div
            className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
            style={{ scrollbarGutter: 'stable' }}
          >
            <div className="pr-3 pb-1">
              <MemoryRows
                records={filteredRecords}
                viewTotal={viewTotal}
                view={view}
                busy={busy}
                readOnly={readOnly}
                workspaceName={workspaceName}
                sessionTitles={sessionTitles}
                onCreate={onCreate}
                onSelect={record => setSelectedId(record.id)}
                actionProps={actionProps}
              />
            </div>
          </div>
        )}
      </div>

      <MemoryDetailsDialog
        record={selectedRecord}
        sessionTitles={sessionTitles}
        workspaceName={workspaceName}
        busy={busy}
        readOnly={readOnly}
        onClose={() => setSelectedId(null)}
        onEdit={record => {
          setSelectedId(null);
          onEdit(record);
        }}
        onConfirm={onConfirm}
        onArchive={onArchive}
        onRestore={onRestore}
        onForget={record => {
          setSelectedId(null);
          onForget(record);
        }}
      />
    </>
  );
}

function MemoryRows(props: {
  records: ManagedMemoryRecord[];
  viewTotal: number;
  view: ManagedMemoryViewValue;
  busy: boolean;
  readOnly: boolean;
  workspaceName: string;
  sessionTitles: ReadonlyMap<string, string>;
  onCreate: () => void;
  onSelect: (record: ManagedMemoryRecord) => void;
  actionProps: (record: ManagedMemoryRecord) => Omit<MemoryRecordActionProps, 'record'>;
}) {
  const {
    records,
    viewTotal,
    view,
    busy,
    readOnly,
    workspaceName,
    sessionTitles,
    onCreate,
    onSelect,
    actionProps,
  } = props;
  if (viewTotal === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Brain />
          </EmptyMedia>
          <EmptyTitle>{i18nService.t('managedMemoryEmptyTitle')}</EmptyTitle>
          <EmptyDescription>
            {view === ManagedMemoryView.Session
              ? i18nService.t('managedMemorySessionEmptyDescription')
              : i18nService.t('managedMemoryEmptyDescription')}
          </EmptyDescription>
        </EmptyHeader>
        {view === ManagedMemoryView.LongTerm && (
          <EmptyContent>
            <Button type="button" variant="outline" onClick={onCreate} disabled={busy}>
              <Plus data-icon="inline-start" />
              {i18nService.t('managedMemoryCreate')}
            </Button>
          </EmptyContent>
        )}
      </Empty>
    );
  }
  if (records.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        {i18nService.t('managedMemorySearchEmptyDescription')}
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {records.map((record, index) => (
        <div key={record.id}>
          {index > 0 && <Separator />}
          <div className="flex min-w-0 items-start gap-2 px-3 py-2.5 transition-colors hover:bg-muted">
            <Button
              type="button"
              variant="ghost"
              className="theme-control-sizing-4 theme-control-content-height min-w-0 flex-1 items-start justify-start text-left"
              onClick={() => onSelect(record)}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex min-w-0 items-center gap-2">
                  {readOnly ? (
                    <OverflowingSessionTitle
                      title={displayTitle(record, sessionTitles, workspaceName)}
                    />
                  ) : (
                    <span className="truncate font-medium text-foreground">
                      {displayTitle(record, sessionTitles, workspaceName)}
                    </span>
                  )}
                  {!readOnly && <StatusBadge record={record} />}
                  {isLegacySessionSummaryAwaitingUpgrade(record) && (
                    <Badge variant="outline">
                      {i18nService.t('managedMemoryLegacySummaryPendingUpgrade')}
                    </Badge>
                  )}
                </div>
                <p className="truncate text-sm text-muted-foreground">{record.content}</p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  {!readOnly && (
                    <>
                      <span>{scopeLabel(record.scope)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{kindLabel(record.kind)}</span>
                      <span aria-hidden="true">·</span>
                    </>
                  )}
                  <span>{formatDate(record.updatedAt)}</span>
                  {record.sensitivity === MemorySensitivity.Sensitive && (
                    <span className="inline-flex items-center gap-1">
                      <ShieldAlert className="size-3" />
                      {i18nService.t('managedMemorySensitive')}
                    </span>
                  )}
                </div>
              </div>
            </Button>
            {!readOnly && <MemoryRecordActions record={record} {...actionProps(record)} />}
          </div>
        </div>
      ))}
    </div>
  );
}

function MemoryRecordActions(props: MemoryRecordActionProps) {
  const {
    record,
    busy,
    inlineLifecycleActions = false,
    onEdit,
    onConfirm,
    onArchive,
    onRestore,
    onForget,
  } = props;
  const editable = canEdit(record);
  const active = record.status === MemoryLifecycleStatus.Active;
  const restorable =
    record.status === MemoryLifecycleStatus.Archived ||
    record.status === MemoryLifecycleStatus.Expired;
  const hasPrimaryMenuActions = !inlineLifecycleActions && (editable || active || restorable);
  const confirmDisabled = busy || record.deliveryStatus === MemoryDeliveryStatus.Pending;
  return (
    <div className="flex shrink-0 items-center gap-1">
      {record.status === MemoryLifecycleStatus.NeedsReview && inlineLifecycleActions && (
        <Button type="button" size="sm" onClick={onConfirm} disabled={confirmDisabled}>
          <Check data-icon="inline-start" />
          {i18nService.t('managedMemoryConfirm')}
        </Button>
      )}
      {record.status === MemoryLifecycleStatus.NeedsReview && !inlineLifecycleActions && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={onConfirm}
                aria-label={i18nService.t('managedMemoryConfirm')}
                disabled={confirmDisabled}
              />
            }
          >
            <Check />
          </TooltipTrigger>
          <TooltipContent>{i18nService.t('managedMemoryConfirm')}</TooltipContent>
        </Tooltip>
      )}
      {inlineLifecycleActions && editable && (
        <Button type="button" variant="outline" size="sm" onClick={onEdit} disabled={busy}>
          <Pencil data-icon="inline-start" />
          {i18nService.t('edit')}
        </Button>
      )}
      {inlineLifecycleActions && active && (
        <Button type="button" variant="outline" size="sm" onClick={onArchive} disabled={busy}>
          <Archive data-icon="inline-start" />
          {i18nService.t('managedMemoryStopUsing')}
        </Button>
      )}
      {inlineLifecycleActions && restorable && (
        <Button type="button" variant="outline" size="sm" onClick={onRestore} disabled={busy}>
          <RotateCcw data-icon="inline-start" />
          {i18nService.t('managedMemoryRestore')}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={i18nService.t('managedMemoryMoreActions')}
              disabled={busy}
            />
          }
        >
          <EllipsisVertical />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {hasPrimaryMenuActions && (
            <DropdownMenuGroup>
              {editable && (
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil />
                  {i18nService.t('edit')}
                </DropdownMenuItem>
              )}
              {active && (
                <DropdownMenuItem onClick={onArchive}>
                  <Archive />
                  {i18nService.t('managedMemoryStopUsing')}
                </DropdownMenuItem>
              )}
              {restorable && (
                <DropdownMenuItem onClick={onRestore}>
                  <RotateCcw />
                  {i18nService.t('managedMemoryRestore')}
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          )}
          {hasPrimaryMenuActions && <DropdownMenuSeparator />}
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onClick={onForget}>
              <Trash2 />
              {record.memoryId === null
                ? i18nService.t('managedMemoryRejectCandidate')
                : i18nService.t('delete')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function MemoryDetailsDialog(props: {
  record: ManagedMemoryRecord | null;
  sessionTitles: ReadonlyMap<string, string>;
  workspaceName: string;
  busy: boolean;
  readOnly: boolean;
  onClose: () => void;
  onEdit: (record: ManagedMemoryRecord) => void;
  onConfirm: (record: ManagedMemoryRecord) => void;
  onArchive: (record: ManagedMemoryRecord) => void;
  onRestore: (record: ManagedMemoryRecord) => void;
  onForget: (record: ManagedMemoryRecord) => void;
}) {
  const {
    record,
    sessionTitles,
    workspaceName,
    busy,
    readOnly,
    onClose,
    onEdit,
    onConfirm,
    onArchive,
    onRestore,
    onForget,
  } = props;
  return (
    <Dialog open={record !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] min-h-0 flex-col overflow-hidden sm:max-w-xl">
        <DialogHeader className="theme-control-sizing-19 shrink-0">
          <DialogTitle>
            {record
              ? displayTitle(record, sessionTitles, workspaceName)
              : i18nService.t('managedMemoryTitle')}
          </DialogTitle>
          <DialogDescription>{i18nService.t('managedMemoryDetailDescription')}</DialogDescription>
        </DialogHeader>
        {record && (
          <ScrollArea className="h-[min(55vh,28rem)] min-h-0">
            <div className="flex flex-col gap-5 pr-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge record={record} />
                {isLegacySessionSummaryAwaitingUpgrade(record) && (
                  <Badge variant="outline">
                    {i18nService.t('managedMemoryLegacySummaryPendingUpgrade')}
                  </Badge>
                )}
                <Badge variant="outline">{scopeLabel(record.scope)}</Badge>
                <Badge variant="outline">{kindLabel(record.kind)}</Badge>
                {record.sensitivity === MemorySensitivity.Sensitive && (
                  <Badge variant="outline">
                    <ShieldAlert data-icon="inline-start" />
                    {i18nService.t('managedMemorySensitive')}
                  </Badge>
                )}
              </div>
              <section className="flex flex-col gap-2">
                <h4 className="text-sm font-medium text-foreground">
                  {i18nService.t('managedMemoryFieldContent')}
                </h4>
                <p className="whitespace-pre-wrap wrap-break-word text-sm text-foreground">
                  {record.content}
                </p>
              </section>
              <Separator />
              <dl className="grid gap-4 sm:grid-cols-2">
                <MemoryDetail label={i18nService.t('managedMemoryColumnSource')}>
                  {sourceLabel(record, sessionTitles)}
                </MemoryDetail>
                <MemoryDetail label={i18nService.t('managedMemoryDetailUpdated')}>
                  {formatDate(record.updatedAt)}
                </MemoryDetail>
                {record.deliveryStatus && (
                  <MemoryDetail label={i18nService.t('managedMemoryDetailDelivery')}>
                    {deliveryLabel(record.deliveryStatus)}
                  </MemoryDetail>
                )}
                {record.deliveryError && (
                  <MemoryDetail label={i18nService.t('managedMemoryPropagationFailed')}>
                    {record.deliveryError}
                  </MemoryDetail>
                )}
              </dl>
            </div>
          </ScrollArea>
        )}
        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" onClick={onClose}>
            {i18nService.t('close')}
          </Button>
          {record && !readOnly && (
            <MemoryRecordActions
              record={record}
              busy={busy}
              inlineLifecycleActions
              onEdit={() => onEdit(record)}
              onConfirm={() => onConfirm(record)}
              onArchive={() => onArchive(record)}
              onRestore={() => onRestore(record)}
              onForget={() => onForget(record)}
            />
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MemoryDetail(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{props.label}</dt>
      <dd className="mt-1 wrap-break-word text-sm text-foreground">{props.children}</dd>
    </div>
  );
}

function MemoryListSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-label={i18nService.t('loading')}>
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

function StatusBadge({ record }: { record: ManagedMemoryRecord }) {
  if (record.deliveryStatus === MemoryDeliveryStatus.Failed) {
    return <Badge variant="destructive">{i18nService.t('managedMemoryPropagationFailed')}</Badge>;
  }
  if (record.deliveryStatus === MemoryDeliveryStatus.Pending) {
    return <Badge variant="secondary">{i18nService.t('managedMemoryPropagationPending')}</Badge>;
  }
  return <Badge variant={statusVariant(record.status)}>{statusLabel(record.status)}</Badge>;
}

function canEdit(record: ManagedMemoryRecord): boolean {
  return (
    record.scope !== MemoryScope.Session &&
    (record.status === MemoryLifecycleStatus.Active ||
      record.status === MemoryLifecycleStatus.NeedsReview) &&
    record.deliveryStatus !== MemoryDeliveryStatus.Pending
  );
}

function displayTitle(
  record: ManagedMemoryRecord,
  sessionTitles: ReadonlyMap<string, string>,
  workspaceName: string,
): string {
  if (record.scope !== MemoryScope.Session) return record.title;
  const sessionTitle =
    sessionTitles.get(record.sessionId)?.trim() ||
    record.title.trim() ||
    i18nService.t('managedMemorySessionSummaryTitle');
  return workspaceName ? `${workspaceName} - ${sessionTitle}` : sessionTitle;
}

function scopeLabel(scope: ManagedMemoryRecord['scope']): string {
  if (scope === MemoryScope.Personal) return i18nService.t('managedMemoryScopePersonal');
  if (scope === MemoryScope.Session) return i18nService.t('managedMemoryScopeSession');
  return i18nService.t('managedMemoryScopeProject');
}

function kindLabel(kind: ManagedMemoryRecord['kind']): string {
  if (kind === MemoryKind.Preference) return i18nService.t('managedMemoryKindPreference');
  if (kind === MemoryKind.SessionSummary) {
    return i18nService.t('managedMemoryKindSessionSummary');
  }
  return i18nService.t('managedMemoryKindDecision');
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

function statusVariant(status: ManagedMemoryRecord['status']): 'secondary' | 'outline' {
  return status === MemoryLifecycleStatus.NeedsReview ? 'secondary' : 'outline';
}

function deliveryLabel(status: NonNullable<ManagedMemoryRecord['deliveryStatus']>): string {
  if (status === MemoryDeliveryStatus.Pending) {
    return i18nService.t('managedMemoryPropagationPending');
  }
  if (status === MemoryDeliveryStatus.Failed) {
    return i18nService.t('managedMemoryPropagationFailed');
  }
  return i18nService.t('managedMemoryPropagationCompleted');
}

function sourceLabel(
  record: ManagedMemoryRecord,
  sessionTitles: ReadonlyMap<string, string>,
): string {
  if (record.sourceKind === MemorySourceKind.LegacyFileImport) {
    return i18nService.t('managedMemorySourceLegacyFile');
  }
  if (record.sourceKind === MemorySourceKind.LegacySqliteImport) {
    return i18nService.t('managedMemorySourceLegacySqlite');
  }
  if (record.sourceKind === MemorySourceKind.Explicit) {
    return i18nService.t('managedMemorySourceManual');
  }
  if (record.promotedFromLinkId) {
    if (record.promotionSourceSessionId) {
      const sessionTitle = sessionTitles.get(record.promotionSourceSessionId)?.trim();
      return i18nService
        .t('managedMemoryPromotedFromSession')
        .replace('{name}', sessionTitle || shortenIdentifier(record.promotionSourceSessionId));
    }
    return i18nService.t('managedMemoryPromotedFromWorkspace');
  }
  const sourceSessionId = record.sessionId;
  const sessionTitle = sessionTitles.get(sourceSessionId)?.trim();
  if (sessionTitle) return sessionTitle;
  return sourceSessionId
    ? shortenIdentifier(sourceSessionId)
    : i18nService.t('managedMemorySourceUnavailable');
}

function shortenIdentifier(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(i18nService.getLanguage() === 'zh' ? 'zh-CN' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
