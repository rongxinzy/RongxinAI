import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { clampArtifactPanelWidth } from '../artifacts/artifactPanelResize';
import { resolveCodingSidePanelMaxWidth } from './codingSidePanelSizing';
import {
  CodingSidePanelView,
  type CodingSidePanelView as CodingSidePanelViewType,
} from './constants';
import { useCodingSidePanelTransition } from './useCodingSidePanelTransition';

export const CODING_PANEL_MIN_WIDTH = 280;
const CODING_PANEL_DEFAULT_WIDTH = 560;

interface UseCodingSidePanelControllerOptions {
  /** Workbench container whose width bounds the panel. */
  containerRef: RefObject<HTMLDivElement | null>;
  isNarrowViewport: boolean;
  /** Changing this key (the active lane id) resets the panel state. */
  resetKey: string | null;
}

/**
 * Owns the coding side panel state: open tabs, the active view, the sheet
 * fallback on narrow viewports and the resizable width. The layout itself is
 * rendered by `CodingSidePanelFrame` and `CodingSidePanelBottomSheet`.
 */
export function useCodingSidePanelController({
  containerRef,
  isNarrowViewport,
  resetKey,
}: UseCodingSidePanelControllerOptions) {
  const [sidePanelSheetOpen, setSidePanelSheetOpen] = useState(false);
  const [sidePanelView, setSidePanelView] = useState<CodingSidePanelViewType | null>(null);
  const [sidePanelTabs, setSidePanelTabs] = useState<CodingSidePanelViewType[]>([]);
  const [sidePanelHidden, setSidePanelHidden] = useState(false);
  const [sidePanelWidth, setSidePanelWidth] = useState(CODING_PANEL_DEFAULT_WIDTH);
  const [sidePanelExpanded, setSidePanelExpanded] = useState(false);
  const [isSidePanelResizing, setIsSidePanelResizing] = useState(false);
  const [sidePanelMaxWidth, setSidePanelMaxWidth] = useState(CODING_PANEL_DEFAULT_WIDTH);
  const transientSidePanelWidthRef = useRef<number | null>(null);
  const {
    completeClose: completeSidePanelClose,
    hide: hideSidePanel,
    isClosing: isSidePanelClosing,
    isEntering: isSidePanelEntering,
    isPresent: isSidePanelPresent,
    reset: resetSidePanelTransition,
    show: showSidePanel,
  } = useCodingSidePanelTransition({
    isNarrowViewport,
    onCloseComplete: () => {
      setSidePanelExpanded(false);
      setSidePanelHidden(true);
    },
  });
  const requestHideSidePanel = useCallback(() => {
    setSidePanelExpanded(false);
    hideSidePanel();
  }, [hideSidePanel]);
  const resolvedSidePanelWidth = clampArtifactPanelWidth(
    sidePanelWidth,
    CODING_PANEL_MIN_WIDTH,
    sidePanelMaxWidth,
  );
  const renderedSidePanelWidth = transientSidePanelWidthRef.current ?? resolvedSidePanelWidth;
  const visibleSidePanelTabs =
    sidePanelTabs.length > 0
      ? sidePanelTabs
      : sidePanelView !== null && sidePanelView !== CodingSidePanelView.Launcher
        ? [sidePanelView]
        : [];

  const applySidePanelFrameWidth = useCallback(
    (width: number) => {
      const nextWidth = clampArtifactPanelWidth(width, CODING_PANEL_MIN_WIDTH, sidePanelMaxWidth);
      transientSidePanelWidthRef.current = nextWidth;
      setSidePanelWidth(nextWidth);
    },
    [sidePanelMaxWidth],
  );

  const completeSidePanelResize = useCallback(
    (width: number) => {
      const nextWidth = clampArtifactPanelWidth(width, CODING_PANEL_MIN_WIDTH, sidePanelMaxWidth);
      transientSidePanelWidthRef.current = null;
      setSidePanelWidth(nextWidth);
    },
    [sidePanelMaxWidth],
  );

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const updateMaxWidth = () => {
      const maxWidth = resolveCodingSidePanelMaxWidth(root.clientWidth, CODING_PANEL_MIN_WIDTH);
      setSidePanelMaxWidth(maxWidth);
      setSidePanelWidth(current =>
        clampArtifactPanelWidth(current, CODING_PANEL_MIN_WIDTH, maxWidth),
      );
    };
    updateMaxWidth();
    const observer = new ResizeObserver(updateMaxWidth);
    observer.observe(root);
    return () => observer.disconnect();
  }, [containerRef]);

  // Lane switches start from a clean panel, including the narrow-viewport sheet.
  useEffect(() => {
    setSidePanelView(null);
    setSidePanelTabs([]);
    setSidePanelHidden(false);
    setSidePanelSheetOpen(false);
    resetSidePanelTransition();
  }, [resetKey, resetSidePanelTransition]);

  const openSidePanelTab = useCallback(
    (view: CodingSidePanelViewType) => {
      showSidePanel();
      setSidePanelHidden(false);
      if (view === CodingSidePanelView.Launcher) {
        setSidePanelTabs([]);
        setSidePanelView(CodingSidePanelView.Launcher);
        return;
      }
      setSidePanelTabs(current => (current.includes(view) ? current : [...current, view]));
      setSidePanelView(view);
    },
    [showSidePanel],
  );

  const restoreSidePanel = useCallback(() => {
    showSidePanel();
    setSidePanelHidden(false);
    setSidePanelView(current => current ?? CodingSidePanelView.Launcher);
  }, [showSidePanel]);

  const closeSidePanelTab = useCallback(
    (view: CodingSidePanelViewType) => {
      const nextTabs = sidePanelTabs.filter(tab => tab !== view);
      setSidePanelTabs(nextTabs);
      if (nextTabs.length === 0) {
        setSidePanelSheetOpen(false);
        setSidePanelView(CodingSidePanelView.Launcher);
        requestHideSidePanel();
        return;
      }
      setSidePanelView(active => (active === view ? nextTabs.at(-1)! : active));
    },
    [requestHideSidePanel, sidePanelTabs],
  );

  return {
    applySidePanelFrameWidth,
    closeSidePanelTab,
    completeSidePanelClose,
    completeSidePanelResize,
    isSidePanelClosing,
    isSidePanelEntering,
    isSidePanelPresent,
    isSidePanelResizing,
    openSidePanelTab,
    renderedSidePanelWidth,
    requestHideSidePanel,
    resolvedSidePanelWidth,
    restoreSidePanel,
    setIsSidePanelResizing,
    setSidePanelExpanded,
    setSidePanelSheetOpen,
    sidePanelExpanded,
    sidePanelHidden,
    sidePanelMaxWidth,
    sidePanelSheetOpen,
    sidePanelView,
    visibleSidePanelTabs,
  };
}
