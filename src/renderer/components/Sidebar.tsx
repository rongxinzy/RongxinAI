import { AgentId } from '@shared/agent';
import { Button } from '@shared/components/ui/button';
import { Checkbox } from '@shared/components/ui/checkbox';
import { Switch } from '@shared/components/ui/switch';
import { cn } from '@shared/lib/utils';
import { Cpu, Settings, TriangleAlert } from 'lucide-react';
import { Clock, MessageCircle, PanelLeft, Pencil, Puzzle, Search, Trash2 } from 'lucide-react';
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
import { clearLoadingSessionId, setCurrentSession, setLoadingSessionId } from '../store/slices/coworkSlice';
import { WorkMode } from '../store/workMode/constants';
import { setWorkMode } from '../store/workMode/workModeSlice';
import type { CoworkSessionSummary } from '../types/cowork';
import { CoworkSessionStatusValue } from '../types/cowork';
import AgentTaskRow from './agentSidebar/AgentTaskRow';
import { toggleBatchSelection, toggleVisibleBatchSelection } from './agentSidebar/batchSelection';
import MyAgentSidebarTree from './agentSidebar/MyAgentSidebarTree';
import { sortAgentSidebarTasks, toAgentSidebarTaskNode } from './agentSidebar/useAgentSidebarState';
import Modal from './common/Modal';
import CoworkSearchModal from './cowork/CoworkSearchModal';
import LoginButton from './LoginButton';

interface SidebarProps {
  onShowSettings: () => void;
  onShowLogin?: () => void;
  activeView: 'cowork' | 'skills' | 'scheduledTasks' | 'mcp' | 'localInference' | 'expert';
  onShowSkills: () => void;
  onShowCowork: () => void;
  onShowScheduledTasks: () => void;
  onShowMcp: () => void;
  onShowLocalInference: () => void;
  onShowExpert: () => void;
  onNewChat: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  updateBadge?: React.ReactNode;
  hideLogin?: boolean;
}

const DEFAULT_SIDEBAR_WIDTH = 244;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 420;
const SIDEBAR_COLLAPSE_TRANSITION_MS = 200;
const sidebarNavItemClassName =
  'w-full inline-flex h-7 items-center justify-start gap-2 rounded-md px-1.5 text-left text-[14px] font-normal text-muted-foreground transition-colors hover:bg-black/3 dark:hover:bg-white/4';
const activeSidebarNavItemClassName = `${sidebarNavItemClassName} bg-black/3 dark:bg-white/4`;
const sidebarCreateIconClassName = 'h-4 w-4 shrink-0';

