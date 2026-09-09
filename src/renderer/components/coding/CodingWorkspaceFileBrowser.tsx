import { CodeBlock } from '@shared/components/ai-elements/code-block';
import { Button } from '@shared/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@shared/components/ui/empty';
import { FluidTabs } from '@shared/components/ui/fluid-tabs';
import { Input } from '@shared/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/components/ui/popover';
import { ScrollArea } from '@shared/components/ui/scroll-area';
import { Textarea } from '@shared/components/ui/textarea';
import { ChevronRight, File, FileSearch, Folder, FolderOpen, LoaderCircle, RotateCcw, Save } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  CodingWorkspaceFileKind,
  type CodingWorkspaceFileEntry,
} from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
import MarkdownContent from '../MarkdownContent';
import { CodingWorkspaceFileView } from './constants';
import { resolveWorkspaceMarkdownLink } from './workspaceFileLink';

interface CodingWorkspaceFileBrowserProps {
  workspaceRoot: string;
  sourceRoot: string;
  onFileSaved?: () => void;
}

interface TreeNode extends CodingWorkspaceFileEntry {
  children?: TreeNode[];
  loaded?: boolean;
}

const EMPTY_NODES: TreeNode[] = [];

const flattenFiles = (nodes: TreeNode[]): TreeNode[] =>
  nodes.flatMap(node => {
    if (node.kind !== CodingWorkspaceFileKind.Directory) return [node];
    return node.children ? flattenFiles(node.children) : [];
  });

const FILE_PREVIEW_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.css': 'css',
  '.html': 'html',
  '.java': 'java',
  '.js': 'javascript',
  '.json': 'json',
  '.jsx': 'jsx',
  '.mjs': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.sh': 'shellscript',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
};

const getFileExtension = (path: string): string => {
  const lastDot = path.lastIndexOf('.');
  return lastDot === -1 ? '' : path.slice(lastDot).toLowerCase();
};

const isMarkdownFilePath = (path: string): boolean => {
  const extension = getFileExtension(path);
  return extension === '.md' || extension === '.mdx';
};

const getPreviewLanguage = (path: string, content: string): string => {
  const extensionLanguage = FILE_PREVIEW_LANGUAGE_BY_EXTENSION[getFileExtension(path)];
  if (extensionLanguage) return extensionLanguage;
  const trimmedContent = content.trimStart();
  return trimmedContent.startsWith('{') || trimmedContent.startsWith('[') ? 'json' : 'text';
};

const replaceNodeChildren = (nodes: TreeNode[], path: string, children: TreeNode[]): TreeNode[] =>
  nodes.map(node => {
    if (node.path === path) return { ...node, children, loaded: true };
    return node.children
      ? { ...node, children: replaceNodeChildren(node.children, path, children) }
      : node;
  });

/**
 * Keeps the nodes whose own name matches the query plus the ancestor chain of
 * every nested match, so the filter can surface files below unloaded-looking
 * folders instead of hiding them with their non-matching parents.
 */
const filterTreeNodes = (nodes: TreeNode[], query: string): TreeNode[] => {
  if (!query) return nodes;
  const walk = (node: TreeNode): TreeNode | null => {
    const children = node.children
      ? node.children.map(walk).filter((child): child is TreeNode => child !== null)
      : undefined;
    const selfMatch = node.name.toLocaleLowerCase().includes(query);
    if (!selfMatch && (!children || children.length === 0)) return null;
    return children ? { ...node, children } : node;
  };
  return nodes.map(walk).filter((node): node is TreeNode => node !== null);
};

