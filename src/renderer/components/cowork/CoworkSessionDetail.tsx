import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@shared/components/ai-elements/conversation';
import { Button } from '@shared/components/ui/button';
import { ChevronDown, ChevronUp, Download, Image as ImageIcon } from 'lucide-react';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';

import { CoworkSessionMode, type CoworkPermissionMode } from '../../../shared/cowork/constants';
import type { CoworkSessionInterruption } from '../../../shared/cowork/interruption';
import type { ProductionLoopMode } from '../../../shared/productionLoop';

import { ArtifactDetectionService } from '../../services/artifactDetectionService';
import {
  detectArtifactsFromMessages,
  getArtifactTypeFromExtension,
  normalizeFilePathForDedup,
} from '../../services/artifactParser';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { RootState } from '../../store';
import {
  selectCurrentMessagesLength,
  selectCurrentSession,
  selectCurrentToolActivities,
  selectIsStreaming,
  selectRemoteManaged,
} from '../../store/selectors/coworkSelectors';
import {
  addArtifact,
  activateSessionArtifactView,
  ArtifactLayoutMode,
  closePanel,
  DEFAULT_PANEL_WIDTH,
  MIN_PANEL_WIDTH,
  EMPTY_ARTIFACTS,
  selectArtifact,
  selectIsSessionArtifactPanelOpen,
  selectSessionArtifactLayoutMode,
  selectSessionArtifacts,
  togglePanel,
} from '../../store/slices/artifactSlice';
import { setActiveSkillIds } from '../../store/slices/skillSlice';
import { resolveArtifactPanelMaxWidth } from '../artifacts/artifactPanelResize';
import { PREVIEWABLE_ARTIFACT_TYPES } from '../../types/artifact';
import type {
  CoworkImageAttachment,
  CoworkFileAttachment,
  CoworkMessage,
  CoworkMessageMetadata,
  CoworkPermissionRequest,
  CoworkPermissionResult,
} from '../../types/cowork';
import { ArtifactPanelFallback } from '../artifacts/ArtifactPanelFallback';
import { TurnBlock } from './components/TurnBlock';
import { UserBubble } from './components/UserBubble';
import {
  VirtualizedTurnList,
  type VirtualizedTurnListHandle,
} from './components/VirtualizedTurnList';
import { type CoworkOpenShareOptionsEventDetail, CoworkUiEvent } from './constants';
import CoworkPromptInput, { type CoworkPromptInputRef } from './CoworkPromptInput';
import { CoworkConversationLoadingSkeleton } from './CoworkSessionLoadingState';
import { CoworkSessionLayout } from './CoworkSessionLayout';
import PendingMessageQueue from './PendingMessageQueue';
import type { CaptureRect } from './helpers/exportUtils';
import {
  composeExportCanvas,
  domRectToCaptureRect,
  formatExportTimestamp,
  loadImageFromBase64,
  MAX_EXPORT_CANVAS_HEIGHT,
  MAX_EXPORT_SEGMENTS,
  sanitizeExportFileName,
  waitForNextFrame,
} from './helpers/exportUtils';
import {
  buildConversationTurns,
  buildDisplayItems,
  buildTurnRailIndices,
  hasRenderableAssistantContent,
} from './helpers/messageGrouping';
import { useStableConversationTurns } from './helpers/useStableConversationTurns';
import { useTurnArtifacts } from './helpers/useTurnArtifacts';
import { setPersistentToggleNamespace } from './hooks/usePersistentToggle';
// toolUtils helpers used in sub-components
import {
  normalizeLocalPath,
  parseRootRelativePath,
  toAbsolutePathFromCwd,
} from './helpers/pathUtils';
import { useSessionHistoryPagination } from './hooks/useSessionHistoryPagination';
import { useRecoverableWorkbenchTaskId } from './hooks/useRecoverableWorkbenchTaskId';
import { useConversationRailScrollSync } from './hooks/useConversationRailScrollSync';
import {
  COWORK_COMPOSER_INSET_VALUE,
  useCoworkComposerInset,
} from './hooks/useCoworkComposerInset';
import { useTodoQueueLifecycle } from './hooks/useTodoQueueLifecycle';
import { TodoQueue } from './TodoQueue';
import AskUserQuestionCard from './AskUserQuestionCard';
import { WorkbenchTaskAcceptanceCard } from './WorkbenchTaskAcceptanceCard';
import CoworkPermissionModal from './CoworkPermissionModal';

// The artifact panel only mounts when the user opens it, so keep its code
// (and the whole renderers tree behind it) out of the cowork startup chunk.
const ArtifactPanelFrame = React.lazy(() =>
  import('../artifacts').then(module => ({ default: module.ArtifactPanelFrame })),
);

interface CoworkSessionDetailProps {
  displayedSessionId?: string;
  isSessionSwitching?: boolean;
  onManageSkills?: () => void;
  onManageConnectors?: () => void;
  permissionMode?: CoworkPermissionMode;
  onPermissionModeChange?: (mode: CoworkPermissionMode) => void;
  onContinue: (
    prompt: string,
    skillPrompt?: string,
    imageAttachments?: CoworkImageAttachment[],
    fileAttachments?: CoworkFileAttachment[],
    expertIds?: string[],
    goalMode?: boolean,
    productionLoopMode?: ProductionLoopMode,
  ) => boolean | void | Promise<boolean | void>;
  onStop: () => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  updateBadge?: React.ReactNode;
  workMode?: 'work' | 'chat';
  isDirectChat?: boolean;
  localThinkingEnabled?: boolean;
  onLocalThinkingEnabledChange?: (enabled: boolean | undefined) => void;
  inlineQuestionPermission?: CoworkPermissionRequest | null;
  onRespondToInlineQuestion?: (result: CoworkPermissionResult) => void | Promise<void>;
  inlinePermission?: CoworkPermissionRequest | null;
  onRespondToInlinePermission?: (result: CoworkPermissionResult) => void | Promise<void>;
  resumeTaskId?: string | null;
  onResumeTask?: (interruption: CoworkSessionInterruption) => void;
  onCancelTaskResume?: () => void;
}

const NAV_SCROLL_LOCK_DURATION = 800;
const ARTIFACT_PANEL_TRANSITION_MS = 200;
class ArtifactPanelErrorBoundary extends React.Component<
  { children: React.ReactNode; onClose: () => void },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode; onClose: () => void }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error) {
    console.error('[ArtifactPanel] render error:', error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <aside className="w-[420px] shrink-0 border-l border-border-subtle bg-background flex flex-col h-full items-center justify-center p-4">
          <p className="text-sm text-red-500 mb-2">Artifact panel error</p>
          <pre className="text-xs text-muted whitespace-pre-wrap max-w-full overflow-auto mb-3">
            {this.state.error?.message}
          </pre>
          <Button
            variant="secondary"
            size="xs"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              this.props.onClose();
            }}
          >
            Close
          </Button>
        </aside>
      );
    }
    return this.props.children;
  }
}

