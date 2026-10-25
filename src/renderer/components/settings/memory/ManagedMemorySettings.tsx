import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { useSelector } from 'react-redux';

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
import { DestructiveConfirmDialog } from '@shared/components/ui/destructive-confirm-dialog';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/components/ui/tooltip';
import {
  MemoryDeliveryStatus,
  MemoryKind,
  MemoryLifecycleStatus,
  MemoryScope,
  type ManagedMemoryRecord,
} from '../../../../shared/memory';
import { i18nService } from '../../../services/i18n';
import { memoryService } from '../../../services/memory';
import {
  showAppErrorToast,
  showAppInfoToast,
  showAppSuccessToast,
} from '../../../services/toastNotification';
import type { RootState } from '../../../store';
import { getWorkspaceDisplayName } from '../../../utils/path';
import { ManagedMemoryView } from './constants';
import {
  MemoryEditorDialog,
  emptyDraft,
  type MemoryEditor,
  type MemoryDraft,
} from './MemoryEditorDialog';
import { MemoryRecordList } from './MemoryRecordList';
import { collectMemorySourceSessionIds, countManagedMemories } from './memoryViewModel';

const EDITOR_BUSY_ID = 'memory-editor';
const OUTBOX_BUSY_ID = 'memory-outbox';

interface ManagedMemorySettingsProps {
  workingDirectory: string;
}

interface ForgetTarget {
  record: ManagedMemoryRecord;
}

