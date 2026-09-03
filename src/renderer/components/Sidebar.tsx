import { AgentId } from '@shared/agent';
import { Button } from '@shared/components/ui/button';
import { Checkbox } from '@shared/components/ui/checkbox';
import { cn } from '@shared/lib/utils';
import { MotionConfig, useReducedMotion } from 'motion/react';
import { MessageCircle, Trash2, X } from 'lucide-react';
import { DestructiveConfirmDialog } from '@shared/components/ui/destructive-confirm-dialog';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';

import { agentService } from '../services/agent';
import { configService } from '../services/config';
import { coworkService } from '../services/cowork';
import { i18nService } from '../services/i18n';
import { RootState, store } from '../store';
import {
  selectCoworkSessions,
  selectChatSessions,
  selectChatSessionsLoaded,
  selectCurrentSessionId,
  selectStreamingSessionIds,
  selectUnreadSessionIds,
} from '../store/selectors/coworkSelectors';
import { selectWorkMode } from '../store/selectors/workModeSelectors';
import {
  clearLoadingSessionId,
  setCurrentSession,
  setLoadingSessionId,
} from '../store/slices/coworkSlice';
import { WorkMode } from '../store/workMode/constants';
import { setWorkMode } from '../store/workMode/workModeSlice';
import type { CoworkSessionSummary } from '../types/cowork';
import { CoworkSessionStatusValue } from '../types/cowork';
import AgentTaskRow from './agentSidebar/AgentTaskRow';
import ChatSkillShortcuts from './chat/ChatSkillShortcuts';
import {
  CodingWorkspaceSidebar,
  type CodingSidebarSelection,
} from './coding/CodingWorkspaceSidebar';
import {
  SidebarAnimatedSearchIcon,
  type SidebarAnimatedSearchIconHandle,
} from './icons/SidebarAnimatedSearchIcon';
import { SidebarAnimatedPanelLeftCloseIcon } from './icons/SidebarAnimatedPanelLeftCloseIcon';
import { toggleBatchSelection, toggleVisibleBatchSelection } from './agentSidebar/batchSelection';
import MyAgentSidebarTree from './agentSidebar/MyAgentSidebarTree';
import { sortAgentSidebarTasks, toAgentSidebarTaskNode } from './agentSidebar/useAgentSidebarState';
import LoginButton from './LoginButton';
import type { PrefetchableFeatureView } from './featureViewPrefetch';
import { SidebarNavigationControls, type SidebarActiveView } from './SidebarNavigationControls';

interface SidebarProps {
  onShowSettings: () => void;
  activeView: SidebarActiveView;
  onShowSkills: () => void;
  onShowCowork: () => void;
  onShowScheduledTasks: () => void;
  onShowActivity: () => void;
  onShowMcp: () => void;
  onShowLocalInference: () => void;
  onShowExpert: () => void;
  onShowCoding: () => void;
  onShowTodo: () => void;
  codingSelection: CodingSidebarSelection;
  onCodingSelectionChange: (selection: CodingSidebarSelection) => void;
  onNewChat: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  updateEntry?: React.ReactNode;
  hideLogin?: boolean;
  managedModelsOnly?: boolean;
  /** Warms the lazily loaded chunk for a view on hover/focus intent. */
  onPrefetchView?: (view: PrefetchableFeatureView) => void;
}

