import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Brain,
  Check,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
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
import { Field, FieldGroup, FieldLabel } from '@shared/components/ui/field';
import { Input } from '@shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { Skeleton } from '@shared/components/ui/skeleton';
import { Spinner } from '@shared/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shared/components/ui/table';
import { Textarea } from '@shared/components/ui/textarea';
import {
  MemoryDeliveryStatus,
  MemoryKind,
  MemoryLifecycleStatus,
  MemoryScope,
  MemorySensitivity,
  MemorySourceKind,
  type ManagedMemoryRecord,
  type ManualMemoryScope,
} from '../../../../shared/memory';
import { i18nService } from '../../../services/i18n';
import { memoryService } from '../../../services/memory';

const EDITOR_BUSY_ID = 'memory-editor';
const OUTBOX_BUSY_ID = 'memory-outbox';

interface ManagedMemorySettingsProps {
  workingDirectory: string;
}

interface ForgetTarget {
  record: ManagedMemoryRecord;
}

interface MemoryDraft {
  scope: ManualMemoryScope;
  title: string;
  content: string;
  kind: typeof MemoryKind.Decision | typeof MemoryKind.Preference;
  sensitivity: typeof MemorySensitivity.Normal | typeof MemorySensitivity.Sensitive;
}

interface MemoryEditor {
  record: ManagedMemoryRecord | null;
  draft: MemoryDraft;
}

const emptyDraft = (): MemoryDraft => ({
  scope: MemoryScope.Personal,
  title: '',
  content: '',
  kind: MemoryKind.Preference,
  sensitivity: MemorySensitivity.Normal,
});

