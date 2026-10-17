import { Button } from '@shared/components/ui/button';
import { ButtonGroup } from '@shared/components/ui/button-group';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@shared/components/ui/sheet';
import { cn } from '@shared/lib/utils';
import {
  Expand,
  File,
  FileDiff,
  Minimize2,
  PanelRight,
  Terminal as TerminalIcon,
  X,
} from 'lucide-react';
import type { RefObject, TransitionEvent } from 'react';

import type { CodingEvent } from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
import ArtifactPanelResizeHandle from '../artifacts/ArtifactPanelResizeHandle';
import { CodingGitPanel } from './CodingGitPanel';
import { CodingInspector } from './CodingInspector';
import { CodingSidePanelAddMenu } from './CodingSidePanelAddMenu';
import { CodingSidePanelLauncher } from './CodingSidePanelLauncher';
import { CodingWorkspaceFileBrowser } from './CodingWorkspaceFileBrowser';
import {
  CodingInspectorTab,
  CodingSidePanelView,
  type CodingSidePanelView as CodingSidePanelViewType,
} from './constants';
import { CODING_PANEL_MIN_WIDTH } from './useCodingSidePanelController';

interface CodingSidePanelBodyProps {
  view: CodingSidePanelViewType | null;
  workspaceRoot: string;
  sourceRoot: string;
  laneId: string | null;
  refreshKey: string;
  events: CodingEvent[];
  hasInspectorContent: boolean;
  onOpenTab: (view: CodingSidePanelViewType) => void;
  onFileSaved: () => void;
}

const CodingSidePanelBody = ({
  view,
  workspaceRoot,
  sourceRoot,
  laneId,
  refreshKey,
  events,
  hasInspectorContent,
  onOpenTab,
  onFileSaved,
}: CodingSidePanelBodyProps) =>
  view === CodingSidePanelView.Launcher ? (
    <CodingSidePanelLauncher
      onOpenFiles={() => onOpenTab(CodingSidePanelView.Files)}
      onOpenReview={() => onOpenTab(CodingSidePanelView.Review)}
      onOpenInspector={() => onOpenTab(CodingSidePanelView.Inspector)}
      hasInspectorContent={hasInspectorContent}
    />
  ) : view === CodingSidePanelView.Files ? (
    <CodingWorkspaceFileBrowser
      workspaceRoot={workspaceRoot}
      sourceRoot={sourceRoot}
      onFileSaved={onFileSaved}
    />
  ) : view === CodingSidePanelView.Inspector ? (
    <CodingInspector events={events} initialTab={CodingInspectorTab.Terminal} />
  ) : (
    <CodingGitPanel
      workspaceRoot={workspaceRoot}
      laneId={laneId}
      sourceRoot={sourceRoot}
      refreshKey={refreshKey}
    />
  );

interface CodingSidePanelFrameProps extends CodingSidePanelBodyProps {
  frameRef: RefObject<HTMLElement | null>;
  /** Panel is open on desktop (drives width and aria-hidden). */
  desktopOpen: boolean;
  tabs: CodingSidePanelViewType[];
  width: number;
  renderedWidth: number;
  maxWidth: number;
  expanded: boolean;
  isEntering: boolean;
  isClosing: boolean;
  isResizing: boolean;
  onCloseTab: (view: CodingSidePanelViewType) => void;
  onToggleExpanded: () => void;
  onRequestHide: () => void;
  onResizeFrame: (width: number) => void;
  onResizeComplete: (width: number) => void;
  onResizeStateChange: (isResizing: boolean) => void;
  onTransitionEnd: (event: TransitionEvent<HTMLElement>) => void;
}

