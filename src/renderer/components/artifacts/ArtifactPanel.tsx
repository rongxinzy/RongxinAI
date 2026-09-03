import { Button } from '@shared/components/ui/button';
import { FluidTabs } from '@shared/components/ui/fluid-tabs';
import { Skeleton } from '@shared/components/ui/skeleton';
import { ArrowLeft, Copy, Expand, Filter, Maximize2, Minimize2, Shrink } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '@/services/i18n';
import type { RootState } from '@/store';
import {
  addArtifact,
  ArtifactLayoutMode,
  ArtifactPanelView,
  closePanel,
  MIN_PANEL_WIDTH,
  selectActiveTab,
  selectArtifactLayoutMode,
  selectArtifact,
  selectPanelView,
  selectSessionSelectedArtifact,
  setActiveTab,
  setArtifactLayoutMode,
  setPanelView,
} from '@/store/slices/artifactSlice';
import type { ArtifactActiveTab } from '@/store/slices/artifactSlice';
import {
  ArtifactPreviewMode,
  ArtifactRole,
  getArtifactPreviewMode,
  isBinaryArtifactFile,
  type Artifact,
  type ArtifactType,
} from '@/types/artifact';
import { PREVIEWABLE_ARTIFACT_TYPES } from '@/types/artifact';

import ArtifactRenderer from './ArtifactRenderer';
import { toLocalFileUrl } from './artifactFileUrl';
import FileDirectoryView from './FileDirectoryView';
import ArtifactPanelResizeHandle from './ArtifactPanelResizeHandle';
import CodeRenderer from './renderers/CodeRenderer';
import { invalidateArtifactFile, loadArtifactFile } from '@/services/artifactFileLoader';

const t = (key: string) => i18nService.t(key);

const BROWSER_OPENABLE_TYPES = new Set<ArtifactType>(['html', 'svg', 'mermaid']);
const PANEL_LOADED_ARTIFACT_TYPES = new Set<ArtifactType>([
  'mermaid',
  'svg',
  'image',
  'code',
  'markdown',
  'text',
]);

function isDelimitedArtifact(artifact: Artifact): boolean {
  const name = (artifact.fileName || artifact.filePath || artifact.title || '').toLowerCase();
  return name.endsWith('.csv') || name.endsWith('.tsv');
}