export function ManagedMemorySettings({ workingDirectory }: ManagedMemorySettingsProps) {
  const [records, setRecords] = useState<ManagedMemoryRecord[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editor, setEditor] = useState<MemoryEditor | null>(null);
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

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return records;
    return records.filter(
      record =>
        record.title.toLocaleLowerCase().includes(normalizedQuery) ||
        record.content.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [query, records]);

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
    setBusyId(OUTBOX_BUSY_ID);
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

  const openCreateEditor = () => setEditor({ record: null, draft: emptyDraft() });

  const openEditEditor = (record: ManagedMemoryRecord) => {
    if (record.scope === MemoryScope.Session) return;
    setEditor({
      record,
      draft: {
        scope: record.scope,
        title: record.title,
        content: record.content,
        kind:
          record.kind === MemoryKind.Preference ? MemoryKind.Preference : MemoryKind.Decision,
        sensitivity: record.sensitivity,
      },
    });
  };

  const updateDraft = (patch: Partial<MemoryDraft>) => {
    setEditor(current =>
      current ? { ...current, draft: { ...current.draft, ...patch } } : current,
    );
  };

  const handleSaveEditor = async () => {
    if (!editor) return;
    const title = editor.draft.title.trim();
    const content = editor.draft.content.trim();
    if (!title || !content) return;
    setBusyId(EDITOR_BUSY_ID);
    try {
      if (editor.record) {
        await memoryService.updateManual({
          id: editor.record.id,
          workingDirectory,
          title,
          content,
          kind: editor.draft.kind,
          sensitivity: editor.draft.sensitivity,
        });
        toast.success(i18nService.t('managedMemoryUpdated'));
      } else {
        await memoryService.createManual({
          workingDirectory,
          scope: editor.draft.scope,
          title,
          content,
          kind: editor.draft.kind,
          sensitivity: editor.draft.sensitivity,
        });
        toast.success(i18nService.t('managedMemoryCreated'));
      }
      setEditor(null);
      await load();
    } catch (error) {
      toast.error(i18nService.t('managedMemorySaveFailed'));
      console.error('[ManagedMemory] Failed to save manual memory:', error);
    } finally {
      setBusyId(null);
    }
  };

  const canEdit = (record: ManagedMemoryRecord) =>
    record.scope !== MemoryScope.Session &&
    (record.status === MemoryLifecycleStatus.Active ||
      record.status === MemoryLifecycleStatus.NeedsReview) &&
    record.deliveryStatus !== MemoryDeliveryStatus.Pending;

  return (
    <Card>
      <CardHeader className="has-data-[slot=card-action]:grid-cols-1 sm:has-data-[slot=card-action]:grid-cols-[1fr_auto]">
        <CardTitle>{i18nService.t('managedMemoryTitle')}</CardTitle>
        <CardDescription>{i18nService.t('managedMemoryDescription')}</CardDescription>
        <CardAction className="col-start-1 row-start-3 row-span-1 justify-self-start pt-2 sm:col-start-2 sm:row-start-1 sm:row-span-2 sm:justify-self-end sm:pt-0">
          <div className="flex items-center gap-2">
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
            <Button type="button" size="sm" onClick={openCreateEditor} disabled={busyId !== null}>
              <Plus data-icon="inline-start" />
              {i18nService.t('managedMemoryCreate')}
            </Button>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Input
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={i18nService.t('managedMemorySearchPlaceholder')}
          aria-label={i18nService.t('managedMemorySearchPlaceholder')}
        />
        {loading ? (
          <div className="flex flex-col gap-2" aria-label={i18nService.t('loading')}>
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : filteredRecords.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Brain />
              </EmptyMedia>
              <EmptyTitle>{i18nService.t('managedMemoryEmptyTitle')}</EmptyTitle>
              <EmptyDescription>
                {query.trim()
                  ? i18nService.t('managedMemorySearchEmptyDescription')
                  : i18nService.t('managedMemoryEmptyDescription')}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button type="button" variant="outline" onClick={openCreateEditor}>
                <Plus data-icon="inline-start" />
                {i18nService.t('managedMemoryCreate')}
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table className="min-w-3xl">
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
                {filteredRecords.map(record => (
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
                        {canEdit(record) && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={i18nService.t('edit')}
                            onClick={() => openEditEditor(record)}
                            disabled={busyId !== null}
                          >
                            <Pencil />
                          </Button>
                        )}
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

      <MemoryEditorDialog
        editor={editor}
        busy={busyId === EDITOR_BUSY_ID}
        onClose={() => setEditor(null)}
        onChange={updateDraft}
        onSave={() => void handleSaveEditor()}
      />

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

function MemoryEditorDialog(props: {
  editor: MemoryEditor | null;
  busy: boolean;
  onClose: () => void;
  onChange: (patch: Partial<MemoryDraft>) => void;
  onSave: () => void;
}) {
  const { editor, busy, onClose, onChange, onSave } = props;
  const draft = editor?.draft ?? emptyDraft();
  const valid = Boolean(draft.title.trim() && draft.content.trim());
  return (
    <Dialog open={editor !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editor?.record
              ? i18nService.t('managedMemoryEditTitle')
              : i18nService.t('managedMemoryCreateTitle')}
          </DialogTitle>
          <DialogDescription>{i18nService.t('managedMemoryEditorDescription')}</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field data-disabled={Boolean(editor?.record) || undefined}>
            <FieldLabel htmlFor="managed-memory-scope">
              {i18nService.t('managedMemoryFieldScope')}
            </FieldLabel>
            <Select
              value={draft.scope}
              onValueChange={value => onChange({ scope: value as ManualMemoryScope })}
              disabled={Boolean(editor?.record)}
            >
              <SelectTrigger id="managed-memory-scope" className="w-full">
                <SelectValue>{scopeLabel(draft.scope)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={MemoryScope.Personal}>
                    {i18nService.t('managedMemoryScopePersonal')}
                  </SelectItem>
                  <SelectItem value={MemoryScope.Project}>
                    {i18nService.t('managedMemoryScopeProject')}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="managed-memory-title">
              {i18nService.t('managedMemoryFieldTitle')}
            </FieldLabel>
            <Input
              id="managed-memory-title"
              value={draft.title}
              onChange={event => onChange({ title: event.target.value })}
              placeholder={i18nService.t('managedMemoryTitlePlaceholder')}
              autoFocus
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="managed-memory-content">
              {i18nService.t('managedMemoryFieldContent')}
            </FieldLabel>
            <Textarea
              id="managed-memory-content"
              value={draft.content}
              onChange={event => onChange({ content: event.target.value })}
              placeholder={i18nService.t('managedMemoryContentPlaceholder')}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="managed-memory-kind">
                {i18nService.t('managedMemoryFieldKind')}
              </FieldLabel>
              <Select
                value={draft.kind}
                onValueChange={value =>
                  onChange({
                    kind:
                      value === MemoryKind.Decision
                        ? MemoryKind.Decision
                        : MemoryKind.Preference,
                  })
                }
              >
                <SelectTrigger id="managed-memory-kind" className="w-full">
                  <SelectValue>
                    {draft.kind === MemoryKind.Preference
                      ? i18nService.t('managedMemoryKindPreference')
                      : i18nService.t('managedMemoryKindDecision')}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={MemoryKind.Preference}>
                      {i18nService.t('managedMemoryKindPreference')}
                    </SelectItem>
                    <SelectItem value={MemoryKind.Decision}>
                      {i18nService.t('managedMemoryKindDecision')}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="managed-memory-sensitivity">
                {i18nService.t('managedMemoryFieldSensitivity')}
              </FieldLabel>
              <Select
                value={draft.sensitivity}
                onValueChange={value =>
                  onChange({
                    sensitivity:
                      value === MemorySensitivity.Sensitive
                        ? MemorySensitivity.Sensitive
                        : MemorySensitivity.Normal,
                  })
                }
              >
                <SelectTrigger id="managed-memory-sensitivity" className="w-full">
                  <SelectValue>
                    {draft.sensitivity === MemorySensitivity.Sensitive
                      ? i18nService.t('managedMemorySensitivitySensitive')
                      : i18nService.t('managedMemorySensitivityNormal')}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={MemorySensitivity.Normal}>
                      {i18nService.t('managedMemorySensitivityNormal')}
                    </SelectItem>
                    <SelectItem value={MemorySensitivity.Sensitive}>
                      {i18nService.t('managedMemorySensitivitySensitive')}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {i18nService.t('cancel')}
          </Button>
          <Button type="button" onClick={onSave} disabled={!valid || busy}>
            {busy && <Spinner data-icon="inline-start" />}
            {i18nService.t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      return i18nService
        .t('managedMemoryPromotedFromSession')
        .replace('{id}', record.promotionSourceSessionId);
    }
    return i18nService.t('managedMemoryPromotedFromWorkspace');
  }
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