export const CodingWorkspaceFileBrowser = ({
  workspaceRoot,
  sourceRoot,
  onFileSaved,
}: CodingWorkspaceFileBrowserProps) => {
  const [nodes, setNodes] = useState<TreeNode[]>(EMPTY_NODES);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(() => new Set(['']));
  const [filter, setFilter] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedContent, setSelectedContent] = useState<string | null>(null);
  const [draftContent, setDraftContent] = useState('');
  const [selectedSha256, setSelectedSha256] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFiles, setShowFiles] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [fileView, setFileView] = useState<CodingWorkspaceFileView>(
    CodingWorkspaceFileView.Preview,
  );
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
    setDraftContent('');
    setSelectedSha256(null);
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
      setDraftContent('');
      setSelectedSha256(null);
      setLoadingFile(true);
      setFileView(CodingWorkspaceFileView.Preview);
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
        setDraftContent(result.file.content);
        setSelectedSha256(result.file.sha256);
      } catch (cause) {
        if (fileRequestId.current !== requestId) return;
        setError(cause instanceof Error ? cause.message : i18nService.t('codingAgentFilesPreviewUnavailable'));
      } finally {
        if (fileRequestId.current === requestId) setLoadingFile(false);
      }
    },
    [sourceRoot, workspaceRoot],
  );

  const isDirty = selectedContent !== null && draftContent !== selectedContent;
  const saveFile = useCallback(async () => {
    if (!selectedPath || selectedSha256 === null || !isDirty) return;
    setIsSaving(true);
    try {
      const result = await window.electron.codingAgent.writeWorkspaceFile({
        workspaceRoot,
        sourceRoot,
        path: selectedPath,
        content: draftContent,
        expectedSha256: selectedSha256,
      });
      if (!result.success || !result.file) {
        setError(result.error ?? i18nService.t('codingAgentFileSaveFailed'));
        return;
      }
      setSelectedContent(result.file.content);
      setDraftContent(result.file.content);
      setSelectedSha256(result.file.sha256);
      setError(null);
      onFileSaved?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : i18nService.t('codingAgentFileSaveFailed'));
    } finally {
      setIsSaving(false);
    }
  }, [draftContent, isDirty, onFileSaved, selectedPath, selectedSha256, sourceRoot, workspaceRoot]);

  const normalizedFilter = filter.trim().toLocaleLowerCase();
  const visibleNodes = useMemo(
    () => filterTreeNodes(nodes, normalizedFilter),
    [nodes, normalizedFilter],
  );
  const supportsPreview = selectedPath !== null;
  const searchableFiles = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    return flattenFiles(nodes).filter(node => !query || node.path.toLocaleLowerCase().includes(query));
  }, [nodes, searchQuery]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-10 items-center justify-between gap-2 border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2">
          <FolderOpen className="size-4 shrink-0" />
          <span className="truncate text-sm font-medium">{i18nService.t('codingAgentFilesTitle')}</span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Popover open={searchOpen} onOpenChange={setSearchOpen}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={i18nService.t('codingAgentFilesFilter')}
              />
            }
          >
            <FileSearch />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-2">
            <Input
              value={searchQuery}
              placeholder={i18nService.t('codingAgentFilesFilter')}
              aria-label={i18nService.t('codingAgentFilesFilter')}
              onChange={event => setSearchQuery(event.target.value)}
            />
            <ScrollArea className="mt-2 h-72">
              <div className="space-y-1">
                {searchableFiles.map(node => (
                  <Button
                    key={node.path}
                    type="button"
                    variant={node.path === selectedPath ? 'secondary' : 'ghost'}
                    className="w-full justify-start gap-2"
                    onClick={() => {
                      setSearchOpen(false);
                      void openFile(node);
                    }}
                  >
                    <File />
                    <span className="min-w-0 flex-1 truncate text-left">{node.path}</span>
                  </Button>
                ))}
                {searchableFiles.length === 0 ? (
                  <p className="px-2 py-3 text-sm text-muted-foreground">
                    {i18nService.t('codingAgentFilesEmpty')}
                  </p>
                ) : null}
              </div>
            </ScrollArea>
          </PopoverContent>
          </Popover>
          <Button
            type="button"
            variant={showFiles ? 'secondary' : 'ghost'}
            size="icon-sm"
            aria-label={i18nService.t('codingAgentFiles')}
            aria-pressed={showFiles}
            onClick={() => setShowFiles(current => !current)}
          >
            <FolderOpen />
          </Button>
        </div>
      </header>
      {error ? <p className="px-3 pt-2 text-xs text-destructive">{error}</p> : null}
      {supportsPreview && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1.5">
          <FluidTabs<CodingWorkspaceFileView>
            aria-label={i18nService.t('artifactViewMode')}
            value={fileView}
            onValueChange={setFileView}
            items={[
              {
                value: CodingWorkspaceFileView.Preview,
                label: i18nService.t('artifactPreview'),
              },
              { value: CodingWorkspaceFileView.Code, label: i18nService.t('codingAgentSourceFile') },
            ]}
          />
          {fileView === CodingWorkspaceFileView.Code && (
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!isDirty || isSaving}
                onClick={() => {
                  setDraftContent(selectedContent ?? '');
                  setError(null);
                }}
              >
                <RotateCcw data-icon="inline-start" />
                {i18nService.t('codingAgentDiscardChanges')}
              </Button>
              <Button type="button" size="sm" disabled={!isDirty || isSaving} onClick={() => void saveFile()}>
                {isSaving ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Save data-icon="inline-start" />}
                {i18nService.t('codingAgentSaveFile')}
              </Button>
            </div>
          )}
        </div>
      )}
      <div className={showFiles ? 'grid min-h-0 flex-1 grid-cols-2' : 'min-h-0 flex-1'}>
        <section className={showFiles ? 'min-h-0 min-w-0 border-r border-border' : 'h-full min-h-0'}>
          {loadingFile ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
            </div>
          ) : selectedContent !== null && selectedPath ? (
            <ScrollArea className="h-full">
              {fileView === CodingWorkspaceFileView.Preview && isMarkdownFilePath(selectedPath) ? (
                <MarkdownContent
                  content={selectedContent}
                  className="p-4"
                  restrictLocalFileLinks
                  resolveLocalFilePath={href =>
                    resolveWorkspaceMarkdownLink(href, sourceRoot, selectedPath)
                  }
                />
              ) : fileView === CodingWorkspaceFileView.Preview ? (
                <CodeBlock
                  code={selectedContent}
                  language={getPreviewLanguage(selectedPath, selectedContent)}
                  showLineNumbers
                />
              ) : (
                <div className="h-full p-3">
                  <Textarea
                    value={draftContent}
                    onChange={event => setDraftContent(event.target.value)}
                    aria-label={selectedPath}
                    className="h-full min-h-0 resize-none font-mono text-xs"
                    spellCheck={false}
                  />
                </div>
              )}
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
        {showFiles ? (
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
                  filterActive={Boolean(normalizedFilter)}
                  onToggleDirectory={toggleDirectory}
                  onOpenFile={openFile}
                />
              )}
            </ScrollArea>
          </section>
        ) : null}
      </div>
    </div>
  );
};

interface FileTreeProps {
  nodes: TreeNode[];
  expandedPaths: Set<string>;
  loadingPaths: Set<string>;
  selectedPath: string | null;
  filterActive: boolean;
  onToggleDirectory: (node: TreeNode) => void;
  onOpenFile: (node: TreeNode) => void;
}

const FileTree = ({
  nodes,
  expandedPaths,
  loadingPaths,
  selectedPath,
  filterActive,
  onToggleDirectory,
  onOpenFile,
}: FileTreeProps) => (
  <div className="flex flex-col gap-0.5">
    {nodes.map(node => {
      const directory = node.kind === CodingWorkspaceFileKind.Directory;
      // While filtering, reveal matching descendants even under folders the
      // user had collapsed; the node list is already pruned to matches.
      const expanded = expandedPaths.has(node.path) || (filterActive && Boolean(node.children));
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
                nodes={node.children}
                expandedPaths={expandedPaths}
                loadingPaths={loadingPaths}
                selectedPath={selectedPath}
                filterActive={filterActive}
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
