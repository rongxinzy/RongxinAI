import { Alert, AlertDescription } from '@shared/components/ui/alert';
import { Button } from '@shared/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@shared/components/ui/empty';
import { Input } from '@shared/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/components/ui/popover';
import { ScrollArea } from '@shared/components/ui/scroll-area';
import { Spinner } from '@shared/components/ui/spinner';
import { cn } from '@shared/lib/utils';
import { AlertTriangle, ChevronDown, ChevronRight, FileDiff, FileSearch, FolderGit2, FolderOpen, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CodingGitDiffScope as CodingGitDiffScopeType, CodingGitFileChange, CodingGitStatus, CodingGitTargetInput } from '../../../shared/codingAgent';
import { CodingGitDiffScope, CodingGitFileStatus } from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
import { CodingGitQuickActions } from './CodingGitQuickActions';
import { CodingGitQuickActionMode } from './constants';

interface CodingGitPanelProps { workspaceRoot: string; laneId: string | null; sourceRoot: string; refreshKey: string; onClose?: () => void; }
interface DiffSelection { path: string; scope: CodingGitDiffScopeType; }
interface GitFileTreeNode { name: string; path: string; file: CodingGitFileChange | null; children: Map<string, GitFileTreeNode>; }

const diffScopeForFile = (file: CodingGitFileChange): CodingGitDiffScopeType => {
  if (file.worktreeStatus === CodingGitFileStatus.Untracked) return CodingGitDiffScope.Untracked;
  if (file.worktreeStatus !== null) return CodingGitDiffScope.Unstaged;
  return CodingGitDiffScope.Staged;
};

const buildFileTree = (files: CodingGitFileChange[]): GitFileTreeNode[] => {
  const root = new Map<string, GitFileTreeNode>();
  for (const file of files) {
    let current = root;
    let path = '';
    for (const [index, name] of file.path.split('/').entries()) {
      path = path ? `${path}/${name}` : name;
      let node = current.get(name);
      if (!node) { node = { name, path, file: null, children: new Map() }; current.set(name, node); }
      if (index === file.path.split('/').length - 1) node.file = file;
      current = node.children;
    }
  }
  return Array.from(root.values());
};

const CodingGitDiffLineKind = {
  Added: 'added',
  Removed: 'removed',
  Context: 'context',
  Header: 'header',
} as const;
type CodingGitDiffLineKind = (typeof CodingGitDiffLineKind)[keyof typeof CodingGitDiffLineKind];

interface CodingGitDiffLine {
  kind: CodingGitDiffLineKind;
  oldLineNumber: number | null;
  newLineNumber: number | null;
  text: string;
  prefix: string;
}

const DIFF_GUTTER_CLASS: Record<CodingGitDiffLineKind, string> = {
  [CodingGitDiffLineKind.Added]: 'theme-coding-diff-gutter-added',
  [CodingGitDiffLineKind.Removed]: 'theme-coding-diff-gutter-removed',
  [CodingGitDiffLineKind.Context]: 'theme-coding-diff-gutter-context',
  [CodingGitDiffLineKind.Header]: 'theme-coding-diff-gutter-header',
};

const DIFF_LINE_HOOK: Record<CodingGitDiffLineKind, string> = {
  [CodingGitDiffLineKind.Added]: 'theme-coding-diff-line theme-coding-diff-line-added',
  [CodingGitDiffLineKind.Removed]: 'theme-coding-diff-line theme-coding-diff-line-removed',
  [CodingGitDiffLineKind.Context]: 'theme-coding-diff-line theme-coding-diff-line-context',
  [CodingGitDiffLineKind.Header]: 'theme-coding-diff-line theme-coding-diff-line-header',
};

