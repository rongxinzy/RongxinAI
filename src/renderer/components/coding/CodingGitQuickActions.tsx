import { Button } from '@shared/components/ui/button';
import { Checkbox } from '@shared/components/ui/checkbox';
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
import { Popover, PopoverContent, PopoverTrigger } from '@shared/components/ui/popover';
import { Spinner } from '@shared/components/ui/spinner';
import { cn } from '@shared/lib/utils';
import { Check, ChevronDown, FileDiff, GitBranch, GitPullRequest, Send, SlidersHorizontal, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import type { CodingGitStatus, CodingGitTargetInput } from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
import { normalizeError } from '../../services/errorNormalization';
import { CodingGitQuickActionMode, type CodingGitQuickActionMode as CodingGitQuickActionModeType } from './constants';

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
  icon: typeof FileDiff;
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
  const [branchFilter, setBranchFilter] = useState('');
  const [pendingBranch, setPendingBranch] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [pullRequestTitle, setPullRequestTitle] = useState('');
  const [pullRequestBody, setPullRequestBody] = useState('');
  const [pullRequestBase, setPullRequestBase] = useState('main');

  const loadStatus = useCallback(async () => {
    setLoading(true);
    const result = await window.electron.codingAgent.getGitStatus(target);
    setLoading(false);
    if (result.success && result.status) {
      setStatus(result.status);
      return result.status;
    }
    toast.error(normalizeError(result.error ?? i18nService.t('codingGitActionFailed')));
    return null;
  }, [target]);

  useEffect(() => {
    if (open) void loadStatus();
  }, [loadStatus, open, refreshKey]);

  const unstagedPaths = useMemo(
    () => status?.files.filter(file => file.worktreeStatus !== null).map(file => file.path) ?? [],
    [status],
  );
  const branches = useMemo(() => {
    const query = branchFilter.trim().toLocaleLowerCase();
    return (status?.localBranches ?? []).filter(branch => !query || branch.toLocaleLowerCase().includes(query));
  }, [branchFilter, status?.localBranches]);

  const openReview = () => {
    setOpen(false);
    onOpenReview?.();
  };

  const openCommit = () => {
    setOpen(false);
    setCommitOpen(true);
  };

  const createPullRequest = async () => {
    if (!status || !pullRequestTitle.trim() || !pullRequestBase.trim()) return;
    setPendingAction('pullRequest');
    const result = await window.electron.codingAgent.createGitPullRequest({ ...target, title: pullRequestTitle, body: pullRequestBody, base: pullRequestBase });
    setPendingAction(null);
    if (!result.success || !result.url) {
      toast.error(normalizeError(result.error ?? i18nService.t('codingGitActionFailed')));
      return;
    }
    setPullRequestOpen(false);
    setPullRequestTitle('');
    setPullRequestBody('');
    toast.success(i18nService.t('codingGitPullRequestCreated'));
    void window.electron.shell.openExternal(result.url);
  };

  const switchBranch = async (branch: string) => {
      if (!status || branch === status.branch || !status.canMutate) return;
    setPendingBranch(branch);
    const result = await window.electron.codingAgent.switchGitBranch({ ...target, branch });
    setPendingBranch(null);
    if (result.success && result.status) {
      setStatus(result.status);
      setBranchOpen(false);
      toast.success(i18nService.t('codingGitBranchSwitched'));
      return;
    }
    toast.error(normalizeError(result.error ?? i18nService.t('codingGitActionFailed')));
  };

  const runCommit = async (pushAfterCommit: boolean) => {
    const message = commitMessage.trim();
    if (!message || !status) return;
    setPendingAction(pushAfterCommit ? 'commitAndPush' : 'commit');
    try {
      if (includeUnstaged && unstagedPaths.length > 0) {
        const staged = await window.electron.codingAgent.stageGitPaths({ ...target, paths: unstagedPaths });
        if (!staged.success) throw new Error(staged.error ?? i18nService.t('codingGitActionFailed'));
      }
      const committed = await window.electron.codingAgent.commitGitChanges({ ...target, message });
      if (!committed.success) throw new Error(committed.error ?? i18nService.t('codingGitActionFailed'));
      if (pushAfterCommit) {
        const pushed = await window.electron.codingAgent.pushGitBranch(target);
        if (!pushed.success) throw new Error(pushed.error ?? i18nService.t('codingGitActionFailed'));
      }
      toast.success(i18nService.t(pushAfterCommit ? 'codingGitCommittedAndPushed' : 'codingGitCommitted'));
      setCommitMessage('');
      setCommitOpen(false);
      await loadStatus();
    } catch (error) {
      toast.error(normalizeError(error instanceof Error ? error.message : String(error)));
    } finally {
      setPendingAction(null);
    }
  };

  const push = async () => {
    setPendingAction('push');
    const result = await window.electron.codingAgent.pushGitBranch(target);
    setPendingAction(null);
    if (result.success) {
      toast.success(i18nService.t('codingGitPushed'));
      await loadStatus();
      return;
    }
    toast.error(normalizeError(result.error ?? i18nService.t('codingGitActionFailed')));
  };

  const openRepository = async () => {
    if (!status?.githubRepositoryUrl) return;
    const result = await window.electron.shell.openExternal(status.githubRepositoryUrl);
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
              <GitMenuRow icon={Send} onClick={openCommit}>
                {i18nService.t('codingGitCommitOrPush')}
              </GitMenuRow>
              <GitMenuRow icon={GitPullRequest} onClick={() => { setOpen(false); setPullRequestOpen(true); }}>
                {i18nService.t('codingGitCreatePullRequest')}
              </GitMenuRow>
            </div>
          ) : status?.isRepository ? (
            <div className="space-y-1">
              <GitMenuRow icon={FileDiff} onClick={openReview} trailing={<span className="text-xs"><span className="text-success">+{status.additions}</span> <span className="text-destructive">−{status.deletions}</span></span>}>
                {i18nService.t('codingGitChanges')}
              </GitMenuRow>
              <Popover open={branchOpen} onOpenChange={setBranchOpen}>
                <PopoverTrigger render={<Button type="button" variant="ghost" className="w-full justify-start gap-2" />}>
                  <GitBranch className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-left">{status.detached ? i18nService.t('codingGitDetached') : (status.branch ?? status.head ?? '—')}</span>
                  <span className="text-xs text-muted-foreground">{status.upstream ?? '—'}</span>
                  <ChevronDown />
                </PopoverTrigger>
                <PopoverContent side="left" align="start" className="w-80 p-2">
                  <Input value={branchFilter} placeholder={i18nService.t('codingGitBranch')} onChange={event => setBranchFilter(event.target.value)} />
                  <div className="mt-2 space-y-1">
                    {branches.map(branch => (
                      <Button key={branch} type="button" variant={branch === status.branch ? 'secondary' : 'ghost'} disabled={branch === status.branch || pendingBranch !== null || !status.canMutate} className="w-full justify-start gap-2" onClick={() => void switchBranch(branch)}>
                        <GitBranch />
                        <span className="min-w-0 flex-1 truncate text-left">{branch}</span>
                        {pendingBranch === branch ? <Spinner /> : branch === status.branch ? <Check /> : null}
                      </Button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              <GitMenuRow icon={Send} onClick={openCommit}>
                {i18nService.t('codingGitCommitOrPush')}
              </GitMenuRow>
              {status.githubRepositoryUrl ? (
                <GitMenuRow icon={GitBranch} onClick={() => void openRepository()}>
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
            <DialogDescription>{i18nService.t('codingGitCommitDialogDescription')}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="coding-git-quick-commit">{i18nService.t('codingGitCommitMessage')}</FieldLabel>
              <Input id="coding-git-quick-commit" value={commitMessage} onChange={event => setCommitMessage(event.target.value)} placeholder={i18nService.t('codingGitCommitPlaceholder')} />
            </Field>
            <Field orientation="horizontal">
              <Checkbox id="coding-git-include-unstaged" checked={includeUnstaged} onCheckedChange={checked => setIncludeUnstaged(checked === true)} />
              <FieldLabel htmlFor="coding-git-include-unstaged" className="font-normal">{i18nService.t('codingGitIncludeUnstaged')}</FieldLabel>
              <span className={cn('ml-auto text-sm', 'text-muted-foreground')}><span className="text-success">+{status?.additions ?? 0}</span> <span className="text-destructive">−{status?.deletions ?? 0}</span></span>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={!status?.canMutate || pendingAction !== null || status?.ahead === 0 || !status?.upstream} onClick={() => void push()}>{pendingAction === 'push' ? <Spinner /> : <Upload />}{i18nService.t('codingGitPush')}</Button>
            <Button type="button" variant="outline" disabled={!status?.canMutate || !commitMessage.trim() || pendingAction !== null} onClick={() => void runCommit(false)}>{pendingAction === 'commit' ? <Spinner /> : <Send />}{i18nService.t('codingGitCommit')}</Button>
            <Button type="button" disabled={!status?.canMutate || !commitMessage.trim() || pendingAction !== null || !status?.upstream} onClick={() => void runCommit(true)}>{pendingAction === 'commitAndPush' ? <Spinner /> : <Upload />}{i18nService.t('codingGitCommitAndPush')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={pullRequestOpen} onOpenChange={setPullRequestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{i18nService.t('codingGitCreatePullRequest')}</DialogTitle>
            <DialogDescription>{i18nService.t('codingGitPullRequestDescription')}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field><FieldLabel htmlFor="coding-git-pr-title">{i18nService.t('codingGitPullRequestTitle')}</FieldLabel><Input id="coding-git-pr-title" value={pullRequestTitle} onChange={event => setPullRequestTitle(event.target.value)} /></Field>
            <Field><FieldLabel htmlFor="coding-git-pr-base">{i18nService.t('codingGitPullRequestBase')}</FieldLabel><Input id="coding-git-pr-base" value={pullRequestBase} onChange={event => setPullRequestBase(event.target.value)} /></Field>
            <Field><FieldLabel htmlFor="coding-git-pr-body">{i18nService.t('codingGitPullRequestBody')}</FieldLabel><Input id="coding-git-pr-body" value={pullRequestBody} onChange={event => setPullRequestBody(event.target.value)} /></Field>
          </FieldGroup>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setPullRequestOpen(false)}>{i18nService.t('codingGitCancel')}</Button><Button type="button" disabled={pendingAction !== null || !pullRequestTitle.trim()} onClick={() => void createPullRequest()}>{pendingAction === 'pullRequest' ? <Spinner /> : <GitPullRequest />}{i18nService.t('codingGitCreatePullRequest')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