export const CodingSidePanelFrame = ({
  frameRef,
  desktopOpen,
  view,
  tabs,
  width,
  renderedWidth,
  maxWidth,
  expanded,
  isEntering,
  isClosing,
  isResizing,
  onCloseTab,
  onToggleExpanded,
  onRequestHide,
  onResizeFrame,
  onResizeComplete,
  onResizeStateChange,
  onTransitionEnd,
  ...bodyProps
}: CodingSidePanelFrameProps) => (
  <aside
    ref={frameRef}
    onTransitionEnd={onTransitionEnd}
    aria-hidden={!desktopOpen || isEntering || isClosing}
    className={cn(
      'relative flex min-h-0 min-w-0 shrink-0 flex-col overflow-visible border-l border-border-subtle max-lg:hidden',
      !isResizing && 'transition-[width] duration-200 ease-out motion-reduce:transition-none',
      (isEntering || isClosing) && 'pointer-events-none',
      expanded && 'absolute inset-0 z-20 bg-background',
    )}
    style={{
      width: expanded
        ? '100%'
        : desktopOpen && !isEntering && !isClosing
          ? `${renderedWidth}px`
          : '0px',
    }}
  >
    <ArtifactPanelResizeHandle
      ariaLabel={i18nService.t('codingAgentSidePanel')}
      currentWidth={width}
      minWidth={CODING_PANEL_MIN_WIDTH}
      maxWidth={maxWidth}
      disabled={expanded || isEntering || isClosing}
      onResizeFrame={onResizeFrame}
      onResizeComplete={onResizeComplete}
      onResizeStateChange={onResizeStateChange}
    />
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-1 py-2">
        {tabs.map(tab => {
          const isReview = tab === CodingSidePanelView.Review;
          const isInspector = tab === CodingSidePanelView.Inspector;
          const active = tab === view;
          const tabLabel = isReview
            ? 'codingAgentReview'
            : isInspector
              ? 'codingAgentInspector'
              : 'codingAgentOpenFiles';
          return (
            <ButtonGroup
              key={tab}
              className={cn(
                'group shrink-0 gap-0 theme-button theme-button-size-sm',
                active ? 'theme-button-secondary' : 'theme-button-ghost',
              )}
            >
              <Button
                type="button"
                variant="embedded"
                size="sm"
                aria-pressed={active}
                onClick={() => bodyProps.onOpenTab(tab)}
              >
                {isReview ? <FileDiff /> : isInspector ? <TerminalIcon /> : <File />}
                {i18nService.t(tabLabel)}
              </Button>
              <Button
                type="button"
                variant="embedded"
                size="sm"
                className={cn(
                  'self-center pointer-events-none opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100',
                  active && 'pointer-events-auto opacity-100',
                )}
                aria-label={i18nService.t('close')}
                onClick={() => onCloseTab(tab)}
              >
                <X />
              </Button>
            </ButtonGroup>
          );
        })}
        <CodingSidePanelAddMenu
          onOpenReview={() => bodyProps.onOpenTab(CodingSidePanelView.Review)}
          onOpenFiles={() => bodyProps.onOpenTab(CodingSidePanelView.Files)}
          onOpenInspector={() => bodyProps.onOpenTab(CodingSidePanelView.Inspector)}
          hasInspectorContent={bodyProps.hasInspectorContent}
        />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="toolbar"
            size="icon-sm"
            aria-label={i18nService.t(expanded ? 'codingGitExitExpanded' : 'codingGitExpand')}
            aria-pressed={expanded}
            onClick={onToggleExpanded}
          >
            {expanded ? <Minimize2 /> : <Expand />}
          </Button>
          <Button
            type="button"
            variant="toolbar"
            size="icon-sm"
            aria-label={i18nService.t('codingAgentSidePanel')}
            onClick={() => {
              onRequestHide();
            }}
          >
            <PanelRight />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <CodingSidePanelBody view={view} {...bodyProps} />
      </div>
    </div>
  </aside>
);

interface CodingSidePanelBottomSheetProps extends CodingSidePanelBodyProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const CodingSidePanelBottomSheet = ({
  open,
  onOpenChange,
  view,
  ...bodyProps
}: CodingSidePanelBottomSheetProps) => (
  <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent side="bottom" className="theme-control-sizing-4 h-[80dvh]">
      <SheetHeader className="sr-only">
        <SheetTitle>
          {view === CodingSidePanelView.Launcher
            ? i18nService.t('codingAgentSidePanel')
            : view === CodingSidePanelView.Files
              ? i18nService.t('codingAgentFiles')
              : view === CodingSidePanelView.Inspector
                ? i18nService.t('codingAgentInspector')
                : i18nService.t('codingAgentReview')}
        </SheetTitle>
      </SheetHeader>
      <CodingSidePanelBody view={view} {...bodyProps} />
    </SheetContent>
  </Sheet>
);