const Sidebar: React.FC<SidebarProps> = ({
  onShowSettings,
  activeView,
  onShowCowork,
  onShowScheduledTasks,
  onShowLocalInference,
  onShowExpert,
  onNewChat,
  isCollapsed,
  onToggleCollapse,
  updateBadge,
  hideLogin,
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
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [recentlyDeletedSessionIds, setRecentlyDeletedSessionIds] = useState<string[]>([]);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [agentScrollEdges, setAgentScrollEdges] = useState({ top: false, bottom: false });
  const handleWorkModeChange = useCallback((checked: boolean) => {
    const mode = checked ? WorkMode.Chat : WorkMode.Work;
    dispatch(setWorkMode(mode));
    setIsBatchMode(false);
    setSelectedIds(new Set());
    setShowBatchDeleteConfirm(false);
    void configService.updateConfig({ workMode: mode });
  }, [dispatch]);

  // Filter sessions by workMode — chat sessions only visible in chat mode
  const sessions = React.useMemo(
    () =>
      workMode === WorkMode.Chat
        ? chatSessions
        : allSessions.filter(s => s.mode !== WorkMode.Chat),
    [allSessions, chatSessions, workMode],
  );

  // Chat mode: map sessions to AgentSidebarTaskNode for AgentTaskRow rendering
  const unreadSessionIdSet = React.useMemo(() => new Set(unreadSessionIds), [unreadSessionIds]);
  const chatTaskNodes = React.useMemo(() => {
    if (workMode !== WorkMode.Chat) return [];
    const sorted = sortAgentSidebarTasks(sessions, streamingSessionIds);
    return sorted.map(s => toAgentSidebarTaskNode(s, currentSessionId, unreadSessionIdSet));
  }, [workMode, sessions, currentSessionId, unreadSessionIdSet, streamingSessionIds]);

  const isResizingRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(DEFAULT_SIDEBAR_WIDTH);
  const agentScrollContainerRef = useRef<HTMLDivElement>(null);
  // 保存侧边栏树中所有可见 session ID（跨所有 Agent 聚合），
  // 供批量模式"全选"使用，避免因 Redux sessions 被限定到单个 Agent 而导致全选范围错误
  const allVisibleSessionIdsRef = useRef<string[]>([]);
  const isMac = window.electron.platform === 'darwin';

  useEffect(() => {
    const handleSearch = () => {
      onShowCowork();
      setIsSearchOpen(true);
    };
    window.addEventListener('cowork:shortcut:search', handleSearch);
    return () => {
      window.removeEventListener('cowork:shortcut:search', handleSearch);
    };
  }, [onShowCowork]);

  useEffect(() => {
    if (!isCollapsed) return;
    setIsSearchOpen(false);
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
        setSidebarWidth(Math.min(MAX_SIDEBAR_WIDTH, nextWidth));
      };

      const handleMouseUp = () => {
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

  return (
    <aside
      className={`relative shrink-0 overflow-hidden bg-surface-raised ${
        isResizing ? '' : 'sidebar-transition'
      }`}
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
        <div className="pt-3 pb-3">
          <div className="draggable sidebar-header-drag h-8 flex items-center justify-between px-3">
            <div className={`flex items-center gap-2 ${isMac ? 'pl-[68px]' : ''}`}>
              <img src="zhiyuan-logo-light.svg" alt="知远" className="logo-light h-5 w-auto select-none" />
              <img src="zhiyuan-logo-dark.svg" alt="知远" className="logo-dark h-5 w-auto select-none" />
              {updateBadge}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onToggleCollapse}
              className="non-draggable h-8 w-8 rounded-lg text-muted-foreground hover:bg-surface-raised transition-colors"
              aria-label={isCollapsed ? i18nService.t('expand') : i18nService.t('collapse')}
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-[5px] space-y-0.5 px-3 pb-3">
            <div
              className="relative h-7 w-full cursor-pointer"
              onClick={() => handleWorkModeChange(workMode !== WorkMode.Chat)}
            >
              <Switch
                checked={workMode === WorkMode.Chat}
                onCheckedChange={handleWorkModeChange}
                data-mode="work-chat"
              />
              <span
                className={cn(
                  'absolute top-1/2 flex items-center gap-1 pointer-events-none transition-all duration-200',
                  workMode === WorkMode.Work
                    ? 'font-semibold text-foreground'
                    : 'font-normal text-muted-foreground opacity-50',
                )}
                style={{ left: '25%', transform: 'translate(-50%, -50%)' }}
              >
                <span className="text-sm">{i18nService.t('workMode')}</span>
              </span>
              <span
                className={cn(
                  'absolute top-1/2 flex items-center gap-1 pointer-events-none transition-all duration-200',
                  workMode === WorkMode.Chat
                    ? 'font-semibold text-foreground'
                    : 'font-normal text-muted-foreground opacity-50',
                )}
                style={{ left: '75%', transform: 'translate(-50%, -50%)' }}
              >
                <span className="text-sm">{i18nService.t('chatMode')}</span>
              </span>
            </div>
            <div className="mt-2!">
              <Button
                type="button"
                variant="ghost"
                onClick={onNewChat}
                className={sidebarNavItemClassName}
              >
                <Pencil className={sidebarCreateIconClassName} />
                {workMode === WorkMode.Chat ? i18nService.t('newChat') : '新建任务'}
              </Button>
            </div>
            {workMode !== WorkMode.Chat && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setIsSearchOpen(false);
                  onShowLocalInference();
                }}
                className={
                  activeView === 'localInference'
                    ? activeSidebarNavItemClassName
                    : sidebarNavItemClassName
                }
                aria-current={activeView === 'localInference' ? 'page' : undefined}
              >
                <Cpu className="h-4 w-4 shrink-0" />
                {i18nService.t('localInferenceTitle')}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                onShowCowork();
                setIsSearchOpen(true);
              }}
              className={sidebarNavItemClassName}
            >
              <Search className="h-4 w-4 shrink-0" />
              {i18nService.t(workMode === WorkMode.Chat ? 'searchChats' : 'search')}
            </Button>
            {workMode !== WorkMode.Chat && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setIsSearchOpen(false);
                  onShowScheduledTasks();
                }}
                className={
                  activeView === 'scheduledTasks'
                    ? activeSidebarNavItemClassName
                    : sidebarNavItemClassName
                }
                aria-current={activeView === 'scheduledTasks' ? 'page' : undefined}
              >
                <Clock className="h-4 w-4 shrink-0" />
                {i18nService.t('scheduledTasks')}
              </Button>
            )}
            {workMode !== WorkMode.Chat && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setIsSearchOpen(false);
                    onShowExpert();
                  }}
                  className={
                    activeView === 'expert'
                      ? activeSidebarNavItemClassName
                      : sidebarNavItemClassName
                  }
                  aria-current={activeView === 'expert' ? 'page' : undefined}
                >
                  <Puzzle className="h-4 w-4 shrink-0" />
                  {i18nService.t('expert')}
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
          <div
            ref={agentScrollContainerRef}
            className="scrollbar-hidden h-full overflow-y-auto px-3 pb-10"
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
                workMode={WorkMode.Work}
              />
            </div>
            {workMode === WorkMode.Chat && (
              <>
                <div className="sticky top-0 z-30 flex h-10 items-center bg-surface-raised px-1.5">
                  <h2 className="min-w-0 truncate text-[14px] font-normal text-foreground opacity-[0.28]">
                    {i18nService.t('chatRecentTitle')}
                  </h2>
                </div>
                {!chatSessionsLoaded ? (
                  <div className="flex items-center justify-center py-10 px-4 text-sm text-muted-foreground">
                    {i18nService.t('loading')}
                  </div>
                ) : chatTaskNodes.length === 0 ? (
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
                        onSelect={() => {
                          const session = sessions.find(s => s.id === task.id);
                          if (session) void handleSelectSession(session);
                        }}
                        onDelete={() => handleDeleteSession(task.id)}
                        onShare={async () => {
                          const session = sessions.find(s => s.id === task.id);
                          if (session) {
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
          <div
            className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-linear-to-b from-surface-raised to-transparent transition-opacity duration-150 ${
              agentScrollEdges.top ? 'opacity-100' : 'opacity-0'
            }`}
          />
          <div
            className={`pointer-events-none absolute inset-x-0 top-[68px] z-10 h-10 bg-linear-to-b from-surface-raised to-transparent transition-opacity duration-150 ${
              agentScrollEdges.top ? 'opacity-100' : 'opacity-0'
            }`}
          />
          <div
            className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 h-16 bg-linear-to-t from-surface-raised to-transparent transition-opacity duration-150 ${
              agentScrollEdges.bottom ? 'opacity-100' : 'opacity-0'
            }`}
          />
        </div>
        {!isCollapsed && (
          <div
            className="non-draggable absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
            onMouseDown={handleResizeStart}
          />
        )}
        <CoworkSearchModal
          isOpen={isSearchOpen}
          onClose={() => setIsSearchOpen(false)}
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSelectSession={handleSelectSession}
          workMode={workMode}
        />
        {isBatchMode ? (
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
            <div className="flex items-center gap-1">
              {!hideLogin && (
                <div className="flex-1 min-w-0">
                  <LoginButton />
                </div>
              )}
              <Button
                type="button"
                variant="ghost"
                onClick={() => onShowSettings()}
                className={`inline-flex h-7 items-center justify-start! gap-2 rounded-md px-1.5 text-[14px] font-normal text-muted-foreground transition-colors hover:bg-black/3 dark:hover:bg-white/4 ${hideLogin ? 'w-full' : 'shrink-0'}`}
                aria-label={i18nService.t('settings')}
              >
                <Settings className="h-4 w-4 shrink-0" />
                {i18nService.t('settings')}
              </Button>
            </div>
          </div>
        )}
        {/* Batch Delete Confirmation Modal */}
        {showBatchDeleteConfirm && (
          <Modal
            onClose={() => setShowBatchDeleteConfirm(false)}
            className="w-full max-w-sm mx-4 bg-surface rounded-2xl shadow-xl overflow-hidden"
          >
            <div className="flex items-center gap-3 px-5 py-4">
              <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/30">
                <TriangleAlert className="h-5 w-5 text-red-600 dark:text-red-500" />
              </div>
              <h2 className="text-base font-semibold text-foreground">
                {i18nService.t('batchDeleteConfirmTitle')}
              </h2>
            </div>
            <div className="px-5 pb-4">
              <p className="text-sm text-muted-foreground">
                {i18nService
                  .t('batchDeleteConfirmMessage')
                  .replace('{count}', String(selectedIds.size))}
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowBatchDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium rounded-lg text-muted-foreground hover:bg-surface-raised transition-colors"
              >
                {i18nService.t('cancel')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleBatchDelete}
                className="px-4 py-2 text-sm font-medium rounded-lg transition-colors"
              >
                {i18nService.t('batchDelete')} ({selectedIds.size})
              </Button>
            </div>
          </Modal>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;
