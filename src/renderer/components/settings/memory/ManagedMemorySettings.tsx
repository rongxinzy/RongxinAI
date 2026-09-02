import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { useSelector } from 'react-redux';
import { toast } from 'sonner';

import { Button } from '@shared/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shared/components/ui/card';
import { DestructiveConfirmDialog } from '@shared/components/ui/destructive-confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
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
import { Spinner } from '@shared/components/ui/spinner';
import { Textarea } from '@shared/components/ui/textarea';
import {
  MemoryDeliveryStatus,
  MemoryKind,
  MemoryLifecycleStatus,
  MemoryScope,
  MemorySensitivity,
  type ManagedMemoryRecord,
  type ManualMemoryScope,
} from '../../../../shared/memory';
import { i18nService } from '../../../services/i18n';
import { memoryService } from '../../../services/memory';
import type { RootState } from '../../../store';
import { MemoryRecordList } from './MemoryRecordList';
import { collectMemorySourceSessionIds } from './memoryViewModel';

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
  const workspaces = useSelector((state: RootState) => state.workspace.workspaces);
  const currentWorkspaceId = useSelector((state: RootState) => state.workspace.currentWorkspaceId);
  const currentWorkspace = workspaces.find(workspace => workspace.id === currentWorkspaceId);
  const workspaceOptions = useMemo(() => {
    const options = workspaces
      .filter(workspace => !workspace.isHidden)
      .map(workspace => ({ id: workspace.id, name: workspace.name, path: workspace.path }));
    const configuredPath = workingDirectory.trim();
    if (configuredPath && !options.some(option => option.path === configuredPath)) {
      options.push({ id: configuredPath, name: configuredPath, path: configuredPath });
    }
    return options;
  }, [workspaces, workingDirectory]);
  const defaultWorkspacePath = currentWorkspace?.path || workingDirectory.trim();
  const [selectedWorkspacePath, setSelectedWorkspacePath] = useState(defaultWorkspacePath);
  const [records, setRecords] = useState<ManagedMemoryRecord[]>([]);
  const [sessionTitles, setSessionTitles] = useState<ReadonlyMap<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editor, setEditor] = useState<MemoryEditor | null>(null);
  const [forgetTarget, setForgetTarget] = useState<ForgetTarget | null>(null);

  useEffect(() => {
    const nextPath = currentWorkspace?.path || workingDirectory.trim();
    if (nextPath) setSelectedWorkspacePath(nextPath);
  }, [currentWorkspace?.path, workingDirectory]);

  useEffect(() => {
    if (!selectedWorkspacePath && defaultWorkspacePath) {
      setSelectedWorkspacePath(defaultWorkspacePath);
    }
  }, [defaultWorkspacePath, selectedWorkspacePath]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const nextRecords = await memoryService.list({ workingDirectory: selectedWorkspacePath });
      const sourceSessionIds = collectMemorySourceSessionIds(nextRecords);
      try {
        const resolvedTitles = sourceSessionIds.length
          ? await memoryService.resolveSessionTitles(sourceSessionIds)
          : [];
        setSessionTitles(
          new Map(resolvedTitles.map(item => [item.sessionId, item.title] as const)),
        );
      } catch (error) {
        setSessionTitles(new Map());
        console.warn('[ManagedMemory] Failed to resolve source session titles:', error);
      }
      setRecords(nextRecords);
    } catch (error) {
      toast.error(i18nService.t('managedMemoryLoadFailed'));
      console.error('[ManagedMemory] Failed to load memory projection:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedWorkspacePath]);

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
        kind: record.kind === MemoryKind.Preference ? MemoryKind.Preference : MemoryKind.Decision,
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
          workingDirectory: selectedWorkspacePath,
          title,
          content,
          kind: editor.draft.kind,
          sensitivity: editor.draft.sensitivity,
        });
        toast.success(i18nService.t('managedMemoryUpdated'));
      } else {
        await memoryService.createManual({
          workingDirectory: selectedWorkspacePath,
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

  return (
    <Card className="h-[40rem] min-h-0">
      <CardHeader className="shrink-0 has-data-[slot=card-action]:grid-cols-1 sm:has-data-[slot=card-action]:grid-cols-[1fr_auto]">
        <CardTitle>{i18nService.t('managedMemoryTitle')}</CardTitle>
        <CardDescription>{i18nService.t('managedMemoryDescription')}</CardDescription>
        <CardAction className="col-start-1 row-start-3 row-span-1 justify-self-start pt-2 sm:col-start-2 sm:row-start-1 sm:row-span-2 sm:justify-self-end sm:pt-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {i18nService.t('managedMemoryWorkspaceLabel')}
            </span>
            <Select
              value={selectedWorkspacePath}
              onValueChange={value => value && setSelectedWorkspacePath(value)}
              disabled={workspaceOptions.length === 0}
            >
              <SelectTrigger
                className="w-52"
                aria-label={i18nService.t('managedMemoryWorkspaceLabel')}
              >
                <SelectValue placeholder={i18nService.t('managedMemoryWorkspaceEmpty')} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {workspaceOptions.map(workspace => (
                    <SelectItem key={workspace.id} value={workspace.path}>
                      {workspace.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {pendingCount > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleRetry()}
                disabled={busyId !== null}
              >
                <RefreshCw data-icon="inline-start" />
                {i18nService
                  .t('managedMemoryRetryPending')
                  .replace('{count}', String(pendingCount))}
              </Button>
            )}
            <Button type="button" size="sm" onClick={openCreateEditor} disabled={busyId !== null}>
              <Plus data-icon="inline-start" />
              {i18nService.t('managedMemoryCreate')}
            </Button>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        <MemoryRecordList
          records={records}
          sessionTitles={sessionTitles}
          loading={loading}
          busy={busyId !== null}
          onCreate={openCreateEditor}
          onEdit={openEditEditor}
          onConfirm={record =>
            void runAction(
              record.id,
              () => memoryService.confirmCandidate(record.id),
              'managedMemoryConfirmed',
            )
          }
          onArchive={record =>
            void runAction(
              record.id,
              () => memoryService.archive(record.id),
              'managedMemoryArchived',
            )
          }
          onRestore={record =>
            void runAction(
              record.id,
              () => memoryService.restore(record.id),
              'managedMemoryRestored',
            )
          }
          onForget={record => setForgetTarget({ record })}
        />
      </CardContent>

      <MemoryEditorDialog
        editor={editor}
        busy={busyId === EDITOR_BUSY_ID}
        onClose={() => setEditor(null)}
        onChange={updateDraft}
        onSave={() => void handleSaveEditor()}
      />

      <DestructiveConfirmDialog
        open={forgetTarget !== null}
        title={i18nService.t('managedMemoryForgetTitle')}
        description={
          forgetTarget?.record.memoryId === null
            ? i18nService.t('managedMemoryRejectDescription')
            : i18nService.t('managedMemoryForgetDescription')
        }
        cancelLabel={i18nService.t('cancel')}
        confirmLabel={
          forgetTarget &&
          forgetTarget.record.status === MemoryLifecycleStatus.Deleted &&
          forgetTarget.record.memoryId !== null
            ? i18nService.t('managedMemoryHardDelete')
            : forgetTarget?.record.memoryId === null
              ? i18nService.t('managedMemoryRejectCandidate')
              : i18nService.t('managedMemorySoftDelete')
        }
        onCancel={() => setForgetTarget(null)}
        onConfirm={() =>
          void handleForget(
            forgetTarget?.record.status === MemoryLifecycleStatus.Deleted &&
              forgetTarget.record.memoryId !== null,
          )
        }
        secondaryConfirmLabel={
          forgetTarget &&
          forgetTarget.record.status !== MemoryLifecycleStatus.Deleted &&
          forgetTarget.record.memoryId !== null
            ? i18nService.t('managedMemoryHardDelete')
            : undefined
        }
        onSecondaryConfirm={() => void handleForget(true)}
      />
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
                      value === MemoryKind.Decision ? MemoryKind.Decision : MemoryKind.Preference,
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
