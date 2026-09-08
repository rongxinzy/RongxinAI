import { Button } from '@shared/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@shared/components/ui/empty';
import { Input } from '@shared/components/ui/input';
import { ScrollArea } from '@shared/components/ui/scroll-area';
import { ChevronRight, File, Folder, FolderOpen, LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  CodingWorkspaceFileKind,
  type CodingWorkspaceFileEntry,
} from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';

interface CodingWorkspaceFileBrowserProps {
  workspaceRoot: string;
  sourceRoot: string;
}

interface TreeNode extends CodingWorkspaceFileEntry {
  children?: TreeNode[];
  loaded?: boolean;
}

const EMPTY_NODES: TreeNode[] = [];

const replaceNodeChildren = (nodes: TreeNode[], path: string, children: TreeNode[]): TreeNode[] =>
  nodes.map(node => {
    if (node.path === path) return { ...node, children, loaded: true };
    return node.children
      ? { ...node, children: replaceNodeChildren(node.children, path, children) }
      : node;
  });

export const CodingWorkspaceFileBrowser = ({
  workspaceRoot,
  sourceRoot,
}: CodingWorkspaceFileBrowserProps) => {
  const [nodes, setNodes] = useState<TreeNode[]>(EMPTY_NODES);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(() => new Set(['']));
  const [filter, setFilter] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedContent, setSelectedContent] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const directoryRequestIds = useRef(new Map<string, number>());
  const directoryRequestGeneration = useRef(0);
  const fileRequestId = useRef(0);

  const loadDirectory = useCallback(
    async (directoryPath: string) => {
      const generation = directoryRequestGeneration.current;
      const requestId = (directoryRequestIds.current.get(directoryPath) ?? 0) + 1;
      directoryRequestIds.current.set(directoryPath, requestId);
      setLoadingPaths(current => new Set(current).add(directoryPath));
      try {
        const result = await window.electron.codingAgent.listWorkspaceFiles({
          workspaceRoot,
          sourceRoot,
          path: directoryPath,
        });
        const entries = result.entries;
        if (
          directoryRequestGeneration.current !== generation ||
          directoryRequestIds.current.get(directoryPath) !== requestId
        ) return;
        if (!result.success || !entries) {
          setError(result.error ?? i18nService.t('codingAgentFilesPreviewUnavailable'));
          return;
        }
        setError(null);
        if (!directoryPath) setNodes(entries);
        else setNodes(current => replaceNodeChildren(current, directoryPath, entries));
      } catch (cause) {
        if (
          directoryRequestGeneration.current !== generation ||
          directoryRequestIds.current.get(directoryPath) !== requestId
        ) return;
        setError(cause instanceof Error ? cause.message : i18nService.t('codingAgentFilesPreviewUnavailable'));
      } finally {
        if (
          directoryRequestGeneration.current === generation &&
          directoryRequestIds.current.get(directoryPath) === requestId
        ) {
          setLoadingPaths(current => {
            const next = new Set(current);
            next.delete(directoryPath);
            return next;
          });
        }
      }
    },
    [sourceRoot, workspaceRoot],
  );

  useEffect(() => {
    directoryRequestGeneration.current += 1;
    directoryRequestIds.current.clear();
    fileRequestId.current += 1;
    setNodes(EMPTY_NODES);
    setExpandedPaths(new Set());
    setLoadingPaths(new Set(['']));
    setSelectedPath(null);
    setSelectedContent(null);
    setLoadingFile(false);
    setError(null);
    void loadDirectory('');
  }, [loadDirectory]);

  const toggleDirectory = useCallback(
    (node: TreeNode) => {
      setExpandedPaths(current => {
        const next = new Set(current);
        if (next.has(node.path)) next.delete(node.path);
        else next.add(node.path);
        return next;
      });
      if (!node.loaded) void loadDirectory(node.path);
    },
    [loadDirectory],
  );

  const openFile = useCallback(
    async (node: TreeNode) => {
      const requestId = ++fileRequestId.current;
      setSelectedPath(node.path);
      setSelectedContent(null);
      setLoadingFile(true);
      try {
        const result = await window.electron.codingAgent.readWorkspaceFile({
          workspaceRoot,
          sourceRoot,
          path: node.path,
        });
        if (fileRequestId.current !== requestId) return;
        if (!result.success || !result.file) {
          setError(result.error ?? i18nService.t('codingAgentFilesPreviewUnavailable'));
          return;
        }
        setError(null);
        setSelectedContent(result.file.content);
      } catch (cause) {
        if (fileRequestId.current !== requestId) return;
        setError(cause instanceof Error ? cause.message : i18nService.t('codingAgentFilesPreviewUnavailable'));
      } finally {
        if (fileRequestId.current === requestId) setLoadingFile(false);
      }
    },
    [sourceRoot, workspaceRoot],
  );

  const normalizedFilter = filter.trim().toLocaleLowerCase();
  const visibleNodes = useMemo(
    () =>
      normalizedFilter
        ? nodes.filter(node => node.name.toLocaleLowerCase().includes(normalizedFilter))
        : nodes,
    [nodes, normalizedFilter],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-10 items-center justify-between gap-2 border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2">
          <FolderOpen className="size-4 shrink-0" />
          <span className="truncate text-sm font-medium">{i18nService.t('codingAgentFilesTitle')}</span>
        </div>
      </header>
      {error ? <p className="px-3 pt-2 text-xs text-destructive">{error}</p> : null}
      <div className="grid min-h-0 flex-1 grid-cols-2">
        <section className="min-h-0 min-w-0 border-r border-border">
          {loadingFile ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
            </div>
          ) : selectedContent !== null && selectedPath ? (
            <ScrollArea className="h-full">
              <pre className="p-3 font-mono text-xs whitespace-pre-wrap break-words">{selectedContent}</pre>
            </ScrollArea>
          ) : (
            <Empty className="h-full border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon"><File /></EmptyMedia>
                <EmptyTitle>{i18nService.t('codingAgentFiles')}</EmptyTitle>
                <EmptyDescription>{i18nService.t('codingAgentFilesEmpty')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </section>
        <section className="flex min-h-0 min-w-0 flex-col">
          <div className="p-3">
            <Input
              value={filter}
              onChange={event => setFilter(event.target.value)}
              placeholder={i18nService.t('codingAgentFilesFilter')}
              aria-label={i18nService.t('codingAgentFilesFilter')}
            />
          </div>
          <ScrollArea className="min-h-0 flex-1 px-2 pb-3">
            {loadingPaths.has('') && nodes.length === 0 ? (
              <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                {i18nService.t('codingAgentFilesLoading')}
              </div>
            ) : (
              <FileTree
                nodes={visibleNodes}
                expandedPaths={expandedPaths}
                loadingPaths={loadingPaths}
                selectedPath={selectedPath}
                filter={normalizedFilter}
                onToggleDirectory={toggleDirectory}
                onOpenFile={openFile}
              />
            )}
          </ScrollArea>
        </section>
      </div>
    </div>
  );
};

interface FileTreeProps {
  nodes: TreeNode[];
  expandedPaths: Set<string>;
  loadingPaths: Set<string>;
  selectedPath: string | null;
  filter: string;
  onToggleDirectory: (node: TreeNode) => void;
  onOpenFile: (node: TreeNode) => void;
}

const FileTree = ({
  nodes,
  expandedPaths,
  loadingPaths,
  selectedPath,
  filter,
  onToggleDirectory,
  onOpenFile,
}: FileTreeProps) => (
  <div className="flex flex-col gap-0.5">
    {nodes.map(node => {
      const directory = node.kind === CodingWorkspaceFileKind.Directory;
      const expanded = expandedPaths.has(node.path);
      return (
        <div key={node.path} className="min-w-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-1"
            aria-expanded={directory ? expanded : undefined}
            aria-current={!directory && selectedPath === node.path ? 'page' : undefined}
            onClick={() => (directory ? onToggleDirectory(node) : void onOpenFile(node))}
          >
            {directory ? (
              <ChevronRight className={expanded ? 'rotate-90' : undefined} />
            ) : (
              <span className="size-4 shrink-0" />
            )}
            {directory ? expanded ? <FolderOpen /> : <Folder /> : <File />}
            <span className="min-w-0 truncate text-left">{node.name}</span>
            {loadingPaths.has(node.path) ? <LoaderCircle className="ml-auto size-3 animate-spin" /> : null}
          </Button>
          {directory && expanded && node.children ? (
            <div className="pl-4">
              <FileTree
                nodes={filter ? node.children.filter(child => child.name.toLocaleLowerCase().includes(filter)) : node.children}
                expandedPaths={expandedPaths}
                loadingPaths={loadingPaths}
                selectedPath={selectedPath}
                filter={filter}
                onToggleDirectory={onToggleDirectory}
                onOpenFile={onOpenFile}
              />
            </div>
          ) : null}
        </div>
      );
    })}
  </div>
);