const DiffLine = ({ line }: { line: CodingGitDiffLine }) => {
  if (line.kind === CodingGitDiffLineKind.Header) {
    return (
      <div
        data-kind={line.kind}
        className={cn('w-full min-w-max grid grid-cols-[3rem_3rem_1.5rem_minmax(max-content,1fr)]', DIFF_LINE_HOOK[line.kind])}
      >
        <span className="col-span-4 whitespace-pre">{line.text}</span>
      </div>
    );
  }

  return (
    <div
      data-kind={line.kind}
      className={cn('w-full min-w-max grid grid-cols-[3rem_3rem_1.5rem_minmax(max-content,1fr)]', DIFF_LINE_HOOK[line.kind])}
    >
      <span className={cn('theme-coding-diff-gutter select-none', DIFF_GUTTER_CLASS[line.kind])}>{line.oldLineNumber ?? ''}</span>
      <span className={cn('theme-coding-diff-gutter select-none', DIFF_GUTTER_CLASS[line.kind])}>{line.newLineNumber ?? ''}</span>
      <span className={cn('theme-coding-diff-gutter theme-coding-diff-prefix select-none', DIFF_GUTTER_CLASS[line.kind])}>{line.prefix}</span>
      <span className="theme-coding-diff-code whitespace-pre">{line.text || '\u00a0'}</span>
    </div>
  );
};

const diffHunkPattern = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

const parseGitDiff = (value: string): CodingGitDiffLine[] => {
  let oldLineNumber = 0;
  let newLineNumber = 0;
  let inHunk = false;
  const lines = value.split('\n');
  if (lines.at(-1) === '') lines.pop();

  return lines.map(line => {
    const hunk = diffHunkPattern.exec(line);
    if (hunk) {
      oldLineNumber = Number(hunk[1]);
      newLineNumber = Number(hunk[2]);
      inHunk = true;
      return { kind: CodingGitDiffLineKind.Header, oldLineNumber: null, newLineNumber: null, text: line, prefix: '' };
    }

    if (!inHunk) {
      return { kind: CodingGitDiffLineKind.Header, oldLineNumber: null, newLineNumber: null, text: line, prefix: '' };
    }

    const prefix = line[0] ?? ' ';
    const text = line.slice(1);
    if (prefix === '+') {
      return {
        kind: CodingGitDiffLineKind.Added,
        oldLineNumber: null,
        newLineNumber: newLineNumber++,
        text,
        prefix,
      };
    }
    if (prefix === '-') {
      return {
        kind: CodingGitDiffLineKind.Removed,
        oldLineNumber: oldLineNumber++,
        newLineNumber: null,
        text,
        prefix,
      };
    }
    if (prefix === ' ') {
      return {
        kind: CodingGitDiffLineKind.Context,
        oldLineNumber: oldLineNumber++,
        newLineNumber: newLineNumber++,
        text,
        prefix,
      };
    }

    return { kind: CodingGitDiffLineKind.Header, oldLineNumber: null, newLineNumber: null, text: line, prefix: '' };
  });
};

