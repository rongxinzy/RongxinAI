import { Button } from '@shared/components/ui/button';
import { Checkbox } from '@shared/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogFooterSurface,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@shared/components/ui/command';
import { Field, FieldGroup, FieldLabel } from '@shared/components/ui/field';
import { Input } from '@shared/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/components/ui/popover';
import { Separator } from '@shared/components/ui/separator';
import { Spinner } from '@shared/components/ui/spinner';
import { Textarea } from '@shared/components/ui/textarea';
import { cn } from '@shared/lib/utils';
import { Check, ChevronDown, CloudUpload, ExternalLink, FilePlus2, GitBranch, GitCommitHorizontal, GitCompareArrows, GitPullRequestCreate, Plus, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import type { CodingGitStatus, CodingGitTargetInput } from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
import { normalizeError } from '../../services/errorNormalization';
import { CodingGitQuickActionMode, type CodingGitQuickActionMode as CodingGitQuickActionModeType } from './constants';
import { buildGitHubComparisonUrl } from './codingGitUrl';

interface CodingGitQuickActionsProps {
  target: CodingGitTargetInput;
  refreshKey: string;
  onOpenReview?: () => void;
  mode?: CodingGitQuickActionModeType;
}

const GitMenuRow = ({
  children,
  icon: Icon,
  onClick,
  trailing,
  disabled = false,
}: {
  children: ReactNode;
  icon: typeof FilePlus2;
  onClick?: () => void;
  trailing?: ReactNode;
  disabled?: boolean;
}) => (
  <Button
    type="button"
    variant="ghost"
    className="w-full justify-start gap-2"
    disabled={disabled}
    onClick={onClick}
  >
    <Icon className="size-4 shrink-0" />
    <span className="min-w-0 flex-1 truncate text-left">{children}</span>
    {trailing}
  </Button>
);

export const CodingGitQuickActions = ({
  target,
  refreshKey,
  onOpenReview,
  mode = CodingGitQuickActionMode.Environment,
}: CodingGitQuickActionsProps) => {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<CodingGitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);
  const [pullRequestOpen, setPullRequestOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [createBranchOpen, setCreateBranchOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [pendingBranch, setPendingBranch] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [pullRequestTitle, setPullRequestTitle] = useState('');
  const [pullRequestBody, setPullRequestBody] = useState('');
  const [pullRequestBase, setPullRequestBase] = useState('main');
  const [pullRequestUrl, setPullRequestUrl] = useState<string | null>(null);
  const [isDraftPullRequest, setIsDraftPullRequest] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.electron.codingAgent.getGitStatus(target);
      if (result.success && result.status) {
        setStatus(result.status);
        return result.status;
      }
      toast.error(normalizeError(result.error ?? i18nService.t('codingGitActionFailed')));
      return null;
    } finally {
      setLoading(false);
    }
  }, [target]);

  useEffect(() => {
    if (open || commitOpen) void loadStatus();
  }, [commitOpen, loadStatus, open, refreshKey]);

  const hasStagedChanges = useMemo(
    () => Boolean(status?.files.some(file => file.indexStatus !== null)),
    [status?.files],
  );
  const hasCommitChanges = includeUnstaged
    ? Boolean(status?.files.length)
    : hasStagedChanges;
  const branches = useMemo(() => status?.localBranches ?? [], [status?.localBranches]);
  const canPush = Boolean(status?.canMutate && status.hasOrigin && status.branch && !status.detached);
  const canCommit = Boolean(status?.canMutate && hasCommitChanges);
  const canCommitAndPush = canCommit && canPush;

  const openReview = () => {
    setOpen(false);
    onOpenReview?.();
  };

  const openCommit = () => {
    setOpen(false);
    setCommitOpen(true);
  };

  const openPullRequest = () => {
    setOpen(false);
    setCommitOpen(false);
    setPullRequestBase(status?.defaultBranch ?? 'main');
    setPullRequestUrl(null);
    setPullRequestOpen(true);
  };

  const handlePullRequestOpenChange = (nextOpen: boolean) => {
    setPullRequestOpen(nextOpen);
    if (!nextOpen) {
      setPullRequestTitle('');
      setPullRequestBody('');
      setPullRequestUrl(null);
    }
  };

  const createPullRequest = async (draft: boolean) => {
    if (!status || !pullRequestTitle.trim() || !pullRequestBase.trim()) return;
    setIsDraftPullRequest(draft);
    setPendingAction('pullRequest');
    try {
      const latestStatus = await loadStatus();
      if (!latestStatus?.githubRepositoryUrl || !latestStatus.hasRemoteBranch) {
        toast.error(i18nService.t('codingGitStateChanged'));
        return;
      }
      const result = await window.electron.codingAgent.createGitPullRequest({ ...target, title: pullRequestTitle, body: pullRequestBody, base: pullRequestBase, draft });
      if (!result.success || !result.url) {
        toast.error(normalizeError(result.error ?? i18nService.t('codingGitActionFailed')));
        return;
      }
      setPullRequestUrl(result.url);
      toast.success(i18nService.t('codingGitPullRequestCreated'));
    } finally {
      setIsDraftPullRequest(false);
      setPendingAction(null);
    }
  };

  const openPullRequestInBrowser = async () => {
    if (!pullRequestUrl) return;
    const result = await window.electron.shell.openExternal(pullRequestUrl);
    if (!result.success) {
      toast.error(normalizeError(result.error ?? i18nService.t('codingGitActionFailed')));
    }
  };

  const switchBranch = async (branch: string) => {
    if (!status || branch === status.branch || !status.canMutate) return;
    setPendingBranch(branch);
    try {
      const result = await window.electron.codingAgent.switchGitBranch({ ...target, branch });
      if (result.success && result.status) {
        setStatus(result.status);
        setBranchOpen(false);
        toast.success(i18nService.t('codingGitBranchSwitched'));
        return;
      }
      toast.error(normalizeError(result.error ?? i18nService.t('codingGitActionFailed')));
    } finally {
      setPendingBranch(null);
    }
  };

  const createBranch = async () => {
    const branch = newBranchName.trim();
    if (!status || !branch || status.isIsolated) return;
    setPendingBranch(branch);
    try {
      const result = await window.electron.codingAgent.createGitBranch({ ...target, branch });
      if (result.success && result.status) {
        setStatus(result.status);
        setNewBranchName('');
        setCreateBranchOpen(false);
        toast.success(i18nService.t('codingGitBranchCreated'));
        return;
      }
      toast.error(normalizeError(result.error ?? i18nService.t('codingGitActionFailed')));
    } finally {
      setPendingBranch(null);
    }
  };

  const runCommit = async (pushAfterCommit: boolean) => {
    const message = commitMessage.trim();
    if (!message || !status) return;
    setPendingAction(pushAfterCommit ? 'commitAndPush' : 'commit');
    try {
      const latestStatus = await loadStatus();
      if (!latestStatus) return;
      const latestUnstagedPaths = latestStatus.files
        .filter(file => file.worktreeStatus !== null)
        .map(file => file.path);
      const latestHasStagedChanges = latestStatus.files.some(file => file.indexStatus !== null);
      const latestCanCommit = latestStatus.canMutate && (
        includeUnstaged ? latestStatus.files.length > 0 : latestHasStagedChanges
      );
      const latestCanPush = latestStatus.canMutate && latestStatus.hasOrigin && Boolean(latestStatus.branch) && !latestStatus.detached;
      if (!latestCanCommit || (pushAfterCommit && !latestCanPush)) {
        toast.error(i18nService.t('codingGitStateChanged'));
        return;
      }
      if (pushAfterCommit) {
        const result = await window.electron.codingAgent.commitAndPushGitChanges({
          ...target,
          message,
          paths: includeUnstaged ? latestUnstagedPaths : [],
        });
        if (!result.success || !result.result) {
          throw new Error(result.error ?? i18nService.t('codingGitActionFailed'));
        }
        setStatus(result.result.status);
        setCommitMessage('');
        if (!result.result.pushed) {
          const pushError = result.result.pushError
            ? ` ${normalizeError(result.result.pushError)}`
            : '';
          toast.error(`${i18nService.t('codingGitCommittedPushFailed')}${pushError}`);
          return;
        }
        toast.success(i18nService.t('codingGitCommittedAndPushed'));
        setCommitOpen(false);
      } else {
        const committed = await window.electron.codingAgent.commitGitChanges({
          ...target,
          message,
          paths: includeUnstaged ? latestUnstagedPaths : [],
        });
        if (!committed.success) throw new Error(committed.error ?? i18nService.t('codingGitActionFailed'));
        if (committed.status) setStatus(committed.status);
        setCommitMessage('');
        toast.success(i18nService.t('codingGitCommitted'));
      }
    } catch (error) {
      toast.error(normalizeError(error instanceof Error ? error.message : String(error)));
    } finally {
      setPendingAction(null);
    }
  };

  const push = async () => {
    setPendingAction('push');
    try {
      const latestStatus = await loadStatus();
      const latestCanPush = Boolean(
        latestStatus?.canMutate &&
          latestStatus.hasOrigin &&
          latestStatus.branch &&
          !latestStatus.detached,
      );
      if (!latestCanPush) {
        toast.error(i18nService.t('codingGitStateChanged'));
        return;
      }
      const result = await window.electron.codingAgent.pushGitBranch(target);
      if (result.success) {
        if (result.status) setStatus(result.status);
        toast.success(i18nService.t('codingGitPushed'));
        setCommitOpen(false);
        return;
      }
      toast.error(normalizeError(result.error ?? i18nService.t('codingGitActionFailed')));
    } finally {
      setPendingAction(null);
    }
  };

  const openBranchComparison = async () => {
    if (!status?.githubRepositoryUrl || !status.branch) return;
    const result = await window.electron.shell.openExternal(
      buildGitHubComparisonUrl(status.githubRepositoryUrl, status.branch),
    );
    if (!result.success) toast.error(normalizeError(result.error ?? i18nService.t('codingGitActionFailed')));
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant={mode === CodingGitQuickActionMode.Commit ? 'outline' : 'ghost'}
              size={mode === CodingGitQuickActionMode.Commit ? 'sm' : 'icon'}
              aria-label={i18nService.t(
                mode === CodingGitQuickActionMode.Commit
                  ? 'codingGitCommitOrPush'
                  : 'codingGitEnvironment',
              )}
              aria-pressed={open}
            />
          }
        >
          <SlidersHorizontal />
          {mode === CodingGitQuickActionMode.Commit ? <ChevronDown /> : null}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-2">
          {loading && !status ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Spinner />
              {i18nService.t('codingGitLoading')}
            </div>
          ) : status?.isRepository && mode === CodingGitQuickActionMode.Commit ? (
            <div className="space-y-1 p-1">
              <GitMenuRow icon={GitCommitHorizontal} onClick={openCommit}>
                {i18nService.t('codingGitCommitOrPush')}
              </GitMenuRow>
              <GitMenuRow
                icon={GitPullRequestCreate}
                disabled={!status.githubRepositoryUrl || !status.hasRemoteBranch}
                onClick={openPullRequest}
              >
                {i18nService.t('codingGitCreatePullRequest')}
              </GitMenuRow>
            </div>
          ) : status?.isRepository ? (
            <div className="space-y-1">
              <GitMenuRow icon={FilePlus2} onClick={openReview} trailing={<span className="text-xs"><span className="text-success">+{status.additions}</span> <span className="text-destructive">−{status.deletions}</span></span>}>
                {i18nService.t('codingGitChanges')}
              </GitMenuRow>
              <Popover open={branchOpen} onOpenChange={setBranchOpen}>
                <PopoverTrigger render={<Button type="button" variant="ghost" className="w-full justify-start gap-2" />}>
                  <GitBranch className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-left">{status.detached ? i18nService.t('codingGitDetached') : (status.branch ?? status.head ?? '—')}</span>
                  <span className="text-xs text-muted-foreground">{status.upstream ?? '—'}</span>
                  <ChevronDown />
                </PopoverTrigger>
                <PopoverContent side="left" align="start" className="w-80 p-0">
                  <Command>
                    <CommandInput placeholder={i18nService.t('codingGitSearchBranches')} />
                    <CommandList className="max-h-80">
                      <CommandEmpty>{i18nService.t('codingGitNoBranches')}</CommandEmpty>
                      {branches.map(branch => (
                        <CommandItem
                          key={branch}
                          value={branch}
                          disabled={branch === status.branch || pendingBranch !== null || !status.canMutate}
                          onSelect={() => void switchBranch(branch)}
                        >
                          <GitBranch />
                          <span className="min-w-0 flex-1 truncate">{branch}</span>
                          {pendingBranch === branch ? <Spinner /> : branch === status.branch ? <Check /> : null}
                        </CommandItem>
                      ))}
                    </CommandList>
                    <CommandSeparator />
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-full justify-start gap-2"
                      disabled={pendingBranch !== null || status.isIsolated}
                      onClick={() => {
                        setBranchOpen(false);
                        setCreateBranchOpen(true);
                      }}
                    >
                      <Plus />
                      {i18nService.t('codingGitCreateBranch')}
                    </Button>
                  </Command>
                </PopoverContent>
              </Popover>
              <GitMenuRow icon={GitCommitHorizontal} onClick={openCommit}>
                {i18nService.t('codingGitCommitOrPush')}
              </GitMenuRow>
              <GitMenuRow
                icon={GitPullRequestCreate}
                disabled={!status.githubRepositoryUrl || !status.hasRemoteBranch}
                onClick={openPullRequest}
              >
                {i18nService.t('codingGitCreatePullRequest')}
              </GitMenuRow>
              {status.githubRepositoryUrl && status.branch ? (
                <GitMenuRow icon={GitCompareArrows} onClick={() => void openBranchComparison()}>
                  {i18nService.t('codingGitCompareBranch')}
                </GitMenuRow>
              ) : null}
            </div>
          ) : (
            <div className="px-2 py-4 text-sm text-muted-foreground">
              {i18nService.t('codingGitNoRepositoryDescription')}
            </div>
          )}
        </PopoverContent>
      </Popover>
      <Dialog open={commitOpen} onOpenChange={setCommitOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><GitBranch />{status?.branch ?? i18nService.t('codingGitDetached')}</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Textarea id="coding-git-quick-commit" value={commitMessage} onChange={event => setCommitMessage(event.target.value)} placeholder={i18nService.t('codingGitCommitPlaceholder')} className="min-h-24 resize-none" />
            <Field orientation="horizontal">
              <Checkbox id="coding-git-include-unstaged" checked={includeUnstaged} onCheckedChange={checked => setIncludeUnstaged(checked === true)} />
              <FieldLabel htmlFor="coding-git-include-unstaged" className="font-normal">{i18nService.t('codingGitIncludeUnstaged')}</FieldLabel>
              <span className={cn('ml-auto text-sm', 'text-muted-foreground')}><span className="text-success">+{status?.additions ?? 0}</span> <span className="text-destructive">−{status?.deletions ?? 0}</span></span>
            </Field>
          </FieldGroup>
          <Separator />
          <div className="flex flex-col gap-1">
            <Button type="button" variant="ghost" className="w-full justify-start gap-2" disabled={!canCommit || !commitMessage.trim() || pendingAction !== null} onClick={() => void runCommit(false)}>{pendingAction === 'commit' ? <Spinner /> : <GitCommitHorizontal />}{i18nService.t('codingGitCommit')}</Button>
            <Button type="button" variant="ghost" className="w-full justify-start gap-2" disabled={!canCommitAndPush || !commitMessage.trim() || pendingAction !== null} onClick={() => void runCommit(true)}>{pendingAction === 'commitAndPush' ? <Spinner /> : <CloudUpload />}{i18nService.t('codingGitCommitAndPush')}</Button>
            <Button type="button" variant="ghost" className="w-full justify-start gap-2" disabled={!canPush || pendingAction !== null} onClick={() => void push()}>{pendingAction === 'push' ? <Spinner /> : <CloudUpload />}{i18nService.t('codingGitPush')}</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={pullRequestOpen} onOpenChange={handlePullRequestOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-muted-foreground">
              {status?.branch ?? i18nService.t('codingGitDetached')} → {pullRequestBase}
            </DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Input id="coding-git-pr-title" value={pullRequestTitle} onChange={event => setPullRequestTitle(event.target.value)} placeholder={i18nService.t('codingGitPullRequestTitle')} aria-label={i18nService.t('codingGitPullRequestTitle')} />
            <Textarea id="coding-git-pr-body" value={pullRequestBody} onChange={event => setPullRequestBody(event.target.value)} placeholder={i18nService.t('codingGitPullRequestBodyPlaceholder')} aria-label={i18nService.t('codingGitPullRequestBody')} className="min-h-24 resize-none" />
          </FieldGroup>
          <Separator />
          <div className="flex flex-col gap-1">
            <Button type="button" variant="ghost" className="w-full justify-start gap-2" disabled={pendingAction !== null || !pullRequestTitle.trim() || pullRequestUrl !== null} onClick={() => void createPullRequest(true)}>{pendingAction === 'pullRequest' && isDraftPullRequest ? <Spinner /> : <GitPullRequestCreate />}{i18nService.t('codingGitCreateDraftPullRequest')}</Button>
            <Button type="button" variant="ghost" className="w-full justify-start gap-2" disabled={pendingAction !== null || !pullRequestTitle.trim() || pullRequestUrl !== null} onClick={() => void createPullRequest(false)}>{pendingAction === 'pullRequest' && !isDraftPullRequest ? <Spinner /> : <GitPullRequestCreate />}{i18nService.t('codingGitCreatePullRequest')}</Button>
            <Button type="button" variant="ghost" className="w-full justify-start gap-2" disabled={!pullRequestUrl} onClick={() => void openPullRequestInBrowser()}><ExternalLink />{i18nService.t('codingGitOpenPullRequest')}</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={createBranchOpen} onOpenChange={setCreateBranchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{i18nService.t('codingGitCreateBranchTitle')}</DialogTitle>
            <DialogDescription>{i18nService.t('codingGitCreateBranchDescription')}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="coding-git-new-branch">
                {i18nService.t('codingGitCreateBranchName')}
              </FieldLabel>
              <Input
                id="coding-git-new-branch"
                value={newBranchName}
                onChange={event => setNewBranchName(event.target.value)}
              />
            </Field>
          </FieldGroup>
          <DialogFooter surface={DialogFooterSurface.Seamless}>
            <Button type="button" variant="outline" onClick={() => setCreateBranchOpen(false)}>
              {i18nService.t('codingGitCancel')}
            </Button>
            <Button
              type="button"
              disabled={!newBranchName.trim() || pendingBranch !== null || status?.isIsolated}
              onClick={() => void createBranch()}
            >
              {pendingBranch === newBranchName.trim() ? <Spinner /> : <Plus />}
              {i18nService.t('codingGitCreateBranch')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
