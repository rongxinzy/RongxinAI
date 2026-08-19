import { useMemo, useState } from 'react';
import {
  Archive,
  Brain,
  Check,
  EllipsisVertical,
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { Separator } from '@shared/components/ui/separator';
import { Skeleton } from '@shared/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/components/ui/tabs';
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
  const [view, setView] = useState<ManagedMemoryViewValue>(ManagedMemoryView.LongTerm);
  const [scope, setScope] = useState<ManagedMemoryScopeFilterValue>(ManagedMemoryScopeFilter.All);
  const [status, setStatus] = useState<ManagedMemoryStatusFilterValue>(
    ManagedMemoryStatusFilter.All,
  );
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const counts = useMemo(() => countManagedMemories(records), [records]);
  const longTermRecords = useMemo(
    () =>
      filterAndSortManagedMemories(records, {
        view: ManagedMemoryView.LongTerm,
        scope,
        status,
        query,
      }),
    [query, records, scope, status],
  );
  const sessionRecords = useMemo(
    () =>
      filterAndSortManagedMemories(records, {
        view: ManagedMemoryView.Session,
        scope: ManagedMemoryScopeFilter.All,
        status,
        query,
      }),
    [query, records, status],
  );
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
      <Tabs
        value={view}
        onValueChange={value => setView(value as ManagedMemoryViewValue)}
        className="min-h-0 flex-1 gap-3"
      >
        <TabsList variant="line" className="w-full shrink-0 justify-start">
          <TabsTrigger value={ManagedMemoryView.LongTerm}>
            {i18nService.t('managedMemoryTabLongTerm')}
            <Badge variant="secondary">{counts.longTerm}</Badge>
          </TabsTrigger>
          <TabsTrigger value={ManagedMemoryView.Session}>
            {i18nService.t('managedMemoryTabSessions')}
            <Badge variant="secondary">{counts.session}</Badge>
          </TabsTrigger>
        </TabsList>

        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <InputGroup className="sm:flex-1">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={i18nService.t('managedMemorySearchPlaceholder')}
              aria-label={i18nService.t('managedMemorySearchPlaceholder')}
            />
          </InputGroup>
          {view === ManagedMemoryView.LongTerm && (
            <Select
              value={scope}
              onValueChange={value => setScope(value as ManagedMemoryScopeFilterValue)}
            >
              <SelectTrigger className="w-full sm:w-32" aria-label={scopeFilterLabel(scope)}>
                <SelectValue>{scopeFilterLabel(scope)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={ManagedMemoryScopeFilter.All}>
                    {i18nService.t('managedMemoryFilterScopeAll')}
                  </SelectItem>
                  <SelectItem value={ManagedMemoryScopeFilter.Personal}>
                    {i18nService.t('managedMemoryScopePersonal')}
                  </SelectItem>
                  <SelectItem value={ManagedMemoryScopeFilter.Project}>
                    {i18nService.t('managedMemoryScopeProject')}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
          <Select
            value={status}
            onValueChange={value => setStatus(value as ManagedMemoryStatusFilterValue)}
          >
            <SelectTrigger className="w-full sm:w-32" aria-label={statusFilterLabel(status)}>
              <SelectValue>{statusFilterLabel(status)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={ManagedMemoryStatusFilter.All}>
                  {i18nService.t('managedMemoryFilterStatusAll')}
                </SelectItem>
                <SelectItem value={ManagedMemoryStatusFilter.NeedsReview}>
                  {i18nService.t('managedMemoryStatusNeedsReview')}
                </SelectItem>
                <SelectItem value={ManagedMemoryStatusFilter.Active}>
                  {i18nService.t('managedMemoryStatusActive')}
                </SelectItem>
                <SelectItem value={ManagedMemoryStatusFilter.Inactive}>
                  {i18nService.t('managedMemoryFilterStatusInactive')}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
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
          <>
            <TabsContent
              value={ManagedMemoryView.LongTerm}
              className="min-h-0 overflow-x-hidden overflow-y-auto"
              style={{ scrollbarGutter: 'stable' }}
            >
              <div className="pr-3 pb-1">
                <MemoryRows
                  records={longTermRecords}
                  viewTotal={counts.longTerm}
                  view={ManagedMemoryView.LongTerm}
                  busy={busy}
                  onCreate={onCreate}
                  onSelect={record => setSelectedId(record.id)}
                  actionProps={actionProps}
                />
              </div>
            </TabsContent>
            <TabsContent
              value={ManagedMemoryView.Session}
              className="min-h-0 overflow-x-hidden overflow-y-auto"
              style={{ scrollbarGutter: 'stable' }}
            >
              <div className="pr-3 pb-1">
                <MemoryRows
                  records={sessionRecords}
                  viewTotal={counts.session}
                  view={ManagedMemoryView.Session}
                  busy={busy}
                  onCreate={onCreate}
                  onSelect={record => setSelectedId(record.id)}
                  actionProps={actionProps}
                />
              </div>
            </TabsContent>
          </>
        )}
      </Tabs>

      <MemoryDetailsDialog
        record={selectedRecord}
        sessionTitles={sessionTitles}
        busy={busy}
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
  onCreate: () => void;
  onSelect: (record: ManagedMemoryRecord) => void;
  actionProps: (record: ManagedMemoryRecord) => Omit<MemoryRecordActionProps, 'record'>;
}) {
  const { records, viewTotal, view, busy, onCreate, onSelect, actionProps } = props;
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
          <div className="flex min-w-0 items-start gap-2 px-3 py-3 transition-colors hover:bg-muted">
            <Button
              type="button"
              variant="ghost"
              className="h-auto min-w-0 flex-1 items-start justify-start p-0 text-left"
              onClick={() => onSelect(record)}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium text-foreground">
                    {displayTitle(record)}
                  </span>
                  <StatusBadge record={record} />
                  {isLegacySessionSummaryAwaitingUpgrade(record) && (
                    <Badge variant="outline">
                      {i18nService.t('managedMemoryLegacySummaryPendingUpgrade')}
                    </Badge>
                  )}
                </div>
                <p className="line-clamp-2 whitespace-normal wrap-break-word text-sm text-muted-foreground">
                  {record.content}
                </p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span>{scopeLabel(record.scope)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{kindLabel(record.kind)}</span>
                  <span aria-hidden="true">·</span>
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
            <MemoryRecordActions record={record} {...actionProps(record)} />
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
  return (
    <div className="flex shrink-0 items-center gap-1">
      {record.status === MemoryLifecycleStatus.NeedsReview && (
        <Button
          type="button"
          size="sm"
          className="px-2 sm:px-3"
          onClick={onConfirm}
          aria-label={i18nService.t('managedMemoryConfirm')}
          disabled={busy || record.deliveryStatus === MemoryDeliveryStatus.Pending}
        >
          <Check data-icon="inline-start" />
          <span className="hidden sm:inline">{i18nService.t('managedMemoryConfirm')}</span>
        </Button>
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
  busy: boolean;
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
    busy,
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
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>
            {record ? displayTitle(record) : i18nService.t('managedMemoryTitle')}
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
          {record && (
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
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
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

function displayTitle(record: ManagedMemoryRecord): string {
  return record.scope === MemoryScope.Session
    ? i18nService.t('managedMemorySessionSummaryTitle')
    : record.title;
}

function scopeFilterLabel(scope: ManagedMemoryScopeFilterValue): string {
  if (scope === ManagedMemoryScopeFilter.Personal) {
    return i18nService.t('managedMemoryScopePersonal');
  }
  if (scope === ManagedMemoryScopeFilter.Project) {
    return i18nService.t('managedMemoryScopeProject');
  }
  return i18nService.t('managedMemoryFilterScopeAll');
}

function statusFilterLabel(status: ManagedMemoryStatusFilterValue): string {
  if (status === ManagedMemoryStatusFilter.NeedsReview) {
    return i18nService.t('managedMemoryStatusNeedsReview');
  }
  if (status === ManagedMemoryStatusFilter.Active) {
    return i18nService.t('managedMemoryStatusActive');
  }
  if (status === ManagedMemoryStatusFilter.Inactive) {
    return i18nService.t('managedMemoryFilterStatusInactive');
  }
  return i18nService.t('managedMemoryFilterStatusAll');
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