function buildBrowserHtml(artifact: Artifact): string | null {
  switch (artifact.type) {
    case 'html':
      return artifact.content;
    case 'svg':
      return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${artifact.title}</title><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f5f5f5}</style></head><body>${artifact.content}</body></html>`;
    case 'mermaid':
      return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${artifact.title}</title><script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"><\/script><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff;font-family:system-ui,sans-serif}</style></head><body><pre class="mermaid">${escapeHtml(artifact.content)}</pre><script>mermaid.initialize({startOnLoad:true,theme:'default',securityLevel:'loose'});<\/script></body></html>`;
    default:
      return null;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface ArtifactPanelProps {
  sessionId: string | null;
  cwd?: string | null;
  artifacts: Artifact[];
  panelWidth: number;
  minPanelWidth?: number;
  maxPanelWidth: number;
  onResizeFrame: (width: number) => void;
  onResizeComplete: (width: number) => void;
}

const ArtifactPanel: React.FC<ArtifactPanelProps> = ({
  sessionId,
  cwd,
  artifacts,
  panelWidth,
  minPanelWidth = MIN_PANEL_WIDTH,
  maxPanelWidth,
  onResizeFrame,
  onResizeComplete,
}) => {
  const dispatch = useDispatch();
  const selectedArtifact = useSelector((state: RootState) =>
    selectSessionSelectedArtifact(state, sessionId),
  );
  const activeTab = useSelector(selectActiveTab);
  const panelView = useSelector(selectPanelView);
  const layoutMode = useSelector(selectArtifactLayoutMode);
  const selectedArtifactId = useSelector((state: RootState) => state.artifact.selectedArtifactId);
  const [showFileList, setShowFileList] = useState(false);
  const [showIntermediateArtifacts, setShowIntermediateArtifacts] = useState(false);
  const fileListRef = useRef<HTMLDivElement>(null);
  const toggleBtnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loadingArtifactId, setLoadingArtifactId] = useState<string | null>(null);
  const [artifactLoadError, setArtifactLoadError] = useState<string | null>(null);
  const isMac = window.electron.platform === 'darwin';
  const isTopLevelPanel = layoutMode === ArtifactLayoutMode.Workspace || isFullscreen;

  const visibleArtifacts = artifacts.filter(
    artifact => showIntermediateArtifacts || artifact.role === ArtifactRole.Deliverable,
  );
  const previewableArtifacts = visibleArtifacts.filter(a => PREVIEWABLE_ARTIFACT_TYPES.has(a.type));
  const artifactPreviewMode = selectedArtifact
    ? isDelimitedArtifact(selectedArtifact)
      ? ArtifactPreviewMode.Preview
      : getArtifactPreviewMode(selectedArtifact.type)
    : ArtifactPreviewMode.Preview;
  const availableTabs: ArtifactActiveTab[] =
    artifactPreviewMode === ArtifactPreviewMode.Preview
      ? ['preview']
      : artifactPreviewMode === ArtifactPreviewMode.Source
        ? ['code']
        : ['preview', 'code'];
  const displayedTab = availableTabs.includes(activeTab) ? activeTab : availableTabs[0];
  const isCodeView = displayedTab === 'code';
  const hasLocalFilePreview = Boolean(selectedArtifact?.filePath) && !isCodeView;

  useEffect(() => {
    if (
      panelView !== ArtifactPanelView.Preview ||
      !selectedArtifact ||
      selectedArtifact.content ||
      !selectedArtifact.filePath ||
      (!PANEL_LOADED_ARTIFACT_TYPES.has(selectedArtifact.type) &&
        !(isCodeView && selectedArtifact.type === 'html'))
    ) {
      setLoadingArtifactId(null);
      setArtifactLoadError(null);
      return undefined;
    }

    let cancelled = false;
    const artifactId = selectedArtifact.id;
    setLoadingArtifactId(artifactId);
    setArtifactLoadError(null);

    loadArtifactFile(selectedArtifact, cwd)
      .then(loaded => {
        if (cancelled) return;
        if (!loaded) {
          setArtifactLoadError(artifactId);
          return;
        }
        dispatch(
          addArtifact({
            sessionId: selectedArtifact.sessionId,
            artifact: { ...selectedArtifact, content: loaded.content, filePath: loaded.filePath },
          }),
        );
      })
      .catch(() => {
        if (!cancelled) setArtifactLoadError(artifactId);
      })
      .finally(() => {
        if (!cancelled) setLoadingArtifactId(null);
      });

    return () => {
      cancelled = true;
    };
  }, [cwd, dispatch, isCodeView, panelView, selectedArtifact]);

  const intermediateToggle = (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setShowIntermediateArtifacts(value => !value)}
      className={`h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface ${
        showIntermediateArtifacts ? 'text-primary bg-primary/10' : ''
      }`}
      title={t(showIntermediateArtifacts ? 'artifactHideIntermediate' : 'artifactShowIntermediate')}
      aria-label={t(
        showIntermediateArtifacts ? 'artifactHideIntermediate' : 'artifactShowIntermediate',
      )}
    >
      <Filter className="h-3.5 w-3.5" />
    </Button>
  );

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreen(document.fullscreenElement === panelRef.current);
    };
    document.addEventListener('fullscreenchange', syncFullscreenState);
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState);
  }, []);

  useEffect(() => {
    if (layoutMode !== ArtifactLayoutMode.Workspace || isFullscreen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dispatch(setArtifactLayoutMode(ArtifactLayoutMode.Split));
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [dispatch, isFullscreen, layoutMode]);

  useEffect(() => {
    if (!showFileList) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        fileListRef.current &&
        !fileListRef.current.contains(e.target as Node) &&
        toggleBtnRef.current &&
        !toggleBtnRef.current.contains(e.target as Node)
      ) {
        setShowFileList(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showFileList]);

  useEffect(() => {
    if (selectedArtifact && displayedTab !== activeTab) {
      dispatch(setActiveTab(displayedTab));
    }
  }, [activeTab, dispatch, displayedTab, selectedArtifact]);

  const handleClose = useCallback(() => {
    if (document.fullscreenElement === panelRef.current) {
      void document.exitFullscreen();
    }
    dispatch(closePanel());
  }, [dispatch]);

  const handleToggleWorkspace = useCallback(async () => {
    if (document.fullscreenElement === panelRef.current) {
      await document.exitFullscreen();
    }
    dispatch(
      setArtifactLayoutMode(
        layoutMode === ArtifactLayoutMode.Workspace
          ? ArtifactLayoutMode.Split
          : ArtifactLayoutMode.Workspace,
      ),
    );
  }, [dispatch, layoutMode]);

  const handleToggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement === panelRef.current) {
      await document.exitFullscreen();
      return;
    }

    dispatch(setArtifactLayoutMode(ArtifactLayoutMode.Workspace));
    try {
      await panelRef.current?.requestFullscreen();
    } catch {
      window.dispatchEvent(
        new CustomEvent('app:showToast', { detail: t('artifactFullscreenUnavailable') }),
      );
    }
  }, [dispatch]);
  const handleSelectArtifact = useCallback(
    (id: string) => {
      dispatch(selectArtifact(id));
      setShowFileList(false);
    },
    [dispatch],
  );

  const handleCopy = useCallback(async () => {
    if (selectedArtifact) {
      await navigator.clipboard.writeText(selectedArtifact.content);
      window.dispatchEvent(new CustomEvent('app:showToast', { detail: t('messageCopied') }));
    }
  }, [selectedArtifact]);

  const handleRevealInFolder = useCallback(() => {
    if (!selectedArtifact?.filePath) return;
    window.electron?.shell?.showItemInFolder(selectedArtifact.filePath);
  }, [selectedArtifact]);

  const handleOpenInBrowser = useCallback(() => {
    if (!selectedArtifact) return;

    // Has file on disk: open directly
    if (selectedArtifact.filePath) {
      if (window.electron.platform === 'win32') {
        window.electron.shell.openPath(selectedArtifact.filePath);
        return;
      }
      const fileUrl = toLocalFileUrl(selectedArtifact.filePath);
      window.electron?.shell?.openExternal(fileUrl);
      return;
    }

    // No file path: generate HTML and open via temp file
    if (!selectedArtifact.content) return;
    const html = buildBrowserHtml(selectedArtifact);
    if (html) {
      window.electron?.shell?.openHtmlInBrowser(html);
    }
  }, [selectedArtifact]);

  const handleOpenWithApp = useCallback(() => {
    if (selectedArtifact?.filePath) {
      let filePath = selectedArtifact.filePath;
      if (filePath.startsWith('file:///')) {
        filePath = filePath.slice(7);
      } else if (filePath.startsWith('file://')) {
        filePath = filePath.slice(7);
      } else if (filePath.startsWith('file:/')) {
        filePath = filePath.slice(5);
      }
      // Strip leading / before Windows drive letter
      if (/^\/[A-Za-z]:/.test(filePath)) {
        filePath = filePath.slice(1);
      }
      window.electron?.shell?.openPath(filePath);
    }
  }, [selectedArtifact]);

  const handleRefresh = useCallback(async () => {
    if (!selectedArtifact?.filePath) return;
    invalidateArtifactFile(selectedArtifact.filePath);
    try {
      const result = await window.electron.dialog.readFileAsDataUrl(selectedArtifact.filePath);
      if (result?.success && result.dataUrl) {
        const isTextType = !isBinaryArtifactFile(selectedArtifact.filePath);
        let content = result.dataUrl;
        if (isTextType) {
          try {
            const base64 = result.dataUrl.split(',')[1] || '';
            const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
            content = new TextDecoder('utf-8').decode(bytes);
          } catch {
            content = result.dataUrl;
          }
        }
        dispatch(
          addArtifact({
            sessionId: selectedArtifact.sessionId,
            artifact: { ...selectedArtifact, content },
          }),
        );
      }
    } catch {
      // File unreadable or missing
    }
  }, [selectedArtifact, dispatch]);

  return (
    <>
      {layoutMode !== ArtifactLayoutMode.Workspace && (
        <ArtifactPanelResizeHandle
          currentWidth={panelWidth}
          minWidth={minPanelWidth}
          maxWidth={maxPanelWidth}
          onResizeFrame={onResizeFrame}
          onResizeComplete={onResizeComplete}
        />
      )}
      <aside
        ref={panelRef}
        data-artifact-panel=""
        style={{
          width: layoutMode === ArtifactLayoutMode.Workspace || isFullscreen ? '100%' : undefined,
          height: layoutMode === ArtifactLayoutMode.Workspace || isFullscreen ? '100vh' : undefined,
          maxWidth:
            layoutMode === ArtifactLayoutMode.Workspace || isFullscreen ? 'none' : undefined,
        }}
        className={`non-draggable bg-background flex flex-col h-full overflow-hidden ${
          layoutMode === ArtifactLayoutMode.Workspace || isFullscreen
            ? 'fixed inset-0 z-200 w-screen border-0'
            : 'relative min-w-0 flex-1 border-l border-border-subtle'
        }`}
      >
        {/* Floating file list overlay */}
        {showFileList && (
          <div
            ref={fileListRef}
            className="absolute top-10 right-2 z-20 w-[240px] max-h-[60%] bg-background border border-border rounded-lg shadow-lg flex flex-col overflow-hidden"
          >
            <div className="h-9 flex items-center px-3 border-b border-border shrink-0">
              <span className="text-xs font-medium text-muted-foreground">
                {t('artifactFileList')}
              </span>
            </div>
            <FileDirectoryView
              artifacts={previewableArtifacts}
              selectedId={selectedArtifactId}
              onSelect={handleSelectArtifact}
              compact
            />
          </div>
        )}

        {selectedArtifact && panelView === ArtifactPanelView.Preview ? (
          <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
            {/* Header: file list toggle + filename + type + actions */}
            <div
              className={`h-10 flex items-center gap-2 border-b border-border shrink-0 ${
                isMac && isTopLevelPanel ? 'pl-20 pr-3' : 'px-3'
              }`}
            >
              <Button
                variant="ghost"
                size="icon"
                onClick={() => dispatch(setPanelView(ArtifactPanelView.Files))}
                className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface"
                title={t('back')}
                aria-label={t('back')}
              >
                <ArrowLeft />
              </Button>
              <span className="text-sm font-medium truncate">
                {selectedArtifact.fileName || selectedArtifact.title}
              </span>
              <span className="flex-1" />
              {selectedArtifact.filePath && selectedArtifact.type !== 'unsupported' && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleRefresh}
                  className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface"
                  title={t('artifactRefresh')}
                >
                  <RefreshIcon />
                </Button>
              )}
              {isCodeView && selectedArtifact.type !== 'unsupported' && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleCopy}
                  className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface"
                  title={t('artifactCopyCode')}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              )}
              {hasLocalFilePreview && BROWSER_OPENABLE_TYPES.has(selectedArtifact.type) && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleOpenInBrowser}
                  className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface"
                  title={t('artifactOpenInBrowser')}
                >
                  <BrowserIcon />
                </Button>
              )}
              {hasLocalFilePreview &&
                !BROWSER_OPENABLE_TYPES.has(selectedArtifact.type) && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleOpenWithApp}
                  className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface"
                  title={t('artifactOpenWithApp')}
                >
                  <OpenExternalIcon />
                </Button>
              )}
              {selectedArtifact.filePath && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleRevealInFolder}
                  className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface"
                  title={t('artifactOpenFolder')}
                >
                  <FolderIcon />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void handleToggleWorkspace()}
                className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface"
                title={t(
                  layoutMode === ArtifactLayoutMode.Workspace
                    ? 'artifactExitFullWindow'
                    : 'artifactEnterFullWindow',
                )}
                aria-label={t(
                  layoutMode === ArtifactLayoutMode.Workspace
                    ? 'artifactExitFullWindow'
                    : 'artifactEnterFullWindow',
                )}
              >
                {layoutMode === ArtifactLayoutMode.Workspace ? (
                  <Shrink className="h-3.5 w-3.5" />
                ) : (
                  <Expand className="h-3.5 w-3.5" />
                )}
              </Button>
              {document.fullscreenEnabled && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => void handleToggleFullscreen()}
                  className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface"
                  title={t(isFullscreen ? 'artifactExitFullscreen' : 'artifactEnterFullscreen')}
                  aria-label={t(
                    isFullscreen ? 'artifactExitFullscreen' : 'artifactEnterFullscreen',
                  )}
                >
                  {isFullscreen ? (
                    <Minimize2 className="h-3.5 w-3.5" />
                  ) : (
                    <Maximize2 className="h-3.5 w-3.5" />
                  )}
                </Button>
              )}
              {intermediateToggle}
              <Button
                ref={toggleBtnRef}
                variant="ghost"
                size="icon"
                onClick={() => setShowFileList(v => !v)}
                className={`h-8 w-8 rounded-lg transition-colors ${
                  showFileList
                    ? 'text-primary bg-primary/10'
                    : 'text-muted-foreground hover:text-foreground hover:bg-surface'
                }`}
                title={t('artifactFileList')}
              >
                <FileListIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleClose}
                className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface"
                title={t('close')}
                aria-label={t('close')}
              >
                <CloseIcon />
              </Button>
            </div>

            <div className="flex shrink-0 border-b border-border px-2 py-1.5">
              <FluidTabs<ArtifactActiveTab>
                aria-label={t('artifactViewMode')}
                value={displayedTab}
                onValueChange={value => dispatch(setActiveTab(value))}
                items={availableTabs.map(value => ({
                  value,
                  label: t(value === 'preview' ? 'artifactPreview' : 'artifactCode'),
                }))}
              />
            </div>

            {/* Render area */}
            <div key={`${selectedArtifact.id}-${displayedTab}`} className="flex-1 min-h-0 overflow-hidden animate-fade-in">
              {loadingArtifactId === selectedArtifact.id ? (
                <div className="h-full min-h-0 p-4" aria-busy="true">
                  <Skeleton className="h-full w-full rounded-lg" />
                </div>
              ) : artifactLoadError && artifactLoadError === selectedArtifact.id ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  {t('artifactDocumentError')}
                </div>
              ) : displayedTab === 'preview' ? (
                <ArtifactRenderer
                  artifact={
                    isDelimitedArtifact(selectedArtifact)
                      ? { ...selectedArtifact, type: 'document' }
                      : selectedArtifact
                  }
                  sessionArtifacts={artifacts}
                />
              ) : (
                <CodeRenderer artifact={selectedArtifact} />
              )}
            </div>
          </div>
        ) : (
          /* No artifact selected: show full-width file list */
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            <div
              className={`h-10 flex items-center border-b border-border shrink-0 ${
                isMac && isTopLevelPanel ? 'pl-20 pr-3' : 'px-3'
              }`}
            >
              <span className="text-xs font-medium text-muted-foreground">
                {t('artifactFiles')}
              </span>
              <span className="flex-1" />
              {intermediateToggle}
              <Button
                variant="ghost"
                size="icon"
                onClick={handleClose}
                className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface"
              >
                <CloseIcon />
              </Button>
            </div>
            <FileDirectoryView
              artifacts={previewableArtifacts}
              selectedId={selectedArtifactId}
              onSelect={handleSelectArtifact}
            />
          </div>
        )}
      </aside>
    </>
  );
};

const FolderIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2 4.5A1.5 1.5 0 013.5 3h2.879a1.5 1.5 0 011.06.44l.622.62a1.5 1.5 0 001.06.44H12.5A1.5 1.5 0 0114 6v5.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" />
  </svg>
);

const BrowserIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="8" cy="8" r="6" />
    <ellipse cx="8" cy="8" rx="2.5" ry="6" />
    <path d="M2 8h12" />
  </svg>
);

const OpenExternalIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 9v3.5a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 012 12.5v-7A1.5 1.5 0 013.5 4H7" />
    <path d="M10 2h4v4" />
    <path d="M7 9l7-7" />
  </svg>
);

const CloseIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
  >
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

const FileListIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4.5 2.881c0-.644.522-1.167 1.167-1.167h2.552c.323 0 .635.117.878.33l.58.507c.243.213.555.33.877.33h3.351c.736 0 1.333.597 1.333 1.333v5.945c0 .49-.398.889-.889.889" />
    <path d="M1.143 6.476c0-.736.597-1.333 1.333-1.333h2.314c.323 0 .635.117.878.33l.58.507c.242.213.554.33.877.33h3.351c.736 0 1.333.597 1.333 1.334v4.833c0 .736-.597 1.333-1.333 1.333H2.476c-.736 0-1.333-.597-1.333-1.333V6.476z" />
  </svg>
);

const RefreshIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M13.5 8a5.5 5.5 0 01-9.55 3.75" />
    <path d="M2.5 8a5.5 5.5 0 019.55-3.75" />
    <path d="M12.05 1.25v3h-3" />
    <path d="M3.95 14.75v-3h3" />
  </svg>
);

export default ArtifactPanel;
