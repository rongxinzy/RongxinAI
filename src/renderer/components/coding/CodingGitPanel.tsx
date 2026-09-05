import { Alert, AlertDescription, AlertTitle } from '@shared/components/ui/alert';
import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@shared/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@shared/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@shared/components/ui/empty';
import { Field, FieldGroup, FieldLabel } from '@shared/components/ui/field';
import { Input } from '@shared/components/ui/input';
import { ScrollArea } from '@shared/components/ui/scroll-area';
import { Spinner } from '@shared/components/ui/spinner';
import {
  AlertTriangle,
  ChevronDown,
  FileDiff,
  FolderGit2,
  GitBranch,
  Laptop,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import type {
  CodingGitDiffScope as CodingGitDiffScopeType,
  CodingGitFileChange,
  CodingGitFileStatus as CodingGitFileStatusType,
  CodingGitStatus,
  CodingGitTargetInput,
} from '../../../shared/codingAgent';
import { CodingGitDiffScope, CodingGitFileStatus } from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
import { normalizeError } from '../../services/errorNormalization';

interface CodingGitPanelProps {
  workspaceRoot: string;
  laneId: string | null;
  sourceRoot: string;
  refreshKey: string;
  onClose?: () => void;
}

interface DiffSelection {
  path: string;
  scope: CodingGitDiffScopeType;
}

const statusCode: Record<CodingGitFileStatusType, string> = {
  [CodingGitFileStatus.Added]: 'A',
  [CodingGitFileStatus.Modified]: 'M',
  [CodingGitFileStatus.Deleted]: 'D',
  [CodingGitFileStatus.Renamed]: 'R',
  [CodingGitFileStatus.Copied]: 'C',
  [CodingGitFileStatus.Untracked]: '?',
  [CodingGitFileStatus.Conflicted]: '!',
  [CodingGitFileStatus.TypeChanged]: 'T',
};

const formatCount = (key: string, count: number): string =>
  i18nService.t(key).replace('{count}', String(count));

const formatAheadBehind = (ahead: number, behind: number): string =>
  i18nService
    .t('codingGitAheadBehind')
    .replace('{ahead}', String(ahead))
    .replace('{behind}', String(behind));

export const CodingGitPanel = ({
  workspaceRoot,
  laneId,
  sourceRoot,
  refreshKey,
  onClose,
}: CodingGitPanelProps) => {
  const [status, setStatus] = useState<CodingGitStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [diffSelection, setDiffSelection] = useState<DiffSelection | null>(null);
  const [diff, setDiff] = useState('');
  const [diffLoading, setDiffLoading] = useState(false);
  const requestSequence = useRef(0);

  const target = useMemo<CodingGitTargetInput>(
    () => ({ workspaceRoot, laneId: laneId ?? undefined, sourceRoot }),
    [laneId, sourceRoot, workspaceRoot],
  );

  const refresh = useCallback(async () => {
    const request = ++requestSequence.current;
    setLoading(true);
    const result = await window.electron.codingAgent.getGitStatus(target);
    if (request !== requestSequence.current) return;
    setLoading(false);
    if (result.success && result.status) {
      setStatus(result.status);
      setError(null);
      return;
    }
    setError(result.error ?? i18nService.t('codingGitActionFailed'));
  }, [target]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  useEffect(() => {
    const handleFocus = () => void refresh();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [refresh]);

  const staged = useMemo(
    () => status?.files.filter(file => file.indexStatus !== null) ?? [],
    [status],
  );
  const unstaged = useMemo(
    () =>
      status?.files.filter(
        file =>
          file.worktreeStatus !== null && file.worktreeStatus !== CodingGitFileStatus.Untracked,
      ) ?? [],
    [status],
  );
  const untracked = useMemo(
    () => status?.files.filter(file => file.worktreeStatus === CodingGitFileStatus.Untracked) ?? [],
    [status],
  );

  const runStatusAction = async (
    action: string,
    operation: () => Promise<{ success: boolean; status?: CodingGitStatus; error?: string }>,
    successKey: string,
  ) => {
    setPendingAction(action);
    const result = await operation();
    setPendingAction(null);
    if (result.success && result.status) {
      setStatus(result.status);
      setError(null);
      toast.success(i18nService.t(successKey));
      return true;
    }
    const message = result.error
      ? normalizeError(result.error)
      : i18nService.t('codingGitActionFailed');
    setError(message);
    toast.error(message);
    return false;
  };

  const stagePath = (path: string) =>
    runStatusAction(
      `stage:${path}`,
      () => window.electron.codingAgent.stageGitPaths({ ...target, paths: [path] }),
      'codingGitStagedToast',
    );

  const unstagePath = (path: string) =>
    runStatusAction(
      `unstage:${path}`,
      () => window.electron.codingAgent.unstageGitPaths({ ...target, paths: [path] }),
      'codingGitUnstagedToast',
    );

  const commit = async () => {
    const message = commitMessage.trim();
    if (!message) return;
    const succeeded = await runStatusAction(
      'commit',
      () => window.electron.codingAgent.commitGitChanges({ ...target, message }),
      'codingGitCommitted',
    );
    if (succeeded) setCommitMessage('');
  };

  const push = () =>
    runStatusAction(
      'push',
      () => window.electron.codingAgent.pushGitBranch(target),
      'codingGitPushed',
    );

  const showDiff = async (selection: DiffSelection) => {
    setDiffSelection(selection);
    setDiff('');
    setDiffLoading(true);
    const result = await window.electron.codingAgent.getGitDiff({ ...target, ...selection });
    setDiffLoading(false);
    if (result.success) {
      setDiff(result.diff ?? '');
      return;
    }
    setDiff(result.error ?? i18nService.t('codingGitActionFailed'));
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex min-h-14 items-center justify-between gap-2 border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2">
          <GitBranch className="size-4 shrink-0" />
          <span className="truncate text-sm font-medium">{i18nService.t('codingGitPanel')}</span>
          {status?.isRepository ? (
            <Badge variant="secondary">
              {formatCount('codingGitChangesSummary', status.files.length)}
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={i18nService.t('codingGitRefresh')}
            disabled={loading}
            onClick={() => void refresh()}
          >
            {loading ? <Spinner /> : <RefreshCw />}
          </Button>
          {onClose ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={i18nService.t('close')}
              onClick={onClose}
            >
              <X />
            </Button>
          ) : null}
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-3">
          {error ? (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>{i18nService.t('codingGitActionFailed')}</AlertTitle>
              <AlertDescription className="break-words">{error}</AlertDescription>
            </Alert>
          ) : null}

          {loading && !status ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Spinner />
              {i18nService.t('codingGitLoading')}
            </div>
          ) : null}

          {status && !status.isRepository ? (
            <Empty className="min-h-72 border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FolderGit2 />
                </EmptyMedia>
                <EmptyTitle>{i18nService.t('codingGitNoRepositoryTitle')}</EmptyTitle>
                <EmptyDescription>
                  {i18nService.t('codingGitNoRepositoryDescription')}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}

          {status?.isRepository ? (
            <>
              <Card size="sm">
                <CardHeader className="theme-control-sizing-6">
                  <CardTitle>{i18nService.t('codingGitEnvironment')}</CardTitle>
                  <CardDescription className="truncate" title={status.repositoryRoot ?? undefined}>
                    {status.repositoryRoot}
                  </CardDescription>
                  <CardAction>
                    <Laptop className="size-4 text-muted-foreground" />
                  </CardAction>
                </CardHeader>
                <CardContent className="theme-control-sizing-6 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">{i18nService.t('codingGitLocal')}</span>
                    <span className="truncate font-medium">
                      {status.detached
                        ? i18nService.t('codingGitDetached')
                        : (status.branch ?? status.head ?? '—')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="truncate text-muted-foreground">
                      {status.upstream ?? i18nService.t('codingGitNoUpstream')}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {formatAheadBehind(status.ahead, status.behind)}
                    </span>
                  </div>
                </CardContent>
                <CardFooter className="theme-control-sizing-2 -mx-3 justify-between gap-3">
                  <span className="text-xs text-muted-foreground">
                    {formatCount('codingGitChangesSummary', status.files.length)}
                  </span>
                  <span className="flex items-center gap-2 text-xs">
                    <span className="text-success">+{status.additions}</span>
                    <span className="text-destructive">−{status.deletions}</span>
                  </span>
                </CardFooter>
              </Card>

              {status.isIsolated ? (
                <Alert>
                  <AlertTriangle />
                  <AlertTitle>{i18nService.t('codingGitIsolatedTitle')}</AlertTitle>
                  <AlertDescription>
                    {i18nService.t('codingGitIsolatedDescription')}
                  </AlertDescription>
                </Alert>
              ) : null}
              {status.isBusy ? (
                <Alert>
                  <AlertTriangle />
                  <AlertTitle>{i18nService.t('codingGitBusyTitle')}</AlertTitle>
                  <AlertDescription>{i18nService.t('codingGitBusyDescription')}</AlertDescription>
                </Alert>
              ) : null}

              {status.files.length === 0 ? (
                <Empty className="min-h-56 border">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <GitBranch />
                    </EmptyMedia>
                    <EmptyTitle>{i18nService.t('codingGitCleanTitle')}</EmptyTitle>
                    <EmptyDescription>
                      {i18nService.t('codingGitCleanDescription')}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <div className="flex flex-col gap-2">
                  <GitFileGroup
                    title={i18nService.t('codingGitStaged')}
                    files={staged}
                    scope={CodingGitDiffScope.Staged}
                    actionLabel={i18nService.t('codingGitUnstage')}
                    canMutate={status.canMutate}
                    pendingAction={pendingAction}
                    onAction={path => void unstagePath(path)}
                    onDiff={selection => void showDiff(selection)}
                  />
                  <GitFileGroup
                    title={i18nService.t('codingGitUnstaged')}
                    files={unstaged}
                    scope={CodingGitDiffScope.Unstaged}
                    actionLabel={i18nService.t('codingGitStage')}
                    canMutate={status.canMutate}
                    pendingAction={pendingAction}
                    onAction={path => void stagePath(path)}
                    onDiff={selection => void showDiff(selection)}
                  />
                  <GitFileGroup
                    title={i18nService.t('codingGitUntracked')}
                    files={untracked}
                    scope={CodingGitDiffScope.Untracked}
                    actionLabel={i18nService.t('codingGitStage')}
                    canMutate={status.canMutate}
                    pendingAction={pendingAction}
                    onAction={path => void stagePath(path)}
                    onDiff={selection => void showDiff(selection)}
                  />
                </div>
              )}

              <Card size="sm">
                <CardHeader className="theme-control-sizing-6">
                  <CardTitle>{i18nService.t('codingGitCommit')}</CardTitle>
                  <CardDescription>
                    {staged.length > 0
                      ? formatCount('codingGitChangesSummary', staged.length)
                      : i18nService.t('codingGitNoStagedChanges')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="theme-control-sizing-6">
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="coding-git-commit-message">
                        {i18nService.t('codingGitCommitMessage')}
                      </FieldLabel>
                      <Input
                        id="coding-git-commit-message"
                        value={commitMessage}
                        placeholder={i18nService.t('codingGitCommitPlaceholder')}
                        disabled={!status.canMutate || pendingAction !== null}
                        onChange={event => setCommitMessage(event.target.value)}
                        onKeyDown={event => {
                          if (event.key === 'Enter' && !event.nativeEvent.isComposing)
                            void commit();
                        }}
                      />
                    </Field>
                  </FieldGroup>
                </CardContent>
                <CardFooter className="theme-control-sizing-2 -mx-3 justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      !status.canMutate ||
                      !status.upstream ||
                      status.ahead === 0 ||
                      pendingAction !== null
                    }
                    onClick={() => void push()}
                  >
                    {pendingAction === 'push' ? <Spinner /> : <Upload />}
                    {i18nService.t('codingGitPush')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      !status.canMutate ||
                      staged.length === 0 ||
                      !commitMessage.trim() ||
                      pendingAction !== null
                    }
                    onClick={() => void commit()}
                  >
                    {pendingAction === 'commit' ? <Spinner /> : <GitBranch />}
                    {i18nService.t('codingGitCommit')}
                  </Button>
                </CardFooter>
              </Card>
            </>
          ) : null}
        </div>
      </ScrollArea>

      <Dialog open={diffSelection !== null} onOpenChange={open => !open && setDiffSelection(null)}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{i18nService.t('codingGitDiffTitle')}</DialogTitle>
            <DialogDescription className="break-all">
              {diffSelection?.path ?? i18nService.t('codingGitDiffDescription')}
            </DialogDescription>
          </DialogHeader>
          {diffLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
              <Spinner />
              {i18nService.t('codingGitLoading')}
            </div>
          ) : (
            <pre className="max-h-[65dvh] overflow-auto rounded-lg border border-border bg-muted/30 p-3 font-mono text-xs whitespace-pre-wrap break-words">
              {diff || i18nService.t('codingGitDiffEmpty')}
            </pre>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

interface GitFileGroupProps {
  title: string;
  files: CodingGitFileChange[];
  scope: CodingGitDiffScopeType;
  actionLabel: string;
  canMutate: boolean;
  pendingAction: string | null;
  onAction: (path: string) => void;
  onDiff: (selection: DiffSelection) => void;
}

const GitFileGroup = ({
  title,
  files,
  scope,
  actionLabel,
  canMutate,
  pendingAction,
  onAction,
  onDiff,
}: GitFileGroupProps) => {
  if (files.length === 0) return null;
  return (
    <Collapsible defaultOpen>
      <CollapsibleTrigger
        render={<Button type="button" variant="ghost" className="w-full justify-between" />}
      >
        <span className="flex items-center gap-2">
          <ChevronDown />
          <span>{title}</span>
        </span>
        <Badge variant="secondary">{files.length}</Badge>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-1 pt-1">
          {files.map(file => {
            const status =
              scope === CodingGitDiffScope.Staged ? file.indexStatus : file.worktreeStatus;
            const actionId = `${scope === CodingGitDiffScope.Staged ? 'unstage' : 'stage'}:${file.path}`;
            return (
              <div
                key={`${scope}:${file.path}`}
                className="flex min-w-0 items-center gap-1 rounded-lg"
              >
                <Button
                  type="button"
                  variant="ghost"
                  className="theme-control-sizing-7 theme-control-content-height min-w-0 flex-1 justify-start"
                  onClick={() => onDiff({ path: file.path, scope })}
                >
                  <FileDiff className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-left" title={file.path}>
                    {file.path}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-xs">
                    {file.additions !== null ? (
                      <span className="text-success">+{file.additions}</span>
                    ) : null}
                    {file.deletions !== null ? (
                      <span className="text-destructive">−{file.deletions}</span>
                    ) : null}
                    {status ? <Badge variant="outline">{statusCode[status]}</Badge> : null}
                  </span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!canMutate || pendingAction !== null}
                  onClick={() => onAction(file.path)}
                >
                  {pendingAction === actionId ? <Spinner /> : null}
                  {actionLabel}
                </Button>
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