export function ManagedMemorySettings({ workingDirectory }: ManagedMemorySettingsProps) {
  const workspaces = useSelector((state: RootState) => state.workspace.workspaces);
  const currentWorkspaceId = useSelector((state: RootState) => state.workspace.currentWorkspaceId);
  const currentWorkspace = workspaces.find(workspace => workspace.id === currentWorkspaceId);
  const workspaceOptions = useMemo(() => {
    const options = workspaces
      .filter(workspace => !workspace.isHidden)
      .map(workspace => ({
        id: workspace.id,
        name: getWorkspaceDisplayName(
          workspace.path,
          workspace.name,
          i18nService.t('defaultConversation'),
        ),
        path: workspace.path,
      }));
    const configuredPath = workingDirectory.trim();
    if (configuredPath && !options.some(option => option.path === configuredPath)) {
      options.push({ id: configuredPath, name: configuredPath, path: configuredPath });
    }
    return options;
  }, [workspaces, workingDirectory]);
  const defaultWorkspacePath = currentWorkspace?.path || workingDirectory.trim();
  const [selectedWorkspacePath, setSelectedWorkspacePath] = useState(defaultWorkspacePath);
  const selectedWorkspace = workspaceOptions.find(
    workspace => workspace.path === selectedWorkspacePath,
  );
  const [records, setRecords] = useState<ManagedMemoryRecord[]>([]);
  const [sessionTitles, setSessionTitles] = useState<ReadonlyMap<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editor, setEditor] = useState<MemoryEditor | null>(null);
  const [forgetTarget, setForgetTarget] = useState<ForgetTarget | null>(null);
  const counts = useMemo(() => countManagedMemories(records), [records]);

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
      showAppErrorToast(i18nService.t('managedMemoryLoadFailed'));
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

  const runAction = useCallback(
    async (id: string, action: () => Promise<unknown>, successKey: string) => {
      setBusyId(id);
      try {
        const result = await action();
        if (result === false || result === null)
          showAppInfoToast(i18nService.t('managedMemorySyncPending'));
        else showAppSuccessToast(i18nService.t(successKey));
        await load();
      } catch (error) {
        showAppErrorToast(i18nService.t('managedMemoryActionFailed'));
        console.error('[ManagedMemory] Memory action failed:', error);
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const handleRetry = async () => {
    setBusyId(OUTBOX_BUSY_ID);
    try {
      await memoryService.retryPending();
      await load();
    } catch (error) {
      showAppErrorToast(i18nService.t('managedMemoryRetryFailed'));
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

  const openCreateEditor = useCallback(() => setEditor({ record: null, draft: emptyDraft() }), []);

  const openEditEditor = useCallback((record: ManagedMemoryRecord) => {
    if (record.scope !== MemoryScope.Project && record.scope !== MemoryScope.Personal) return;
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
  }, []);

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
        showAppSuccessToast(i18nService.t('managedMemoryUpdated'));
      } else {
        await memoryService.createManual({
          workingDirectory: selectedWorkspacePath,
          scope: editor.draft.scope,
          title,
          content,
          kind: editor.draft.kind,
          sensitivity: editor.draft.sensitivity,
        });
        showAppSuccessToast(i18nService.t('managedMemoryCreated'));
      }
      setEditor(null);
      await load();
    } catch (error) {
      showAppErrorToast(i18nService.t('managedMemorySaveFailed'));
      console.error('[ManagedMemory] Failed to save manual memory:', error);
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirm = useCallback(
    (record: ManagedMemoryRecord) => {
      void runAction(
        record.id,
        () => memoryService.confirmCandidate(record.id),
        'managedMemoryConfirmed',
      );
    },
    [runAction],
  );
  const handleArchive = useCallback(
    (record: ManagedMemoryRecord) => {
      void runAction(record.id, () => memoryService.archive(record.id), 'managedMemoryArchived');
    },
    [runAction],
  );
  const handleRestore = useCallback(
    (record: ManagedMemoryRecord) => {
      void runAction(record.id, () => memoryService.restore(record.id), 'managedMemoryRestored');
    },
    [runAction],
  );
  const handleRequestForget = useCallback((record: ManagedMemoryRecord) => {
    setForgetTarget({ record });
  }, []);

  const memoryRecordListProps = {
    workspaceName: selectedWorkspace?.name ?? selectedWorkspacePath,
    records,
    sessionTitles,
    loading,
    busy: busyId !== null,
    onCreate: openCreateEditor,
    onEdit: openEditEditor,
    onConfirm: handleConfirm,
    onArchive: handleArchive,
    onRestore: handleRestore,
    onForget: handleRequestForget,
  };

  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="flex shrink-0 items-center gap-2">
          <span className="shrink-0 text-sm text-muted-foreground">
            {i18nService.t('managedMemoryWorkspaceLabel')}
          </span>
          <Select
            value={selectedWorkspacePath}
            onValueChange={value => value && setSelectedWorkspacePath(value)}
            disabled={workspaceOptions.length === 0}
          >
            <SelectTrigger
              className="min-w-0 flex-1"
              aria-label={i18nService.t('managedMemoryWorkspaceLabel')}
            >
              <SelectValue placeholder={i18nService.t('managedMemoryWorkspaceEmpty')}>
                {selectedWorkspace?.name}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="start" className="max-w-sm">
              <SelectGroup>
                {workspaceOptions.map(workspace => (
                  <SelectItem key={workspace.id} value={workspace.path}>
                    <span className="flex min-w-0 flex-col items-start">
                      <span className="max-w-xs truncate">{workspace.name}</span>
                      <span className="max-w-xs truncate text-xs text-muted-foreground">
                        {workspace.path}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {pendingCount > 0 && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => void handleRetry()}
                    aria-label={i18nService
                      .t('managedMemoryRetryPending')
                      .replace('{count}', String(pendingCount))}
                    disabled={busyId !== null}
                  />
                }
              >
                <RefreshCw />
              </TooltipTrigger>
              <TooltipContent>
                {i18nService
                  .t('managedMemoryRetryPending')
                  .replace('{count}', String(pendingCount))}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        <Card className="theme-control-sizing-28 min-h-0">
          <CardHeader className="shrink-0">
            <CardTitle className="flex items-center gap-2">
              <span>{i18nService.t('managedMemoryTitle')}</span>
              <span className="text-xs font-normal text-muted-foreground">{counts.longTerm}</span>
            </CardTitle>
            <CardDescription>{i18nService.t('managedMemoryDescription')}</CardDescription>
            <CardAction>
              <Button type="button" onClick={openCreateEditor} disabled={busyId !== null}>
                <Plus data-icon="inline-start" />
                {i18nService.t('managedMemoryCreate')}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col">
            <MemoryRecordList view={ManagedMemoryView.LongTerm} {...memoryRecordListProps} />
          </CardContent>
        </Card>

        <Card className="theme-control-sizing-29 min-h-0">
          <CardHeader className="shrink-0">
            <CardTitle className="flex items-center gap-2">
              <span>{i18nService.t('managedMemoryTabSessions')}</span>
              <span className="text-xs font-normal text-muted-foreground">{counts.session}</span>
            </CardTitle>
            <CardDescription>{i18nService.t('managedMemorySessionDescription')}</CardDescription>
            <CardAction>
              <Badge variant="outline">{i18nService.t('managedMemoryReadOnly')}</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col">
            <MemoryRecordList view={ManagedMemoryView.Session} {...memoryRecordListProps} />
          </CardContent>
        </Card>
      </div>

      <MemoryEditorDialog
        editor={editor}
        busy={busyId === EDITOR_BUSY_ID}
        onClose={() => setEditor(null)}
        onChange={updateDraft}
        onSave={() => void handleSaveEditor()}
      />

      <DestructiveConfirmDialog
        open={forgetTarget !== null}
        title={i18nService.t(
          forgetTarget?.record.memoryId === null
            ? 'managedMemoryRejectTitle'
            : 'managedMemoryForgetTitle',
        )}
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
    </>
  );
}