const DEFAULT_SIDEBAR_WIDTH = 244;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 420;
const SIDEBAR_COLLAPSE_TRANSITION_MS = 200;
const Sidebar: React.FC<SidebarProps> = ({
  onShowSettings,
  activeView,
  onShowCowork,
  onShowScheduledTasks,
  onShowActivity,
  onShowLocalInference,
  onShowExpert,
  onShowCoding,
  onShowTodo,
  codingSelection,
  onCodingSelectionChange,
  onNewChat,
  isCollapsed,
  onToggleCollapse,
  updateEntry,
  hideLogin,
  managedModelsOnly = false,
  onPrefetchView,
}) => {
  const dispatch = useDispatch();
  const currentAgentId = useSelector((state: RootState) => state.agent.currentAgentId);
  const allSessions = useSelector(selectCoworkSessions);
  const chatSessions = useSelector(selectChatSessions);
  const chatSessionsLoaded = useSelector(selectChatSessionsLoaded);
  const streamingSessionIds = useSelector(selectStreamingSessionIds);
  const currentSessionId = useSelector(selectCurrentSessionId);
  const unreadSessionIds = useSelector(selectUnreadSessionIds);
  const workMode = useSelector(selectWorkMode);
  // Inline sidebar search stays mounted so filtering does not shift the list.
  // The full result set is fetched while typing so filtering stays instant.
  const [searchQuery, setSearchQuery] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const [searchCorpus, setSearchCorpus] = useState<CoworkSessionSummary[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchIconRef = useRef<SidebarAnimatedSearchIconHandle>(null);
  const prefersReducedMotion = useReducedMotion();
  const searchControlRef = useRef<HTMLDivElement>(null);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [recentlyDeletedSessionIds, setRecentlyDeletedSessionIds] = useState<string[]>([]);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [agentScrollEdges, setAgentScrollEdges] = useState({ top: false, bottom: false });
  const handleWorkModeChange = useCallback(
    (checked: boolean) => {
      const mode = checked ? WorkMode.Chat : WorkMode.Work;
      dispatch(setWorkMode(mode));
      if (mode === WorkMode.Chat) {
        onShowCowork();
      }
      setIsBatchMode(false);
      setSelectedIds(new Set());
      setShowBatchDeleteConfirm(false);
      void configService.updateConfig({ workMode: mode });
    },
    [dispatch, onShowCowork],
  );

  // Filter sessions by workMode — chat sessions only visible in chat mode
  const sessions = React.useMemo(
    () =>
      workMode === WorkMode.Chat ? chatSessions : allSessions.filter(s => s.mode !== WorkMode.Chat),
    [allSessions, chatSessions, workMode],
  );

  // Chat mode: map sessions to AgentSidebarTaskNode for AgentTaskRow rendering
  const unreadSessionIdSet = React.useMemo(() => new Set(unreadSessionIds), [unreadSessionIds]);
  const searchQueryTrimmed = searchQuery.trim().toLowerCase();
  // Search results come from searchCorpus (global, cross-agent) and may NOT be in
  // the mode-filtered Redux `sessions`, so resolve clicks via this corpus map.
  const searchSessionById = React.useMemo(() => {
    const map = new Map<string, CoworkSessionSummary>();
    searchCorpus.forEach(s => map.set(s.id, s));
    return map;
  }, [searchCorpus]);
  const chatTaskNodes = React.useMemo(() => {
    if (workMode !== WorkMode.Chat) return [];
    const scoped = searchQueryTrimmed
      ? sessions.filter(s => s.title.toLowerCase().includes(searchQueryTrimmed))
      : sessions;
    const sorted = sortAgentSidebarTasks(scoped, streamingSessionIds);
    const streamingSessionIdSet = new Set(streamingSessionIds);
    return sorted.map(s =>
      toAgentSidebarTaskNode(s, currentSessionId, unreadSessionIdSet, streamingSessionIdSet),
    );
  }, [
    workMode,
    sessions,
    currentSessionId,
    unreadSessionIdSet,
    streamingSessionIds,
    searchQueryTrimmed,
  ]);

  const isResizingRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(DEFAULT_SIDEBAR_WIDTH);
  const pendingResizeWidthRef = useRef(DEFAULT_SIDEBAR_WIDTH);
  const resizeRafRef = useRef<number | null>(null);
  const agentScrollContainerRef = useRef<HTMLDivElement>(null);
  // 保存侧边栏树中所有可见 session ID（跨所有 Agent 聚合），
  // 供批量模式"全选"使用，避免因 Redux sessions 被限定到单个 Agent 而导致全选范围错误
  const allVisibleSessionIdsRef = useRef<string[]>([]);
  const isMac = window.electron.platform === 'darwin';

  useEffect(() => {
    const handleSearch = () => {
      onShowCowork();
      setSearchActive(true);
      window.setTimeout(() => searchInputRef.current?.focus(), 0);
    };
    window.addEventListener('cowork:shortcut:search', handleSearch);
    return () => {
      window.removeEventListener('cowork:shortcut:search', handleSearch);
    };
  }, [onShowCowork]);

  // Clicking outside the search control clears the active query.
  useEffect(() => {
    if (!searchActive) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        searchControlRef.current?.contains(target) ||
        agentScrollContainerRef.current?.contains(target)
      ) {
        return;
      }
      setSearchActive(false);
      setSearchQuery('');
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [searchActive]);

  // Load the searchable corpus ONCE when search is activated, then filter it
  // client-side as the user types. Fetching per keystroke re-triggered the
  // loading overlay (a full-size absolute layer) and a tree rebuild on every
  // change, most visibly a stutter when deleting the last character (query 1 to 0).
  // With a single load, typing and clearing are synchronous filters.
  useEffect(() => {
    if (!searchActive) {
      setSearchCorpus([]);
      return;
    }
    let cancelled = false;
    void coworkService.listSessionsForSearch(100, 0).then(result => {
      if (cancelled) return;
      setSearchCorpus(result?.success ? (result.sessions ?? []) : []);
    });
    return () => {
      cancelled = true;
    };
  }, [searchActive]);

  useEffect(() => {
    if (!isCollapsed) return;
    setSearchActive(false);
    setSearchQuery('');
    setIsBatchMode(false);
    setSelectedIds(new Set());
    setShowBatchDeleteConfirm(false);
  }, [isCollapsed]);

  const handleSelectSession = async (session: CoworkSessionSummary) => {
    const agentId = session.agentId?.trim() || AgentId.Main;
    flushSync(() => {
      dispatch(setLoadingSessionId(session.id));
    });

    // If the target session is actively streaming in the background, restore its
    // live snapshot immediately so the user sees the active stream without
    // waiting for the DB round-trip. Only do this when the sidebar summary still
    // reports a running status, so a stale snapshot cannot override a completed
    // session after the renderer reloads.
    const streamingSnapshot = store.getState().cowork.streamingSessions[session.id];
    if (streamingSnapshot && session.status === CoworkSessionStatusValue.Running) {
      dispatch(setCurrentSession(streamingSnapshot));
    }

    // Chat sessions are not scoped to agents — skip loadSessions
    // to avoid replacing the full sessions list with a filtered subset.
    try {
      if (session.mode !== 'chat') {
        if (agentId !== currentAgentId) {
          agentService.switchAgent(agentId);
          await coworkService.loadSessions(agentId);
        }
      }
      onShowCowork();
      await coworkService.loadSession(session.id);
    } finally {
      dispatch(clearLoadingSessionId(session.id));
    }
  };

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    await coworkService.deleteSession(sessionId);
  }, []);

  const handleToggleSessionPin = useCallback(async (sessionId: string, pinned: boolean) => {
    await coworkService.setSessionPinned(sessionId, pinned);
  }, []);

  const handleRenameSession = useCallback(async (sessionId: string, title: string) => {
    await coworkService.renameSession(sessionId, title);
  }, []);

  const handleEnterBatchMode = useCallback((sessionId: string) => {
    setIsBatchMode(true);
    setSelectedIds(new Set([sessionId]));
  }, []);

  const handleExitBatchMode = useCallback(() => {
    setIsBatchMode(false);
    setSelectedIds(new Set());
    setShowBatchDeleteConfirm(false);
  }, []);

  const updateAgentScrollEdges = useCallback((element: HTMLDivElement | null) => {
    if (!element) {
      setAgentScrollEdges(previousEdges =>
        previousEdges.top || previousEdges.bottom ? { top: false, bottom: false } : previousEdges,
      );
      return;
    }

    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    const nextEdges = {
      top: element.scrollTop > 1,
      bottom: maxScrollTop - element.scrollTop > 1,
    };

    setAgentScrollEdges(previousEdges => {
      if (previousEdges.top === nextEdges.top && previousEdges.bottom === nextEdges.bottom) {
        return previousEdges;
      }
      return nextEdges;
    });
  }, []);

  const handleAgentScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      updateAgentScrollEdges(event.currentTarget);
    },
    [updateAgentScrollEdges],
  );

  const handleToggleSelection = useCallback((sessionId: string) => {
    setSelectedIds(prev => toggleBatchSelection(prev, sessionId));
  }, []);

  const handleVisibleSessionsChange = useCallback((ids: string[]) => {
    allVisibleSessionIdsRef.current = ids;
  }, []);

  useEffect(() => {
    if (workMode !== WorkMode.Chat) return;
    handleVisibleSessionsChange(chatTaskNodes.map(task => task.id));
  }, [chatTaskNodes, handleVisibleSessionsChange, workMode]);

  const handleSelectAll = useCallback(() => {
    const allIds = allVisibleSessionIdsRef.current;
    setSelectedIds(prev => toggleVisibleBatchSelection(prev, allIds));
  }, []);

  const handleBatchDeleteClick = useCallback(() => {
    if (selectedIds.size === 0) return;
    setShowBatchDeleteConfirm(true);
  }, [selectedIds.size]);

  const handleBatchDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const deleted = await coworkService.deleteSessions(ids);
    if (!deleted) return;
    setRecentlyDeletedSessionIds(ids);
    handleExitBatchMode();
  }, [selectedIds, handleExitBatchMode]);

  const handleResizeStart = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (isCollapsed) return;
      event.preventDefault();
      isResizingRef.current = true;
      setIsResizing(true);
      resizeStartXRef.current = event.clientX;
      resizeStartWidthRef.current = sidebarWidth;
      pendingResizeWidthRef.current = sidebarWidth;
      document.body.classList.add('select-none');

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isResizingRef.current) return;
        const nextWidth = resizeStartWidthRef.current + moveEvent.clientX - resizeStartXRef.current;
        if (nextWidth < MIN_SIDEBAR_WIDTH) {
          isResizingRef.current = false;
          setIsResizing(false);
          document.body.classList.remove('select-none');
          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('mouseup', handleMouseUp);
          onToggleCollapse();
          return;
        }
        pendingResizeWidthRef.current = Math.min(MAX_SIDEBAR_WIDTH, nextWidth);
        if (resizeRafRef.current !== null) return;
        resizeRafRef.current = requestAnimationFrame(() => {
          resizeRafRef.current = null;
          if (isResizingRef.current) setSidebarWidth(pendingResizeWidthRef.current);
        });
      };

      const handleMouseUp = () => {
        if (resizeRafRef.current !== null) {
          cancelAnimationFrame(resizeRafRef.current);
          resizeRafRef.current = null;
        }
        setSidebarWidth(pendingResizeWidthRef.current);
        isResizingRef.current = false;
        setIsResizing(false);
        document.body.classList.remove('select-none');
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [isCollapsed, onToggleCollapse, sidebarWidth],
  );

  useEffect(() => {
    return () => {
      if (resizeRafRef.current !== null) cancelAnimationFrame(resizeRafRef.current);
      document.body.classList.remove('select-none');
    };
  }, []);

  useEffect(() => {
    const element = agentScrollContainerRef.current;
    if (!element) return;

    updateAgentScrollEdges(element);

    const resizeObserver = new ResizeObserver(() => updateAgentScrollEdges(element));
    resizeObserver.observe(element);
    if (element.firstElementChild) {
      resizeObserver.observe(element.firstElementChild);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [updateAgentScrollEdges]);

  const renderSearchControl = (isChatMode = false) => (
    <div className={cn('shrink-0 bg-surface-raised', !isChatMode && 'px-3')}>
      <div
        ref={searchControlRef}
        onMouseEnter={() => {
          if (!prefersReducedMotion) searchIconRef.current?.startAnimation();
        }}
        onMouseLeave={() => searchIconRef.current?.stopAnimation()}
        role={searchActive ? undefined : 'button'}
        tabIndex={searchActive ? undefined : 0}
        aria-label={i18nService.t(workMode === WorkMode.Chat ? 'searchChats' : 'search')}
        onClick={() => {
          if (!searchActive) {
            setSearchActive(true);
            window.setTimeout(() => searchInputRef.current?.focus(), 0);
          }
        }}
        onKeyDown={event => {
          if (!searchActive && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            setSearchActive(true);
            window.setTimeout(() => searchInputRef.current?.focus(), 0);
          }
        }}
        className={cn(
          'inline-flex h-8 w-full items-center justify-start gap-2 overflow-hidden rounded-lg px-3 text-left text-[14px] font-normal text-muted-foreground',
          searchActive
            ? 'cursor-text bg-background'
            : 'sidebar-interactive-surface cursor-pointer transition-colors',
        )}
      >
        <SidebarAnimatedSearchIcon ref={searchIconRef} />
        {searchActive ? (
          <>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  setSearchActive(false);
                  setSearchQuery('');
                  searchInputRef.current?.blur();
                }
              }}
              placeholder={i18nService.t(workMode === WorkMode.Chat ? 'searchChats' : 'search')}
              className="h-full min-h-0 min-w-0 flex-1 border-0 bg-transparent p-0 text-[14px] font-normal leading-none text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            {searchQuery && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={i18nService.t('clearSearch')}
                onClick={event => {
                  event.stopPropagation();
                  setSearchQuery('');
                  searchInputRef.current?.focus();
                }}
                className="size-4 shrink-0 text-muted-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent [&_svg]:size-3.5"
              >
                <X />
              </Button>
            )}
          </>
        ) : (
          <span className="flex-1 truncate text-[14px] leading-none">
            {i18nService.t(workMode === WorkMode.Chat ? 'searchChats' : 'search')}
          </span>
        )}
      </div>
    </div>
  );

  return (
    <MotionConfig reducedMotion="user">
      <aside
        className={`relative shrink-0 overflow-hidden bg-surface-raised ${
          isResizing ? '' : 'sidebar-transition'
        }`}
        data-active-view={activeView}
        style={{ width: isCollapsed ? 0 : sidebarWidth }}
      >
        <div
          className={`flex h-full flex-col transition-opacity ease-out ${
            isCollapsed ? 'pointer-events-none opacity-0' : 'opacity-100'
          }`}
          style={{
            width: sidebarWidth,
            transitionDuration: `${SIDEBAR_COLLAPSE_TRANSITION_MS}ms`,
          }}
        >
          <div className={cn('pt-3', workMode === WorkMode.Chat ? 'pb-0' : 'pb-3')}>
            <div className="draggable sidebar-header-drag h-8 flex items-center justify-between px-3">
              <div className={`flex items-center gap-2 ${isMac ? 'pl-[68px]' : ''}`}>
                <img
                  src="zhiyuan-logo-light.svg"
                  alt="知远"
                  className="logo-light h-5 w-auto select-none"
                />
                <img
                  src="zhiyuan-logo-dark.svg"
                  alt="知远"
                  className="logo-dark h-5 w-auto select-none"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onToggleCollapse}
                className="non-draggable h-8 w-8 rounded-lg text-muted-foreground hover:bg-surface-raised transition-colors"
                aria-label={isCollapsed ? i18nService.t('expand') : i18nService.t('collapse')}
              >
                <SidebarAnimatedPanelLeftCloseIcon />
              </Button>
            </div>
            <SidebarNavigationControls
              activeView={activeView}
              onNewChat={onNewChat}
              onShowExpert={onShowExpert}
              onShowCoding={onShowCoding}
              onShowTodo={onShowTodo}
              onShowLocalInference={onShowLocalInference}
              onShowScheduledTasks={onShowScheduledTasks}
              onShowActivity={onShowActivity}
              onWorkModeChange={handleWorkModeChange}
              workMode={workMode}
              managedModelsOnly={managedModelsOnly}
              onPrefetchView={onPrefetchView}
            />
          </div>
          <div className="relative flex min-h-0 flex-1 flex-col">
            {activeView === 'coding' ? (
              <div className="flex min-h-0 flex-1 px-3">
                <CodingWorkspaceSidebar
                  selection={codingSelection}
                  onSelectionChange={onCodingSelectionChange}
                  onManageAgents={workspaceRoot =>
                    window.dispatchEvent(
                      new CustomEvent('coding:manage-agents', { detail: { workspaceRoot } }),
                    )
                  }
                />
              </div>
            ) : null}
            {activeView !== 'coding' && workMode !== WorkMode.Chat && renderSearchControl()}

            <div
              ref={agentScrollContainerRef}
              className={cn(
                'scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-3 pb-10',
                activeView === 'coding' && 'hidden',
              )}
              onScroll={handleAgentScroll}
            >
              <div className={cn(workMode === WorkMode.Chat && 'hidden')}>
                <MyAgentSidebarTree
                  isBatchMode={isBatchMode}
                  selectedIds={selectedIds}
                  recentlyDeletedSessionIds={recentlyDeletedSessionIds}
                  onShowCowork={onShowCowork}
                  onToggleSelection={handleToggleSelection}
                  onEnterBatchMode={handleEnterBatchMode}
                  onVisibleSessionsChange={
                    workMode === WorkMode.Work ? handleVisibleSessionsChange : undefined
                  }
                  onDismissSearch={() => {
                    setSearchActive(false);
                    setSearchQuery('');
                  }}
                  workMode={WorkMode.Work}
                  searchQuery={searchQuery}
                  searchCorpus={searchCorpus}
                />
              </div>
              {workMode === WorkMode.Chat && (
                <>
                  <div>
                    <ChatSkillShortcuts />
                  </div>
                  {renderSearchControl(true)}
                  <div className="sticky top-0 z-30 flex h-9 items-center bg-surface-raised px-1.5">
                    <h2 className="min-w-0 truncate text-[14px] font-normal text-foreground opacity-[0.28]">
                      {i18nService.t('chatRecentTitle')}
                    </h2>
                  </div>
                  {!chatSessionsLoaded ? (
                    <div className="flex items-center justify-center py-10 px-4 text-sm text-muted-foreground">
                      {i18nService.t('loading')}
                    </div>
                  ) : chatTaskNodes.length === 0 && !searchQuery.trim() ? (
                    <div className="flex flex-col items-center justify-center py-10 px-4">
                      <MessageCircle className="size-10 text-muted-foreground mb-3" />
                      <p className="text-sm font-medium text-muted-foreground mb-1">
                        {i18nService.t('chatNoSessions')}
                      </p>
                      <p className="text-xs text-muted-foreground text-center">
                        {i18nService.t('chatNoSessionsHint')}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {chatTaskNodes.map(task => (
                        <AgentTaskRow
                          key={task.id}
                          task={task}
                          isBatchMode={isBatchMode}
                          isSelected={isBatchMode ? selectedIds.has(task.id) : task.isSelected}
                          isNested={false}
                          showBatchOption
                          onSelect={() => {
                            const session =
                              searchSessionById.get(task.id) ??
                              sessions.find(s => s.id === task.id);
                            if (session) {
                              setSearchActive(false);
                              setSearchQuery('');
                              void handleSelectSession(session);
                            }
                          }}
                          onDelete={() => handleDeleteSession(task.id)}
                          onShare={async () => {
                            const session =
                              searchSessionById.get(task.id) ??
                              sessions.find(s => s.id === task.id);
                            if (session) {
                              setSearchActive(false);
                              setSearchQuery('');
                              await handleSelectSession(session);
                              window.setTimeout(() => {
                                window.dispatchEvent(
                                  new CustomEvent('cowork:open-share-options', {
                                    detail: { sessionId: task.id },
                                  }),
                                );
                              }, 0);
                            }
                          }}
                          onTogglePin={pinned => handleToggleSessionPin(task.id, pinned)}
                          onRename={title => handleRenameSession(task.id, title)}
                          onToggleSelection={() => handleToggleSelection(task.id)}
                          onEnterBatchMode={() => handleEnterBatchMode(task.id)}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            {activeView !== 'coding' ? (
              <>
                <div
                  className={cn(
                    'pointer-events-none absolute inset-x-0 z-10 h-24 bg-linear-to-b from-surface-raised to-transparent transition-opacity duration-150',
                    workMode === WorkMode.Chat ? 'top-0' : 'top-8',
                    agentScrollEdges.top ? 'opacity-100' : 'opacity-0',
                  )}
                />
                <div
                  className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 h-16 bg-linear-to-t from-surface-raised to-transparent transition-opacity duration-150 ${
                    agentScrollEdges.bottom ? 'opacity-100' : 'opacity-0'
                  }`}
                />
              </>
            ) : null}
          </div>
          {!isCollapsed && (
            <div
              className="non-draggable absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
              onMouseDown={handleResizeStart}
            />
          )}
          {isBatchMode && activeView !== 'coding' ? (
            <div className="px-3 pb-3 pt-1 flex items-center justify-between">
              <label className="flex items-center justify-start gap-2 cursor-pointer text-sm text-muted-foreground">
                <Checkbox
                  checked={
                    selectedIds.size === allVisibleSessionIdsRef.current.length &&
                    allVisibleSessionIdsRef.current.length > 0
                  }
                  onCheckedChange={handleSelectAll}
                  className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 accent-primary cursor-pointer"
                />
                {i18nService.t('batchSelectAll')}
              </label>
              <div className="flex items-center justify-start gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={handleBatchDeleteClick}
                  disabled={selectedIds.size === 0}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {selectedIds.size > 0 ? `${selectedIds.size}` : ''}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleExitBatchMode}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg text-muted-foreground hover:bg-surface-raised transition-colors"
                >
                  {i18nService.t('batchCancel')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-1 px-3 pb-3 pt-1">
              {updateEntry}
              {!hideLogin ? (
                <LoginButton
                  onShowSettings={() => {
                    onPrefetchView?.('settings');
                    onShowSettings();
                  }}
                />
              ) : null}
            </div>
          )}
          <DestructiveConfirmDialog
            open={showBatchDeleteConfirm}
            title={i18nService.t('batchDeleteConfirmTitle')}
            description={i18nService
              .t('batchDeleteConfirmMessage')
              .replace('{count}', String(selectedIds.size))}
            cancelLabel={i18nService.t('cancel')}
            confirmLabel={`${i18nService.t('batchDelete')} (${selectedIds.size})`}
            onCancel={() => setShowBatchDeleteConfirm(false)}
            onConfirm={handleBatchDelete}
          />
        </div>
      </aside>
    </MotionConfig>
  );
};

export default Sidebar;