const CoworkSessionDetail: React.FC<CoworkSessionDetailProps> = ({
  displayedSessionId,
  isSessionSwitching = false,
  onManageSkills,
  onManageConnectors,
  permissionMode,
  onPermissionModeChange,
  onContinue,
  onStop,
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
  updateBadge,
  workMode = 'work',
  isDirectChat = false,
  localThinkingEnabled,
  onLocalThinkingEnabledChange,
  inlineQuestionPermission,
  onRespondToInlineQuestion,
  inlinePermission,
  onRespondToInlinePermission,
  resumeTaskId,
  onResumeTask,
  onCancelTaskResume,
}) => {
  const dispatch = useDispatch();
  const currentSession = useSelector(selectCurrentSession);
  const isStreaming = useSelector(selectIsStreaming);
  const toolActivities = useSelector(selectCurrentToolActivities);
  const remoteManaged = useSelector(selectRemoteManaged);
  const messagesLength = useSelector(selectCurrentMessagesLength);
  const skills = useSelector((state: RootState) => state.skill.skills);
  const detailRootRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const promptInputRef = useRef<CoworkPromptInputRef>(null);
  const composerOverlayRef = useCoworkComposerInset(detailRootRef);

  const sessionId = currentSession?.id;
  const recoverableTaskId = useRecoverableWorkbenchTaskId(sessionId);

  const handleResumeTask = useCallback(
    (interruption: CoworkSessionInterruption) => {
      onResumeTask?.(interruption);
      requestAnimationFrame(() => promptInputRef.current?.focus());
    },
    [onResumeTask],
  );

  // Rail navigation states
  const [currentRailIndex, setCurrentRailIndex] = useState(-1);
  const currentRailIndexRef = useRef(-1);
  const railItemCountRef = useRef(0);
  // Mapping: turnIndex → { first: firstRailIdx, last: lastRailIdx }
  const turnToRailRangeRef = useRef<{ first: number; last: number }[]>([]);
  const isNavigatingRef = useRef(false);
  const navigatingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const virtualizedTurnListRef = useRef<VirtualizedTurnListHandle>(null);
  const railLinesRef = useRef<HTMLDivElement>(null);
  const [hoveredRailIndex, setHoveredRailIndex] = useState<number | null>(null);
  const [isRailHovered, setIsRailHovered] = useState(false);
  const [railTooltip, setRailTooltip] = useState<{
    label: string;
    top: number;
    right: number;
    isUser: boolean;
  } | null>(null);

  // Export states
  const [isExportingImage, setIsExportingImage] = useState(false);
  const [showExportOptions, setShowExportOptions] = useState(false);

  // ─── Artifact detection ─────────────────────────────────────────────
  const isPanelOpen = useSelector((state: RootState) =>
    selectIsSessionArtifactPanelOpen(state, sessionId),
  );
  const artifactLayoutMode = useSelector((state: RootState) =>
    selectSessionArtifactLayoutMode(state, sessionId),
  );
  const isArtifactWorkspace = artifactLayoutMode === ArtifactLayoutMode.Workspace;
  const [shouldRenderArtifactPanel, setShouldRenderArtifactPanel] = useState(isPanelOpen);
  const [isArtifactPanelVisible, setIsArtifactPanelVisible] = useState(isPanelOpen);
  const [isArtifactPanelTransitioning, setIsArtifactPanelTransitioning] = useState(false);
  const [previewSessionId, setPreviewSessionId] = useState<string | null>(() =>
    isPanelOpen ? (sessionId ?? null) : null,
  );
  const [artifactPanelMaxWidth, setArtifactPanelMaxWidth] = useState(() =>
    typeof window === 'undefined'
      ? DEFAULT_PANEL_WIDTH
      : resolveArtifactPanelMaxWidth(Math.max(MIN_PANEL_WIDTH, window.innerWidth), MIN_PANEL_WIDTH),
  );
  const previousArtifactPanelOpenRef = useRef(isPanelOpen);
  const previousArtifactSessionIdRef = useRef(sessionId);
  const skipArtifactPanelTransitionRef = useRef(false);
  const contentRowRef = useRef<HTMLDivElement>(null);
  const sessionArtifacts = useSelector((state: RootState) =>
    sessionId ? selectSessionArtifacts(state, sessionId) : EMPTY_ARTIFACTS,
  );
  const previewArtifacts = useSelector((state: RootState) =>
    previewSessionId ? selectSessionArtifacts(state, previewSessionId) : EMPTY_ARTIFACTS,
  );

  const artifactDetectionServiceRef = useRef<ArtifactDetectionService | null>(null);

  // Initialize/replace artifact detection service when session changes
  useEffect(() => {
    if (!sessionId) {
      artifactDetectionServiceRef.current?.terminate();
      artifactDetectionServiceRef.current = null;
      return undefined;
    }

    const service = new ArtifactDetectionService(
      detected => {
        for (const { artifact } of detected) {
          // Keep path-backed artifacts visible while their file contents remain deferred.
          dispatch(addArtifact({ sessionId, artifact }));
        }
      },
    );
    artifactDetectionServiceRef.current = service;

    return () => {
      service.terminate();
    };
  }, [sessionId, dispatch]);

  useEffect(() => {
    let animationFrame: number | undefined;
    let transitionTimeout: number | undefined;
    const wasOpen = previousArtifactPanelOpenRef.current;

    previousArtifactPanelOpenRef.current = isPanelOpen;

    if (skipArtifactPanelTransitionRef.current) {
      skipArtifactPanelTransitionRef.current = false;
      setShouldRenderArtifactPanel(isPanelOpen);
      setIsArtifactPanelVisible(isPanelOpen);
      setIsArtifactPanelTransitioning(false);
      return undefined;
    }

    if (wasOpen === isPanelOpen) {
      return undefined;
    }

    if (isPanelOpen) {
      setShouldRenderArtifactPanel(true);
      setIsArtifactPanelVisible(false);
      setIsArtifactPanelTransitioning(true);
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = window.requestAnimationFrame(() => {
          setIsArtifactPanelVisible(true);
          transitionTimeout = window.setTimeout(() => {
            setIsArtifactPanelTransitioning(false);
          }, ARTIFACT_PANEL_TRANSITION_MS);
        });
      });
    } else {
      setIsArtifactPanelTransitioning(true);
      setIsArtifactPanelVisible(false);
      transitionTimeout = window.setTimeout(() => {
        setIsArtifactPanelTransitioning(false);
      }, ARTIFACT_PANEL_TRANSITION_MS);
    }

    return () => {
      if (animationFrame !== undefined) {
        window.cancelAnimationFrame(animationFrame);
      }
      if (transitionTimeout !== undefined) {
        window.clearTimeout(transitionTimeout);
      }
    };
  }, [isPanelOpen]);

  const updateArtifactPanelMaxWidth = useCallback(() => {
    const contentWidth = contentRowRef.current?.clientWidth ?? 0;
    if (contentWidth <= 0) return;
    const nextMaxWidth = resolveArtifactPanelMaxWidth(contentWidth, MIN_PANEL_WIDTH);
    setArtifactPanelMaxWidth(prev => (prev === nextMaxWidth ? prev : nextMaxWidth));
  }, []);

  // ResizeObserver must run in useEffect (async), NOT useLayoutEffect:
  // useLayoutEffect flushes state updates synchronously — when the observed
  // container resizes as a result of our own setState, the observer fires
  // again before paint, forming a sync setState → DOM → observer → setState
  // cycle that exhausts React's nested update limit.
  useEffect(() => {
    updateArtifactPanelMaxWidth();
    const container = contentRowRef.current;

    const resizeObserver = new ResizeObserver(updateArtifactPanelMaxWidth);
    if (container) {
      resizeObserver.observe(container);
    }
    return () => {
      resizeObserver.disconnect();
    };
  }, [currentSession?.id, updateArtifactPanelMaxWidth]);

  useLayoutEffect(() => {
    if (
      previousArtifactSessionIdRef.current &&
      previousArtifactSessionIdRef.current !== sessionId
    ) {
      skipArtifactPanelTransitionRef.current = true;
    }
    previousArtifactSessionIdRef.current = sessionId;
    dispatch(activateSessionArtifactView(sessionId ?? null));
  }, [sessionId, dispatch]);

  useLayoutEffect(() => {
    if (isPanelOpen && sessionId) {
      setPreviewSessionId(sessionId);
    }
  }, [isPanelOpen, sessionId]);

  // Seed the artifact store with server-persisted artifacts collected from
  // the full (non-paginated) message history. Without this, artifacts
  // declared in earlier turns are invisible after a page reload because
  // the renderer only sees the most recent page of messages.
  useEffect(() => {
    if (!sessionId) return;
    const persisted = currentSession?.artifacts;
    if (!persisted || persisted.length === 0) return;

    const existingIds = new Set((previewArtifacts || []).map(a => a.id));
    for (const artifact of persisted) {
      // Only add if not already present. Path-level deduplication in the
      // artifact slice reconciles persisted declarations with loaded files.
      if (!existingIds.has(artifact.id)) {
        dispatch(
          addArtifact({
            sessionId,
            artifact: {
              ...artifact,
              sessionId,
            },
          }),
        );
      }
    }
  }, [sessionId, currentSession?.artifacts]); // eslint-disable-line react-hooks/exhaustive-deps

  // Synchronous artifact detection on session mount so artifact cards
  // appear in the first-paint frame instead of popping in after the async
  // Web Worker pass completes (which would change turn heights and jank).
  useLayoutEffect(() => {
    if (!sessionId || !currentSession?.messages?.length) return;
    if (isStreaming) return;

    const detected = detectArtifactsFromMessages(currentSession.messages, sessionId);
    if (detected.length > 0) {
      for (const { artifact } of detected) {
        dispatch(addArtifact({ sessionId, artifact }));
      }
      // The async useEffect pass below will also call processMessages.
      // addArtifact is idempotent (merges by id / filePath).
    }
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sessionId || !currentSession?.messages?.length) return;
    if (isStreaming) return;

    const service = artifactDetectionServiceRef.current;
    if (!service) return;

    service.processMessages(currentSession.messages, sessionId).catch(err => {
      console.error('[ArtifactDetection] failed:', err);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- message count and updatedAt cover message additions and content updates
  }, [sessionId, messagesLength, currentSession?.updatedAt, isStreaming]);

  // Intercept clicks on artifact-compatible file links → open in panel
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !sessionId) return;

    const handleLinkClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest('a');
      if (!anchor) return;

      const href = anchor.getAttribute('href') || '';
      if (!href.startsWith('file://')) return;

      let filePath: string;
      try {
        filePath = decodeURIComponent(href.replace(/^file:\/\//, ''));
      } catch {
        filePath = href.replace(/^file:\/\//, '');
      }
      // Strip leading / before Windows drive letter
      if (/^\/[A-Za-z]:/.test(filePath)) {
        filePath = filePath.slice(1);
      }

      const lastDot = filePath.lastIndexOf('.');
      if (lastDot === -1) return;
      const ext = filePath.slice(lastDot).toLowerCase();
      if (!getArtifactTypeFromExtension(ext)) return;

      e.preventDefault();
      e.stopPropagation();

      const normalizedClick = normalizeFilePathForDedup(filePath);
      const existing = sessionArtifacts.find(
        a => a.filePath && normalizeFilePathForDedup(a.filePath) === normalizedClick,
      );
      if (existing) {
        dispatch(selectArtifact(existing.id));
      }
      // No fallback creation — artifacts are now declared via declare_artifact tool,
      // not created from ad-hoc link clicks or regex parsing.
    };

    container.addEventListener('click', handleLinkClick, true);
    return () => container.removeEventListener('click', handleLinkClick, true);
  }, [sessionId, sessionArtifacts, dispatch]);
  // ─── End artifact detection ─────────────────────────────────────────

  // Cleanup nav timers on unmount
  useEffect(() => {
    return () => {
      if (navigatingTimerRef.current) clearTimeout(navigatingTimerRef.current);
    };
  }, []);

  // Reset all rail measurements before the next session paints. This component
  // stays mounted so artifact renderers can be reused across session switches.
  useLayoutEffect(() => {
    setCurrentRailIndex(-1);
    currentRailIndexRef.current = -1;
    railItemCountRef.current = 0;
    turnToRailRangeRef.current = [];
    isNavigatingRef.current = false;
    if (navigatingTimerRef.current) clearTimeout(navigatingTimerRef.current);
    railLinesRef.current?.scrollTo({ top: 0 });
    setHoveredRailIndex(null);
    setIsRailHovered(false);
    setRailTooltip(null);
  }, [sessionId]);

  useEffect(() => {
    const handleOpenShareOptions = (event: Event) => {
      const detail = (event as CustomEvent<CoworkOpenShareOptionsEventDetail>).detail;
      if (!detail?.sessionId || detail.sessionId !== currentSession?.id) return;
      setShowExportOptions(true);
    };

    window.addEventListener(CoworkUiEvent.OpenShareOptions, handleOpenShareOptions);
    return () => {
      window.removeEventListener(CoworkUiEvent.OpenShareOptions, handleOpenShareOptions);
    };
  }, [currentSession?.id]);

  const sessionToMarkdown = useCallback((): string => {
    if (!currentSession) return '';
    const lines: string[] = [];
    lines.push(`# ${currentSession.title}`);
    lines.push('');
    lines.push(
      `> ${i18nService.t('coworkExportCreatedAt')}: ${new Date(currentSession.createdAt).toLocaleString()}`,
    );
    lines.push('');
    lines.push('---');
    lines.push('');
    for (const msg of currentSession.messages) {
      if (msg.type === 'user') {
        lines.push(`## 🧑 User`);
        lines.push('');
        lines.push(msg.content);
        lines.push('');
      } else if (msg.type === 'assistant') {
        lines.push(`## 🤖 Assistant`);
        lines.push('');
        lines.push(msg.content);
        lines.push('');
      } else if (msg.type === 'tool_use' && msg.metadata?.toolName) {
        lines.push(`### 🔧 Tool: ${msg.metadata.toolName}`);
        lines.push('');
        if (msg.metadata.toolInput) {
          lines.push('```json');
          lines.push(JSON.stringify(msg.metadata.toolInput, null, 2));
          lines.push('```');
          lines.push('');
        }
      } else if (msg.type === 'tool_result') {
        lines.push('#### Tool Result');
        lines.push('');
        lines.push('```');
        lines.push(
          msg.content.slice(0, 2000) + (msg.content.length > 2000 ? '\n... (truncated)' : ''),
        );
        lines.push('```');
        lines.push('');
      }
    }
    return lines.join('\n');
  }, [currentSession]);

  const sessionToJSON = useCallback((): string => {
    if (!currentSession) return '{}';
    return JSON.stringify(
      {
        title: currentSession.title,
        createdAt: new Date(currentSession.createdAt).toISOString(),
        updatedAt: new Date(currentSession.updatedAt).toISOString(),
        status: currentSession.status,
        messages: currentSession.messages.map(msg => ({
          type: msg.type,
          content: msg.content,
          timestamp: new Date(msg.timestamp).toISOString(),
          ...(msg.metadata?.toolName ? { toolName: msg.metadata.toolName } : {}),
          ...(msg.metadata?.toolInput ? { toolInput: msg.metadata.toolInput } : {}),
        })),
      },
      null,
      2,
    );
  }, [currentSession]);

  const handleExportText = useCallback(
    async (format: 'md' | 'json') => {
      if (!currentSession) return;
      const content = format === 'md' ? sessionToMarkdown() : sessionToJSON();
      const timestamp = new Date().toISOString().slice(0, 10);
      const fileName = sanitizeExportFileName(`${currentSession.title}-${timestamp}.${format}`);
      try {
        const result = await window.electron.cowork.exportSessionText({
          content,
          defaultFileName: fileName,
          fileExtension: format,
        });
        if (result.success && !result.canceled) {
          window.dispatchEvent(
            new CustomEvent('app:showToast', {
              detail: i18nService.t('coworkExportTextSuccess'),
            }),
          );
        } else if (!result.success) {
          throw new Error(result.error || 'Export failed');
        }
      } catch (error) {
        console.error('Failed to export session text:', error);
        window.dispatchEvent(
          new CustomEvent('app:showToast', {
            detail: i18nService.t('coworkExportTextFailed'),
          }),
        );
      }
    },
    [currentSession, sessionToMarkdown, sessionToJSON],
  );

  const handleShareClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentSession || isExportingImage) return;
    setIsExportingImage(true);

    window.requestAnimationFrame(() => {
      void (async () => {
        try {
          const scrollContainer = scrollContainerRef.current;
          if (!scrollContainer) {
            throw new Error('Capture target not found');
          }
          const initialScrollTop = scrollContainer.scrollTop;
          try {
            const scrollRect = domRectToCaptureRect(scrollContainer.getBoundingClientRect());
            if (scrollRect.width <= 0 || scrollRect.height <= 0) {
              throw new Error('Invalid capture area');
            }

            const scrollContentHeight = Math.max(
              scrollContainer.scrollHeight,
              scrollContainer.clientHeight,
            );
            if (scrollContentHeight <= 0) {
              throw new Error('Invalid content height');
            }

            const toContentY = (viewportY: number): number => {
              const y = scrollContainer.scrollTop + (viewportY - scrollRect.y);
              return Math.max(0, Math.min(scrollContentHeight, y));
            };

            const userAnchors = scrollContainer.querySelectorAll<HTMLElement>(
              '[data-export-role="user-message"]',
            );
            const assistantAnchors = scrollContainer.querySelectorAll<HTMLElement>(
              '[data-export-role="assistant-block"]',
            );

            let contentStart = 0;
            let contentEnd = scrollContentHeight;

            if (userAnchors.length > 0) {
              contentStart = toContentY(userAnchors[0].getBoundingClientRect().top);
            } else if (assistantAnchors.length > 0) {
              contentStart = toContentY(assistantAnchors[0].getBoundingClientRect().top);
            }

            if (assistantAnchors.length > 0) {
              const lastAssistant = assistantAnchors[assistantAnchors.length - 1];
              contentEnd = toContentY(lastAssistant.getBoundingClientRect().bottom);
            } else if (userAnchors.length > 0) {
              const lastUser = userAnchors[userAnchors.length - 1];
              contentEnd = toContentY(lastUser.getBoundingClientRect().bottom);
            }

            const maxStart = Math.max(0, scrollContentHeight - 1);
            contentStart = Math.max(0, Math.min(maxStart, Math.round(contentStart)));
            contentEnd = Math.max(
              contentStart + 1,
              Math.min(scrollContentHeight, Math.round(contentEnd)),
            );

            const outputHeight = contentEnd - contentStart;

            if (outputHeight > MAX_EXPORT_CANVAS_HEIGHT) {
              throw new Error(`Export image is too tall (${outputHeight}px)`);
            }

            const segmentsEstimate = Math.ceil(outputHeight / Math.max(1, scrollRect.height)) + 1;
            if (segmentsEstimate > MAX_EXPORT_SEGMENTS) {
              throw new Error('Export image is too long');
            }

            const canvas = document.createElement('canvas');
            canvas.width = scrollRect.width;
            canvas.height = outputHeight;
            const context = canvas.getContext('2d');
            if (!context) {
              throw new Error('Canvas context unavailable');
            }

            const captureAndLoad = async (rect: CaptureRect): Promise<HTMLImageElement> => {
              const chunk = await coworkService.captureSessionImageChunk({ rect });
              if (!chunk.success || !chunk.pngBase64) {
                throw new Error(chunk.error || 'Failed to capture image chunk');
              }
              return loadImageFromBase64(chunk.pngBase64);
            };

            scrollContainer.scrollTop = Math.min(
              contentStart,
              Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight),
            );
            await waitForNextFrame();
            await waitForNextFrame();

            const maxScrollTop = Math.max(
              0,
              scrollContainer.scrollHeight - scrollContainer.clientHeight,
            );
            let contentOffset = contentStart;
            while (contentOffset < contentEnd) {
              const targetScrollTop = Math.min(contentOffset, maxScrollTop);
              scrollContainer.scrollTop = targetScrollTop;
              await waitForNextFrame();
              await waitForNextFrame();

              const chunkImage = await captureAndLoad(scrollRect);
              const sourceYOffset = Math.max(0, contentOffset - targetScrollTop);
              const drawableHeight = Math.min(
                scrollRect.height - sourceYOffset,
                contentEnd - contentOffset,
              );
              if (drawableHeight <= 0) {
                throw new Error('Failed to stitch export image');
              }
              const scaleY = chunkImage.naturalHeight / scrollRect.height;
              const sourceYInImage = Math.max(0, Math.round(sourceYOffset * scaleY));
              const sourceHeightInImage = Math.max(
                1,
                Math.min(
                  chunkImage.naturalHeight - sourceYInImage,
                  Math.round(drawableHeight * scaleY),
                ),
              );

              context.drawImage(
                chunkImage,
                0,
                sourceYInImage,
                chunkImage.naturalWidth,
                sourceHeightInImage,
                0,
                contentOffset - contentStart,
                scrollRect.width,
                drawableHeight,
              );

              contentOffset += drawableHeight;
            }

            // Compose final canvas with branded header and footer
            const finalCanvas = await composeExportCanvas(
              canvas,
              currentSession.title,
              currentSession.createdAt,
            );

            const pngDataUrl = finalCanvas.toDataURL('image/png');
            const base64Index = pngDataUrl.indexOf(',');
            if (base64Index < 0) {
              throw new Error('Failed to encode export image');
            }

            const timestamp = formatExportTimestamp(new Date());
            const saveResult = await coworkService.saveSessionResultImage({
              pngBase64: pngDataUrl.slice(base64Index + 1),
              defaultFileName: sanitizeExportFileName(`${currentSession.title}-${timestamp}.png`),
            });
            if (saveResult.success && !saveResult.canceled) {
              window.dispatchEvent(
                new CustomEvent('app:showToast', {
                  detail: i18nService.t('coworkExportImageSuccess'),
                }),
              );
              return;
            }
            if (!saveResult.success) {
              throw new Error(saveResult.error || 'Failed to export image');
            }
          } finally {
            scrollContainer.scrollTop = initialScrollTop;
          }
        } catch (error) {
          console.error('Failed to export session image:', error);
          window.dispatchEvent(
            new CustomEvent('app:showToast', {
              detail: i18nService.t('coworkExportImageFailed'),
            }),
          );
        } finally {
          setIsExportingImage(false);
        }
      })();
    });
  };

  const navigateToRailItem = useCallback((railIndex: number) => {
    if (railIndex < 0 || railIndex >= railItemCountRef.current) return;

    // Find the turn that contains this rail item
    const ranges = turnToRailRangeRef.current;
    let targetTurnIdx = -1;
    for (let t = 0; t < ranges.length; t++) {
      if (ranges[t] && railIndex >= ranges[t].first && railIndex <= ranges[t].last) {
        targetTurnIdx = t;
        break;
      }
    }

    isNavigatingRef.current = true;
    if (navigatingTimerRef.current) clearTimeout(navigatingTimerRef.current);
    navigatingTimerRef.current = setTimeout(() => {
      isNavigatingRef.current = false;
    }, NAV_SCROLL_LOCK_DURATION);

    // Try to scroll to the exact data-rail-index element if it's mounted;
    // otherwise let the virtualizer bring the target turn into view, then
    // refine to the exact block once it mounts.
    const container = scrollContainerRef.current;
    if (container) {
      const el = container.querySelector<HTMLElement>(`[data-rail-index="${railIndex}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (targetTurnIdx >= 0) {
        virtualizedTurnListRef.current?.scrollToTurn(targetTurnIdx);
        const refine = (attemptsLeft: number) => {
          const target = container.querySelector<HTMLElement>(`[data-rail-index="${railIndex}"]`);
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } else if (attemptsLeft > 0) {
            window.requestAnimationFrame(() => refine(attemptsLeft - 1));
          }
        };
        window.requestAnimationFrame(() => refine(30));
      }
    }

    currentRailIndexRef.current = railIndex;
    setCurrentRailIndex(railIndex);
  }, []);

  // lastMessageContent and messagesLength are now sourced from memoized
  // selectors (selectLastMessageContent / selectCurrentMessagesLength)
  // so there is no need to derive them from currentSession here.

  const resolveLocalFilePath = useCallback(
    (href: string, text: string) => {
      const hrefValue = typeof href === 'string' ? href.trim() : '';
      const textValue = typeof text === 'string' ? text.trim() : '';
      if (!hrefValue && !textValue) return null;

      const hrefRootRelative = hrefValue ? parseRootRelativePath(hrefValue) : null;
      if (hrefRootRelative) {
        return hrefRootRelative;
      }

      const hrefPath = hrefValue ? normalizeLocalPath(hrefValue) : null;
      if (hrefPath) {
        if (hrefPath.isRelative && currentSession?.cwd) {
          return toAbsolutePathFromCwd(hrefPath.path, currentSession.cwd);
        }
        if (hrefPath.isAbsolute) {
          return hrefPath.path;
        }
      }

      const textRootRelative = textValue ? parseRootRelativePath(textValue) : null;
      if (textRootRelative) {
        return textRootRelative;
      }

      const textPath = textValue ? normalizeLocalPath(textValue) : null;
      if (textPath) {
        if (textPath.isRelative && currentSession?.cwd) {
          return toAbsolutePathFromCwd(textPath.path, currentSession.cwd);
        }
        if (textPath.isAbsolute) {
          return textPath.path;
        }
      }

      return null;
    },
    [currentSession?.cwd],
  );

  const mapDisplayText = useCallback((value: string): string => {
    return value;
  }, []);

  const handleReEdit = useCallback(
    (message: CoworkMessage) => {
      const ref = promptInputRef.current;
      if (!ref) return;
      // Set text content
      if (message.content?.trim()) {
        ref.setValue(message.content);
      }
      // Restore image attachments (always call to clear previous attachments)
      const imageAttachments = ((message.metadata as CoworkMessageMetadata)?.imageAttachments ??
        []) as CoworkImageAttachment[];
      ref.setImageAttachments(imageAttachments);
      // Restore active skills
      const skillIds = (message.metadata as CoworkMessageMetadata)?.skillIds;
      if (skillIds && skillIds.length > 0) {
        dispatch(setActiveSkillIds(skillIds));
      }
      // Focus the input
      ref.focus();
    },
    [dispatch],
  );

  const messages = currentSession?.messages;
  const todoQueue = useTodoQueueLifecycle({
    isStreaming,
    sessionId,
  });
  const isAwaitingInlineQuestion = Boolean(inlineQuestionPermission && onRespondToInlineQuestion);
  const displayItems = useMemo(() => (messages ? buildDisplayItems(messages) : []), [messages]);
  const rawTurns = useMemo(() => buildConversationTurns(displayItems), [displayItems]);
  // Stabilize turn object identity so completed turns do not re-render on
  // every streaming token (issue #141).
  const turns = useStableConversationTurns(rawTurns, sessionId);
  const turnArtifactsMap = useTurnArtifacts(turns, sessionArtifacts, PREVIEWABLE_ARTIFACT_TYPES);
  // Scope persisted collapsible state to this session. Rendered sessions are
  // shown one at a time, so a render-time namespace assignment is safe.
  setPersistentToggleNamespace(currentSession?.id ?? '');
  // Rail indices come from data, not DOM, so virtualized (unmounted) turns
  // keep correct rail numbering.
  const turnRailIndices = useMemo(() => buildTurnRailIndices(turns), [turns]);

  const markInitialHistoryTailPositioned = useSessionHistoryPagination({
    sessionId,
    messagesOffset: currentSession?.messagesOffset ?? 0,
    rootRef: detailRootRef,
  });
  useConversationRailScrollSync({
    sessionId,
    rootRef: detailRootRef,
    scrollContainerRef,
    currentRailIndexRef,
    isNavigatingRef,
    setCurrentRailIndex,
  });

  // Sync rail index when turns change or rail first appears ((turns.length > 1) becomes true)
  useEffect(() => {
    // After turns/scrollable change, if rail index is uninitialized (-1) or out of bounds,
    // wait for next frame so render IIFE has updated railItemCountRef, then sync
    const frameId = requestAnimationFrame(() => {
      const count = railItemCountRef.current;
      if (count === 0) return;
      const idx = currentRailIndexRef.current;
      if (idx < 0 || idx >= count) {
        const resolved = count - 1;
        currentRailIndexRef.current = resolved;
        setCurrentRailIndex(resolved);
      }
    });
    return () => cancelAnimationFrame(frameId);
  }, [turns, turns.length]);

  // Scroll rail lines container to keep active item visible (without affecting page scroll)
  useEffect(() => {
    const container = railLinesRef.current;
    if (!container || currentRailIndex < 0) return;
    const activeEl = container.children[currentRailIndex] as HTMLElement | undefined;
    if (!activeEl) return;
    // Manual scroll calculation to avoid scrollIntoView bubbling to parent scrollable
    const elTop = activeEl.offsetTop;
    const elBottom = elTop + activeEl.offsetHeight;
    if (elTop < container.scrollTop) {
      container.scrollTop = elTop;
    } else if (elBottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = elBottom - container.clientHeight;
    }
  }, [currentRailIndex]);

  // StickToBottom (Conversation) handles auto-scroll during streaming

  if (!currentSession) {
    return null;
  }

  const renderConversationTurns = () => {
    if (turns.length === 0) {
      if (!isStreaming) return null;
      return (
        <div data-export-role="assistant-block">
          <TurnBlock
            turn={{
              id: 'streaming-only',
              userMessage: null,
              assistantItems: [],
            }}
            resolveLocalFilePath={resolveLocalFilePath}
            showTypingIndicator={toolActivities.length === 0}
            toolActivities={toolActivities}
            showCopyButtons={!isStreaming}
            isTurnComplete={false}
          />
        </div>
      );
    }

    const renderTurn = (turn: (typeof turns)[number], index: number) => {
      const isLastTurn = index === turns.length - 1;
      const hasActiveToolActivity = isStreaming && isLastTurn && toolActivities.length > 0;
      const showTypingIndicator =
        isStreaming && isLastTurn && !hasRenderableAssistantContent(turn) && !hasActiveToolActivity;
      const showAssistantBlock =
        turn.assistantItems.length > 0 || showTypingIndicator || hasActiveToolActivity;
      // Rail indices are precomputed from data (virtualized turns may be unmounted)
      const userRailIdx = turnRailIndices[index]?.user ?? -1;
      const asstRailIdx = turnRailIndices[index]?.assistant ?? -1;

      const turnArtifacts = turnArtifactsMap.get(turn.id) ?? [];

      return (
        <div key={turn.id} data-turn-index={index}>
          {turn.userMessage && (
            <div
              data-export-role="user-message"
              className={isLastTurn ? 'animate-message-in' : undefined}
              {...(userRailIdx >= 0 ? { 'data-rail-index': userRailIdx } : undefined)}
            >
              <UserBubble
                message={turn.userMessage}
                skills={skills}
                onReEdit={remoteManaged ? undefined : handleReEdit}
              />
            </div>
          )}
          {showAssistantBlock && (
            <div
              data-export-role="assistant-block"
              className={isLastTurn ? 'animate-message-in' : undefined}
              {...(asstRailIdx >= 0 ? { 'data-rail-index': asstRailIdx } : undefined)}
            >
              <TurnBlock
                turn={turn}
                artifacts={turnArtifacts}
                resolveLocalFilePath={resolveLocalFilePath}
                mapDisplayText={mapDisplayText}
                showTypingIndicator={showTypingIndicator}
                toolActivities={isLastTurn ? toolActivities : undefined}
                showCopyButtons={!isStreaming || !isLastTurn}
                isTurnComplete={!isStreaming || !isLastTurn}
                recoverableTaskId={recoverableTaskId}
                resumeTaskId={resumeTaskId}
                onResumeTask={onResumeTask ? handleResumeTask : undefined}
                expandToolResults={isExportingImage}
              />
            </div>
          )}
        </div>
      );
    };

    return (
      <VirtualizedTurnList
        key={sessionId}
        ref={virtualizedTurnListRef}
        isStreaming={isStreaming}
        turns={turns}
        onInitialTailPositioned={markInitialHistoryTailPositioned}
        renderTurn={renderTurn}
        renderAll={isExportingImage}
      />
    );
  };

  return (
    <CoworkSessionLayout
      title={currentSession.title || i18nService.t('coworkNewSession')}
      sessionId={sessionId}
      isSessionSwitching={isSessionSwitching}
      isSidebarCollapsed={isSidebarCollapsed}
      isArtifactPanelOpen={isPanelOpen}
      onToggleSidebar={onToggleSidebar}
      onNewChat={onNewChat}
      onToggleArtifactPanel={() => dispatch(togglePanel())}
      updateBadge={updateBadge}
    >
      {/* Export Options Modal */}
      {!isSessionSwitching && showExportOptions && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop"
          onClick={() => setShowExportOptions(false)}
        >
          <div
            className="w-full max-w-xs mx-4 dark:bg-claude-darkSurface bg-claude-surface rounded-2xl shadow-modal overflow-hidden modal-content"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b dark:border-claude-darkBorder border-claude-border">
              <h3 className="text-base font-semibold dark:text-claude-darkText text-claude-text">
                {i18nService.t('coworkExportAs')}
              </h3>
            </div>
            <div className="py-1">
              <Button
                variant="ghost"
                className="w-full justify-start gap-3 px-5 py-3 h-auto text-sm"
                onClick={e => {
                  setShowExportOptions(false);
                  handleShareClick(e);
                }}
                disabled={isExportingImage}
              >
                <ImageIcon className="h-5 w-5" />
                <div>
                  <div className="font-medium">{i18nService.t('coworkExportImage')}</div>
                  <div className="text-xs text-muted-foreground">
                    {i18nService.t('coworkExportImageDesc')}
                  </div>
                </div>
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start gap-3 px-5 py-3 h-auto text-sm"
                onClick={() => {
                  setShowExportOptions(false);
                  handleExportText('md');
                }}
              >
                <Download className="h-5 w-5" />
                <div>
                  <div className="font-medium">Markdown</div>
                  <div className="text-xs text-muted-foreground">
                    {i18nService.t('coworkExportMarkdownDesc')}
                  </div>
                </div>
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start gap-3 px-5 py-3 h-auto text-sm"
                onClick={() => {
                  setShowExportOptions(false);
                  handleExportText('json');
                }}
              >
                <Download className="h-5 w-5" />
                <div>
                  <div className="font-medium">JSON</div>
                  <div className="text-xs text-muted-foreground">
                    {i18nService.t('coworkExportJSONDesc')}
                  </div>
                </div>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Content row: chat + artifact panel */}
      <div ref={contentRowRef} className="flex-1 flex overflow-hidden">
        <div
          ref={detailRootRef}
          className={`relative min-w-0 flex-1 flex flex-col bg-background h-full ${
            !isSessionSwitching && isArtifactWorkspace ? 'hidden' : ''
          }`}
          aria-hidden={!isSessionSwitching && isArtifactWorkspace}
        >
          <div className="relative flex-1 min-h-0">
            {isSessionSwitching ? (
              <CoworkConversationLoadingSkeleton />
            ) : (
              <Conversation
                className="h-full"
                initial="instant"
                resize={isStreaming ? 'smooth' : 'instant'}
              >
                <ConversationContent
                  className="pt-3"
                  observeContentResize={false}
                  reverse={false}
                  scrollClassName="cowork-conversation-scroll"
                >
                  <div ref={scrollContainerRef}>
                    {renderConversationTurns()}
                    {inlineQuestionPermission && onRespondToInlineQuestion && (
                      <div className="px-3 pt-3">
                        <AskUserQuestionCard
                          permission={inlineQuestionPermission}
                          onRespond={onRespondToInlineQuestion}
                        />
                      </div>
                    )}
                    {sessionId && (
                      <div className="px-3 pt-3">
                        <WorkbenchTaskAcceptanceCard sessionId={sessionId} />
                      </div>
                    )}
                    <div
                      aria-hidden="true"
                      style={{ height: `calc(${COWORK_COMPOSER_INSET_VALUE} + 1rem)` }}
                    />
                  </div>
                </ConversationContent>
                <ConversationScrollButton
                  style={{ bottom: `calc(${COWORK_COMPOSER_INSET_VALUE} + 1rem)` }}
                />
              </Conversation>
            )}

            {/* Turn navigation rail removed: message content remains scrollable in the conversation. */}
            {!isSessionSwitching && turns.length > 1 && (
              <div
                className="hidden absolute right-[18px] top-1/2 -translate-y-1/2 w-5 flex flex-col items-end z-10"
                style={{ maxHeight: 'calc(100% - 40px)' }}
                onMouseEnter={() => setIsRailHovered(true)}
                onMouseLeave={() => {
                  setIsRailHovered(false);
                  setHoveredRailIndex(null);
                  setRailTooltip(null);
                }}
              >
                {/* Up Arrow */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={i18nService.t('coworkQuestionWizardPrevious')}
                  disabled={
                    (currentRailIndex < 0 ? railItemCountRef.current - 1 : currentRailIndex) <= 0
                  }
                  onClick={() => {
                    const resolvedRail =
                      currentRailIndex < 0 ? railItemCountRef.current - 1 : currentRailIndex;
                    if (resolvedRail <= 0) return;
                    navigateToRailItem(resolvedRail - 1);
                  }}
                  onMouseEnter={() => {
                    setHoveredRailIndex(null);
                  }}
                  className={`mb-2 mr-[-5px] size-5 text-muted-foreground [&_svg]:size-3.5
                ${
                  !isRailHovered
                    ? 'pointer-events-none opacity-0'
                    : (currentRailIndex < 0 ? railItemCountRef.current - 1 : currentRailIndex) <= 0
                      ? 'opacity-30 cursor-default'
                      : 'cursor-pointer hover:text-foreground'
                }`}
                >
                  <ChevronUp />
                </Button>

                {/* Message Lines */}
                <div
                  ref={railLinesRef}
                  className="overflow-y-auto min-h-0 flex-1"
                  style={{ scrollbarWidth: 'none' }}
                >
                  {(() => {
                    // Build flat list of messages with their content length and turn index
                    const MIN_W = 6; // px
                    const MAX_W = 16; // px
                    // Strip common markdown syntax for tooltip display
                    const stripMd = (s: string) =>
                      s
                        .replace(/^#+\s+/gm, '')
                        .replace(/```[\s\S]*?```/g, ' ')
                        .replace(/`[^`]*`/g, ' ')
                        .replace(/[*_~>]/g, '')
                        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
                        .replace(/\s+/g, ' ')
                        .trim();
                    // Get first meaningful text snippet from content
                    const getLabel = (content: string, fallback: string) => {
                      const stripped = stripMd(content);
                      return stripped.slice(0, 50) || fallback;
                    };
                    type RailItem = {
                      key: string;
                      turnIndex: number;
                      label: string;
                      contentLen: number;
                      isUser: boolean;
                    };
                    const items: RailItem[] = [];
                    for (let i = 0; i < turns.length; i++) {
                      const turn = turns[i];
                      if (turn.userMessage) {
                        const content = turn.userMessage.content ?? '';
                        items.push({
                          key: `${turn.id}-user`,
                          turnIndex: i,
                          label: getLabel(content, `Turn ${i + 1}`),
                          contentLen: content.length,
                          isUser: true,
                        });
                      }
                      // Aggregate all assistant content into one line per turn
                      let asstContent = '';
                      for (const item of turn.assistantItems) {
                        if (item.type === 'assistant' && item.message?.content) {
                          asstContent += item.message.content;
                        }
                      }
                      if (asstContent) {
                        items.push({
                          key: `${turn.id}-asst`,
                          turnIndex: i,
                          label: getLabel(asstContent, '知远智能体'),
                          contentLen: asstContent.length,
                          isUser: false,
                        });
                      }
                    }
                    const maxLen = items.reduce((acc, m) => Math.max(acc, m.contentLen), 1);
                    // Sync rail item count and turn-to-rail mapping
                    railItemCountRef.current = items.length;
                    const rangeMap: { first: number; last: number }[] = [];
                    for (let ri = 0; ri < items.length; ri++) {
                      const ti = items[ri].turnIndex;
                      if (!rangeMap[ti]) {
                        rangeMap[ti] = { first: ri, last: ri };
                      } else {
                        rangeMap[ti].last = ri;
                      }
                    }
                    turnToRailRangeRef.current = rangeMap;

                    // Clamp rail index to valid range
                    const resolvedRailIndex =
                      currentRailIndex < 0 || currentRailIndex >= items.length
                        ? items.length - 1
                        : currentRailIndex;

                    return items.map((msg, idx) => {
                      const isActive = idx === resolvedRailIndex;
                      const isHovered = idx === hoveredRailIndex;
                      const ratio = msg.contentLen / maxLen;
                      const lineW = Math.round(MIN_W + ratio * (MAX_W - MIN_W));
                      return (
                        <Button
                          key={msg.key}
                          type="button"
                          variant="ghost"
                          aria-label={msg.label}
                          aria-current={isActive ? 'true' : undefined}
                          onClick={() => {
                            navigateToRailItem(idx);
                          }}
                          onMouseEnter={e => {
                            setHoveredRailIndex(idx);
                            const rect = e.currentTarget.getBoundingClientRect();
                            const top = Math.max(
                              8,
                              Math.min(rect.top + rect.height / 2, window.innerHeight - 8),
                            );
                            setRailTooltip({
                              label: msg.label,
                              top,
                              right: window.innerWidth - rect.left + 8,
                              isUser: msg.isUser,
                            });
                          }}
                          onMouseLeave={() => setRailTooltip(null)}
                          className="h-auto w-5 cursor-pointer justify-end px-0 py-[5px]"
                        >
                          <div
                            className={`h-[2px] w-4 origin-right rounded-full transition-[transform,background-color] ${
                              isActive || isHovered ? 'bg-foreground' : 'bg-border'
                            }`}
                            style={{
                              transform: `scaleX(${(isActive || isHovered ? MAX_W : lineW) / MAX_W})`,
                            }}
                          />
                        </Button>
                      );
                    });
                  })()}
                </div>

                {/* Down Arrow */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={i18nService.t('coworkQuestionWizardNext')}
                  disabled={
                    (currentRailIndex < 0 ? railItemCountRef.current - 1 : currentRailIndex) >=
                    railItemCountRef.current - 1
                  }
                  onClick={() => {
                    const maxRail = railItemCountRef.current - 1;
                    const resolvedRail = currentRailIndex < 0 ? maxRail : currentRailIndex;
                    if (resolvedRail >= maxRail) return;
                    navigateToRailItem(resolvedRail + 1);
                  }}
                  onMouseEnter={() => {
                    setHoveredRailIndex(null);
                  }}
                  className={`mt-2 mr-[-5px] size-5 text-muted-foreground [&_svg]:size-3.5
                ${
                  !isRailHovered
                    ? 'pointer-events-none opacity-0'
                    : (currentRailIndex < 0 ? railItemCountRef.current - 1 : currentRailIndex) >=
                        railItemCountRef.current - 1
                      ? 'opacity-30 cursor-default'
                      : 'cursor-pointer hover:text-foreground'
                }`}
                >
                  <ChevronDown />
                </Button>
              </div>
            )}

            {!isSessionSwitching &&
              railTooltip &&
              createPortal(
                <div
                  className={`fixed z-100 px-3.5 py-2 text-[13px] leading-snug pointer-events-none overflow-hidden
              max-w-[240px] shadow-elevated
              border
              ${
                railTooltip.isUser
                  ? 'rounded-[12px_12px_4px_12px] bg-white border-neutral-200/80 dark:bg-neutral-800 dark:border-neutral-700'
                  : 'rounded-xl bg-neutral-50 border-neutral-200/80 dark:bg-neutral-800 dark:border-neutral-700'
              }`}
                  style={{
                    top: railTooltip.top,
                    right: railTooltip.right,
                    transform: 'translateY(-50%)',
                  }}
                >
                  {!railTooltip.isUser && (
                    <div className="text-[12px] font-medium mb-0.5 text-neutral-800 dark:text-neutral-200">
                      知远智能体：
                    </div>
                  )}
                  <div
                    className="text-neutral-600 dark:text-neutral-300"
                    style={{
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      wordBreak: 'break-all',
                    }}
                  >
                    {railTooltip.label}
                  </div>
                </div>,
                document.body,
              )}
          </div>

          {/* Input Area */}
          <div
            ref={composerOverlayRef}
            className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-4"
          >
            <div className="mx-auto grid w-full max-w-5xl min-w-[320px] pl-4">
              <div className="pointer-events-auto relative col-start-1 row-start-1 self-end rounded-t-3xl bg-background pb-4">
                <CoworkPromptInput
                  ref={promptInputRef}
                  topAccessory={
                    isSessionSwitching ? null : (
                      <>
                        {workMode === CoworkSessionMode.Work &&
                          !isDirectChat &&
                          currentSession?.id && (
                            <PendingMessageQueue
                              sessionId={currentSession.id}
                              isStreaming={isStreaming}
                            />
                          )}
                        <TodoQueue todos={todoQueue.todos} isDismissing={todoQueue.isDismissing} />
                      </>
                    )
                  }
                  onSubmit={onContinue}
                  onStop={onStop}
                  isStreaming={isSessionSwitching ? false : isStreaming}
                  placeholder={i18nService.t(
                    !isSessionSwitching && remoteManaged
                      ? 'coworkRemoteManagedPlaceholder'
                      : workMode === 'chat'
                        ? 'chatPlaceholder'
                        : 'coworkContinuePlaceholder',
                  )}
                  disabled={
                    !isSessionSwitching &&
                    (remoteManaged || isAwaitingInlineQuestion || Boolean(inlinePermission))
                  }
                  sessionContextPending={isSessionSwitching}
                  size="large"
                  remoteManaged={!isSessionSwitching && remoteManaged}
                  onManageSkills={!isSessionSwitching && remoteManaged ? undefined : onManageSkills}
                  onManageConnectors={
                    !isSessionSwitching && remoteManaged ? undefined : onManageConnectors
                  }
                  showPermissionModeSelector={workMode === 'work'}
                  permissionMode={permissionMode}
                  onPermissionModeChange={onPermissionModeChange}
                  showModelSelector={true}
                  isDirectChat={isDirectChat}
                  showLocalThinkingToggle={isDirectChat}
                  localThinkingEnabled={localThinkingEnabled}
                  onLocalThinkingEnabledChange={onLocalThinkingEnabledChange}
                  resumeTaskActive={Boolean(resumeTaskId)}
                  onCancelTaskResume={onCancelTaskResume}
                  sessionId={displayedSessionId ?? currentSession?.id}
                />
                <p className="text-center text-[11px] text-muted opacity-85 mt-2 mb-[-8px] select-none">
                  {i18nService.t('aiGeneratedDisclaimer')}
                </p>
              </div>
              {!isSessionSwitching && inlinePermission && onRespondToInlinePermission && (
                <div className="pointer-events-auto relative z-10 col-start-1 row-start-1 self-end">
                  <CoworkPermissionModal
                    permission={inlinePermission}
                    onRespond={onRespondToInlinePermission}
                    inline
                  />
                </div>
              )}
            </div>
          </div>
        </div>
        {!isSessionSwitching && shouldRenderArtifactPanel && (
          <ArtifactPanelErrorBoundary onClose={() => dispatch(closePanel())}>
            <React.Suspense
              fallback={
                <ArtifactPanelFallback
                  layoutMode={artifactLayoutMode}
                  minPanelWidth={MIN_PANEL_WIDTH}
                  maxPanelWidth={artifactPanelMaxWidth}
                />
              }
            >
              <ArtifactPanelFrame
                sessionId={previewSessionId}
                cwd={currentSession?.cwd}
                artifacts={previewArtifacts}
                isOpen={isPanelOpen}
                isVisible={isArtifactPanelVisible}
                isTransitioning={isArtifactPanelTransitioning}
                layoutMode={artifactLayoutMode}
                minPanelWidth={MIN_PANEL_WIDTH}
                maxPanelWidth={artifactPanelMaxWidth}
              />
            </React.Suspense>
          </ArtifactPanelErrorBoundary>
        )}
      </div>
    </CoworkSessionLayout>
  );
};

export default CoworkSessionDetail;
