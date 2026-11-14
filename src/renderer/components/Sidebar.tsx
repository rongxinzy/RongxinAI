import { AgentId } from '@shared/agent';
import { cn } from '@shared/lib/utils';
import { MotionConfig } from 'motion/react';
import { MessageCircle, PanelLeftClose } from 'lucide-react';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@shared/components/ui/empty';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';

import { getBranding } from '../../shared/branding';
import { agentService } from '../services/agent';
import { configService } from '../services/config';
import { coworkService } from '../services/cowork';
import { requestScheduledTaskCreate } from './scheduledTasks/createRequest';
import type { WorkspaceSidebarNode } from './agentSidebar/types';
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
import ChatSessionList from './ChatSessionList';
import ChatSkillShortcuts from './chat/ChatSkillShortcuts';
import {
  CodingWorkspaceSidebar,
  type CodingSidebarSelection,
} from './coding/CodingWorkspaceSidebar';
import { SidebarSearchTrigger } from './shell/SidebarSearchTrigger';
import { SidebarFooter } from './shell/SidebarFooter';
import { useSidebarFrame } from './shell/useSidebarFrame';
import CoworkSearchModal from './cowork/CoworkSearchModal';
import { workspaceService } from '../services/workspace';
import { ShellIconButton } from './shell/ShellIconButton';
import { toggleBatchSelection, toggleVisibleBatchSelection } from './agentSidebar/batchSelection';
import MyAgentSidebarTree from './agentSidebar/MyAgentSidebarTree';
import { sortAgentSidebarTasks } from './agentSidebar/sessionSort';
import { toAgentSidebarTaskNode } from './agentSidebar/useAgentSidebarState';
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
  inferenceEdition?: import('../../shared/inferenceEdition').InferenceEdition;
  /** Warms the lazily loaded chunk for a view on hover/focus intent. */
  onPrefetchView?: (view: PrefetchableFeatureView) => void;
}

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
  inferenceEdition,
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
  const [searchActive, setSearchActive] = useState(false);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [recentlyDeletedSessionIds, setRecentlyDeletedSessionIds] = useState<string[]>([]);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const {
    sidebarWidth,
    isResizing,
    agentScrollEdges,
    agentScrollContainerRef,
    handleResizeStart,
    handleAgentScroll,
  } = useSidebarFrame(isCollapsed, onToggleCollapse);
  const handleWorkModeChange = useCallback(
    (checked: boolean) => {
      const mode = checked ? WorkMode.Chat : WorkMode.Work;
      dispatch(setWorkMode(mode));
      if (mode === WorkMode.Chat) {
        onShowCowork();
      }
      setIsBatchMode(false);
      setSelectedIds(previous => (previous.size === 0 ? previous : new Set()));
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
  const chatTaskNodes = React.useMemo(() => {
    if (workMode !== WorkMode.Chat) return [];
    const streamingSessionIdSet = new Set(streamingSessionIds);
    const sorted = sortAgentSidebarTasks(sessions);
    return sorted.map(s =>
      toAgentSidebarTaskNode(s, currentSessionId, unreadSessionIdSet, streamingSessionIdSet),
    );
  }, [workMode, sessions, currentSessionId, unreadSessionIdSet, streamingSessionIds]);

  // 保存侧边栏树中所有可见 session ID（跨所有 Agent 聚合），
  // 供批量模式"全选"使用，避免因 Redux sessions 被限定到单个 Agent 而导致全选范围错误
  const workVisibleSessionIdsRef = useRef<string[]>([]);
  const chatVisibleSessionIds = React.useMemo(
    () => chatTaskNodes.map(task => task.id),
    [chatTaskNodes],
  );
  const visibleSessionIds =
    workMode === WorkMode.Chat ? chatVisibleSessionIds : workVisibleSessionIdsRef.current;
  const isMac = window.electron.platform === 'darwin';

  useEffect(() => {
    const handleSearch = () => {
      setSearchActive(true);
    };
    window.addEventListener('cowork:shortcut:search', handleSearch);
    return () => {
      window.removeEventListener('cowork:shortcut:search', handleSearch);
    };
  }, []);

  useEffect(() => {
    if (!isCollapsed) return;
    setSearchActive(false);
    setIsBatchMode(false);
    setSelectedIds(new Set());
    setShowBatchDeleteConfirm(false);
  }, [isCollapsed]);

  const handleSelectSession = useCallback(
    async (session: CoworkSessionSummary) => {
      const agentId = session.agentId?.trim() || AgentId.Main;
      flushSync(() => {
        dispatch(setLoadingSessionId(session.id));
      });

      // If the target session is actively streaming in the background, restore its
      // event-derived live snapshot immediately so the user sees the active stream
      // without waiting for the DB round-trip.
      const streamingSnapshot = store.getState().cowork.streamingSessions[session.id];
      if (streamingSnapshot) {
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
        const loadedSession = await coworkService.loadSession(session.id);
        return loadedSession !== null;
      } finally {
        dispatch(clearLoadingSessionId(session.id));
      }
    },
    [currentAgentId, dispatch, onShowCowork],
  );

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

  const handleToggleSelection = useCallback((sessionId: string) => {
    setSelectedIds(prev => toggleBatchSelection(prev, sessionId));
  }, []);

  const handleVisibleSessionsChange = useCallback((ids: string[]) => {
    // The work tree stays mounted in chat mode. Its asynchronous preview loads
    // must update only the work selection scope, never the chat scope.
    workVisibleSessionIdsRef.current = ids;
  }, []);

  const handleDismissSearch = useCallback(() => {
    setSearchActive(false);
  }, []);

  const handleCreateScheduledTask = useCallback(
    (workspace: WorkspaceSidebarNode) => {
      requestScheduledTaskCreate({ workspaceId: workspace.id });
      onShowScheduledTasks();
    },
    [onShowScheduledTasks],
  );

  const handleSelectAll = useCallback(() => {
    const allIds =
      workMode === WorkMode.Chat ? chatVisibleSessionIds : workVisibleSessionIdsRef.current;
    setSelectedIds(prev => toggleVisibleBatchSelection(prev, allIds));
  }, [chatVisibleSessionIds, workMode]);

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

  const renderSearchControl = (isChatMode = false) => (
    <div className={cn('shrink-0', !isChatMode && 'px-2')}>
      <SidebarSearchTrigger
        label={i18nService.t(workMode === WorkMode.Chat ? 'searchChats' : 'search')}
        onClick={() => setSearchActive(true)}
      />
    </div>
  );

  return (
    <MotionConfig reducedMotion="user">
      <aside
        className="theme-shell-sidebar relative shrink-0 overflow-hidden"
        data-active-view={activeView}
        style={{ width: isCollapsed ? 0 : sidebarWidth }}
      >
        <div
          inert={isCollapsed}
          className={`flex h-full flex-col transition-opacity ease-out ${
            isCollapsed ? 'pointer-events-none opacity-0' : 'opacity-100'
          }`}
          style={{
            width: sidebarWidth,
            transitionDuration: `${SIDEBAR_COLLAPSE_TRANSITION_MS}ms`,
          }}
        >
          <div className="shrink-0">
            <div className="theme-sidebar-header draggable sidebar-header-drag flex items-center justify-between">
              <div
                className={cn('theme-shell-brand flex items-center gap-2', isMac && 'pl-[68px]')}
              >
                <img
                  src={`${getBranding().appId}-logo-light.svg`}
                  alt={getBranding().shortName}
                  className="theme-shell-brand-mark logo-light w-auto select-none"
                />
                <img
                  src={`${getBranding().appId}-logo-dark.svg`}
                  alt={getBranding().shortName}
                  className="theme-shell-brand-mark logo-dark w-auto select-none"
                />
              </div>
              <ShellIconButton
                onClick={onToggleCollapse}
                label={i18nService.t(isCollapsed ? 'expand' : 'collapse')}
              >
                <PanelLeftClose />
              </ShellIconButton>
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
              onSearch={workMode === WorkMode.Work ? () => setSearchActive(true) : undefined}
              searchLabel={i18nService.t(workMode === WorkMode.Chat ? 'searchChats' : 'search')}
              managedModelsOnly={managedModelsOnly}
              inferenceEdition={inferenceEdition}
              onPrefetchView={onPrefetchView}
            />
          </div>
          <div className="relative flex min-h-0 flex-1 flex-col">
            {activeView === 'coding' ? (
              <div className="flex min-h-0 flex-1 px-2">
                <CodingWorkspaceSidebar
                  selection={codingSelection}
                  onSelectionChange={onCodingSelectionChange}
                />
              </div>
            ) : null}

            <div
              ref={agentScrollContainerRef}
              className={cn(
                'theme-sidebar-scroll scrollbar-hidden min-h-0 flex-1 overflow-y-auto',
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
                  onVisibleSessionsChange={handleVisibleSessionsChange}
                  onDismissSearch={handleDismissSearch}
                  onCreateScheduledTask={handleCreateScheduledTask}
                  workMode={WorkMode.Work}
                />
              </div>
              {workMode === WorkMode.Chat && (
                <>
                  <div>
                    <ChatSkillShortcuts />
                  </div>
                  {renderSearchControl(true)}
                  <div className="theme-sidebar-section sticky top-0 z-30 flex items-center min-w-0">
                    <h2 className="min-w-0 truncate">{i18nService.t('chatRecentTitle')}</h2>
                  </div>
                  {!chatSessionsLoaded ? (
                    <div className="flex items-center justify-center py-10 px-4 text-sm text-muted-foreground">
                      {i18nService.t('loading')}
                    </div>
                  ) : chatTaskNodes.length === 0 ? (
                    <Empty className="gap-2 py-8 px-4">
                      <EmptyHeader className="gap-1">
                        <EmptyMedia variant="icon" className="mb-1">
                          <MessageCircle
                            className="size-8 text-muted-foreground"
                            aria-hidden="true"
                          />
                        </EmptyMedia>
                        <EmptyTitle className="text-sm font-medium">
                          {i18nService.t('chatNoSessions')}
                        </EmptyTitle>
                        <EmptyDescription className="text-xs">
                          {i18nService.t('chatNoSessionsHint')}
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : (
                    <ChatSessionList
                      tasks={chatTaskNodes}
                      sessions={sessions}
                      isBatchMode={isBatchMode}
                      selectedIds={selectedIds}
                      onSelectSession={handleSelectSession}
                      onDeleteSession={handleDeleteSession}
                      onToggleSessionPin={handleToggleSessionPin}
                      onRenameSession={handleRenameSession}
                      onToggleSelection={handleToggleSelection}
                      onEnterBatchMode={handleEnterBatchMode}
                      onDismissSearch={handleDismissSearch}
                    />
                  )}
                </>
              )}
            </div>
            {activeView !== 'coding' ? (
              <>
                <div
                  className={cn(
                    'theme-sidebar-fade theme-sidebar-fade-top pointer-events-none absolute inset-x-0 z-10',
                    workMode === WorkMode.Chat ? 'top-0' : 'top-8',
                    agentScrollEdges.top ? 'opacity-100' : 'opacity-0',
                  )}
                />
                <div
                  className={`theme-sidebar-fade theme-sidebar-fade-bottom pointer-events-none absolute inset-x-0 bottom-0 z-10 ${
                    agentScrollEdges.bottom ? 'opacity-100' : 'opacity-0'
                  }`}
                />
              </>
            ) : null}
          </div>
          {!isCollapsed && (
            <div
              className="theme-sidebar-resize non-draggable absolute top-0 right-0 h-full w-1 cursor-col-resize"
              data-resizing={isResizing || undefined}
              onMouseDown={handleResizeStart}
            />
          )}
          <SidebarFooter
            activeView={activeView}
            workMode={workMode}
            isBatchMode={isBatchMode}
            selectedIds={selectedIds}
            visibleSessionIds={visibleSessionIds}
            showBatchDeleteConfirm={showBatchDeleteConfirm}
            onSelectAll={handleSelectAll}
            onBatchDeleteClick={handleBatchDeleteClick}
            onBatchDelete={handleBatchDelete}
            onExitBatchMode={handleExitBatchMode}
            onCancelBatchDelete={() => setShowBatchDeleteConfirm(false)}
            updateEntry={updateEntry}
            hideLogin={hideLogin}
            onShowSettings={onShowSettings}
            onPrefetchView={onPrefetchView}
          />
        </div>
      </aside>
      <CoworkSearchModal
        isOpen={searchActive}
        onClose={() => setSearchActive(false)}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelectSession={handleSelectSession}
        workMode={workMode}
        onNewChat={() => {
          if (workMode === WorkMode.Work) void workspaceService.clearWorkspaceSelection();
          onNewChat();
        }}
      />
    </MotionConfig>
  );
};

export default Sidebar;