export const CodingGitPanel = ({ workspaceRoot, laneId, sourceRoot, refreshKey, onClose }: CodingGitPanelProps) => {
  const [status, setStatus] = useState<CodingGitStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [jumpOpen, setJumpOpen] = useState(false);
  const [showFiles, setShowFiles] = useState(true);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [diffSelection, setDiffSelection] = useState<DiffSelection | null>(null);
  const [diff, setDiff] = useState('');
  const [diffLoading, setDiffLoading] = useState(false);
  const requestSequence = useRef(0);
  const target = useMemo<CodingGitTargetInput>(() => ({ workspaceRoot, laneId: laneId ?? undefined, sourceRoot }), [laneId, sourceRoot, workspaceRoot]);
  const refresh = useCallback(async () => {
    const request = ++requestSequence.current;
    setLoading(true);
    const result = await window.electron.codingAgent.getGitStatus(target);
    if (request !== requestSequence.current) return;
    setLoading(false);
    if (result.success && result.status) { setStatus(result.status); setError(null); return; }
    setError(result.error ?? i18nService.t('codingGitActionFailed'));
  }, [target]);
  useEffect(() => { void refresh(); }, [refresh, refreshKey]);
  useEffect(() => { const handleFocus = () => void refresh(); window.addEventListener('focus', handleFocus); return () => window.removeEventListener('focus', handleFocus); }, [refresh]);
  const selectDiff = useCallback(async (selection: DiffSelection) => {
    setDiffSelection(selection); setDiff(''); setDiffLoading(true);
    const result = await window.electron.codingAgent.getGitDiff({ ...target, ...selection });
    setDiffLoading(false);
    setDiff(result.success ? (result.diff ?? '') : (result.error ?? i18nService.t('codingGitActionFailed')));
  }, [target]);
  useEffect(() => { if (!status?.isRepository || diffSelection || status.files.length === 0) return; const file = status.files[0]; void selectDiff({ path: file.path, scope: diffScopeForFile(file) }); }, [diffSelection, selectDiff, status]);
  useEffect(() => {
    const firstPath = status?.files[0]?.path;
    if (!firstPath) return;
    setExpandedPaths(current => {
      if (current.size > 0) return current;
      const segments = firstPath.split('/');
      return new Set(segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/')));
    });
  }, [status?.files]);
  const files = useMemo(() => { const query = filter.trim().toLocaleLowerCase(); return (status?.files ?? []).filter(file => !query || file.path.toLocaleLowerCase().includes(query)); }, [filter, status?.files]);
  const fileTree = useMemo(() => buildFileTree(files), [files]);
  const toggleFolder = (path: string) => setExpandedPaths(current => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next; });
  const renderTree = (nodes: GitFileTreeNode[], depth = 0): React.ReactNode => nodes.map(node => {
    const isFolder = node.children.size > 0;
    const expanded = expandedPaths.has(node.path);
    const selected = node.file?.path === diffSelection?.path;
    if (isFolder) return <div key={node.path}><Button type="button" variant="ghost" className="w-full justify-start gap-2" onClick={() => toggleFolder(node.path)} style={{ paddingInlineStart: `${depth * 16 + 8}px` }}>{expanded ? <ChevronDown /> : <ChevronRight />}<FolderOpen /><span className="min-w-0 flex-1 truncate text-left">{node.name}</span></Button>{expanded ? renderTree(Array.from(node.children.values()), depth + 1) : null}</div>;
    if (!node.file) return null;
    return <Button key={node.path} type="button" variant={selected ? 'secondary' : 'ghost'} className="w-full justify-start gap-2" onClick={() => void selectDiff({ path: node.file!.path, scope: diffScopeForFile(node.file!) })} style={{ paddingInlineStart: `${depth * 16 + 8}px` }}><FileDiff /><span className="min-w-0 flex-1 truncate text-left" title={node.file.path}>{node.name}</span><span className="shrink-0 text-xs"><span className="text-success">+{node.file.additions ?? 0}</span>{' '}<span className="text-destructive">−{node.file.deletions ?? 0}</span></span></Button>;
  });
  return <div className="flex h-full min-h-0 flex-col bg-background">
    <header className="flex min-h-10 shrink-0 items-center gap-2 border-b border-border px-3">
      <Button type="button" variant="secondary" size="sm" disabled>{status?.detached ? i18nService.t('codingGitDetached') : (status?.branch ?? status?.head ?? i18nService.t('codingGitBranch'))}<ChevronDown /></Button>
      <span className="flex shrink-0 items-center gap-2 text-sm"><span className="text-success">+{status?.additions ?? 0}</span><span className="text-destructive">−{status?.deletions ?? 0}</span></span>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Popover open={jumpOpen} onOpenChange={setJumpOpen}><PopoverTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={i18nService.t('codingGitSelectFile')} />}><FileSearch /></PopoverTrigger><PopoverContent align="end" className="w-80 p-2"><Input value={filter} placeholder={i18nService.t('codingGitFilesFilter')} onChange={event => setFilter(event.target.value)} /><ScrollArea className="mt-2 h-72"><div className="space-y-1">{files.map(file => <Button key={file.path} type="button" variant={file.path === diffSelection?.path ? 'secondary' : 'ghost'} className="w-full justify-start gap-2" onClick={() => { setJumpOpen(false); void selectDiff({ path: file.path, scope: diffScopeForFile(file) }); }}><FileDiff /><span className="min-w-0 flex-1 truncate text-left">{file.path}</span></Button>)}</div></ScrollArea></PopoverContent></Popover>
        <Button type="button" variant={showFiles ? 'secondary' : 'ghost'} size="icon-sm" aria-label={i18nService.t('codingAgentFiles')} aria-pressed={showFiles} onClick={() => setShowFiles(current => !current)}><FolderOpen /></Button>
        <CodingGitQuickActions
          target={target}
          refreshKey={refreshKey}
          mode={CodingGitQuickActionMode.Commit}
        />
        {onClose ? <Button type="button" variant="ghost" size="icon-sm" aria-label={i18nService.t('close')} onClick={onClose}><X /></Button> : null}
      </div>
    </header>
    <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle px-3 py-2 text-sm text-muted-foreground"><span className="truncate">{status?.branch ?? '—'}</span><span>→</span><span className="truncate">{status?.upstream ?? i18nService.t('codingGitNoUpstream')}</span></div>
    {error ? <Alert variant="destructive" className="m-3 shrink-0"><AlertTriangle /><AlertDescription className="break-words">{error}</AlertDescription></Alert> : null}
    {loading && !status ? <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner />{i18nService.t('codingGitLoading')}</div> : null}
    {status && !status.isRepository ? <Empty className="m-3 flex-1 border"><EmptyHeader><EmptyMedia variant="icon"><FolderGit2 /></EmptyMedia><EmptyTitle>{i18nService.t('codingGitNoRepositoryTitle')}</EmptyTitle><EmptyDescription>{i18nService.t('codingGitNoRepositoryDescription')}</EmptyDescription></EmptyHeader></Empty> : null}
    {status?.isRepository ? <div className={showFiles ? 'grid h-full min-h-0 flex-1 grid-cols-2' : 'h-full min-h-0 flex-1'}><ScrollArea className={showFiles ? 'h-full min-h-0 border-r border-border-subtle' : 'h-full min-h-0'}><div className="min-h-full p-3">{diffLoading ? <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner />{i18nService.t('codingGitLoading')}</div> : diffSelection ? <><p className="mb-2 truncate text-sm font-medium" title={diffSelection.path}>{diffSelection.path}</p>{diff ? <div className="theme-coding-diff min-w-0 overflow-x-auto"><div className="min-w-max">{parseGitDiff(diff).map((line, index) => <DiffLine key={`${index}-${line.text}`} line={line} />)}</div></div> : <p className="py-4 text-sm text-muted-foreground">{i18nService.t('codingGitDiffEmpty')}</p>}</> : <Empty className="min-h-56"><EmptyHeader><EmptyMedia variant="icon"><FileDiff /></EmptyMedia><EmptyTitle>{i18nService.t('codingGitDiffTitle')}</EmptyTitle><EmptyDescription>{i18nService.t('codingGitSelectFile')}</EmptyDescription></EmptyHeader></Empty>}</div></ScrollArea>{showFiles ? <div className="flex min-h-0 flex-col"><div className="shrink-0 p-3 pb-2"><Input value={filter} placeholder={i18nService.t('codingGitFilesFilter')} onChange={event => setFilter(event.target.value)} /></div><ScrollArea className="h-full min-h-0 flex-1 px-2 pb-3"><div className="flex flex-col gap-1">{renderTree(fileTree)}{files.length === 0 ? <p className="px-2 py-4 text-sm text-muted-foreground">{i18nService.t('codingGitDiffEmpty')}</p> : null}</div></ScrollArea></div> : null}</div> : null}
  </div>;
};
