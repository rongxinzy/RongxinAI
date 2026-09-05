import { AgentId } from '@shared/agent';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import { coworkService } from '../../services/cowork';
import { DEFAULT_SHORTCUTS } from '../../config';
import { configService } from '../../services/config';
import { matchesShortcut } from '../../services/shortcuts';
import { formatShortcutLabel } from '../../services/shortcutLabel';
import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import { WorkMode } from '../../store/workMode/constants';
import { CoworkSessionStatusValue, type CoworkSessionSummary } from '../../types/cowork';
import { getAgentDisplayNameById } from '../../utils/agentDisplay';
import { TaskSearchDialog } from './TaskSearchDialog';

const SEARCH_SESSION_LIMIT = 100;
const SearchError = { Load: 'searchLoadError', Open: 'searchOpenError' } as const;
interface CoworkSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: CoworkSessionSummary[];
  currentSessionId: string | null;
  onSelectSession: (session: CoworkSessionSummary) => boolean | void | Promise<boolean | void>;
  workMode?: WorkMode;
  onNewChat?: () => void;
}

const CoworkSearchModal: React.FC<CoworkSearchModalProps> = ({
  isOpen,
  onClose,
  sessions,
  currentSessionId,
  onSelectSession,
  workMode = WorkMode.Work,
  onNewChat,
}) => {
  const agents = useSelector((state: RootState) => state.agent.agents);
  const workspaces = useSelector((state: RootState) => state.workspace.workspaces);
  const [query, setQuery] = useState('');
  const [searchSessions, setSearchSessions] = useState(sessions);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<(typeof SearchError)[keyof typeof SearchError] | null>(null);
  const [retry, setRetry] = useState(0);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const selecting = useRef(false);
  const dialogLifetime = useRef({ active: false });
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const isChat = workMode === WorkMode.Chat;
  const isMac = window.electron.platform === 'darwin';
  const newTaskShortcut = configService.getConfig().shortcuts?.newChat ?? DEFAULT_SHORTCUTS.newChat;

  useEffect(() => {
    const lifetime = { active: isOpen };
    dialogLifetime.current = lifetime;
    if (!isOpen) {
      setQuery('');
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSearchSessions(sessionsRef.current);
    void coworkService
      .listSessionsForSearch(SEARCH_SESSION_LIMIT, 0)
      .then(result => {
        if (cancelled) return;
        if (result?.success) setSearchSessions(result.sessions ?? []);
        else setError(SearchError.Load);
      })
      .catch(() => {
        if (!cancelled) setError(SearchError.Load);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      lifetime.active = false;
    };
  }, [isOpen, workMode, retry]);

  const { items, sessionById } = useMemo(() => {
    const names = new Map(
      workspaces
        .filter(workspace => !workspace.isHidden)
        .map(workspace => [workspace.id, workspace.name]),
    );
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const sessionById = new Map<string, CoworkSessionSummary>();
    const items = searchSessions
      .filter(session => (isChat ? session.mode === WorkMode.Chat : session.mode !== WorkMode.Chat))
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .flatMap(session => {
        const agentId = session.agentId?.trim() || AgentId.Main;
        const agentName = getAgentDisplayNameById(agentId, agents) ?? agentId;
        const context = names.get(session.workspaceId ?? '') ?? (isChat ? undefined : agentName);
        if (
          normalizedQuery &&
          ![session.title, agentName, context ?? ''].some(value =>
            value.toLocaleLowerCase().includes(normalizedQuery),
          )
        )
          return [];
        sessionById.set(session.id, session);
        return [
          {
            id: session.id,
            title: session.title,
            context,
            current: session.id === currentSessionId,
            running: session.status === CoworkSessionStatusValue.Running,
          },
        ];
      });
    return { items, sessionById };
  }, [searchSessions, agents, workspaces, query, isChat, currentSessionId]);

  const handleSelect = async (id: string) => {
    const session = sessionById.get(id);
    if (!session || selecting.current) return;
    selecting.current = true;
    setError(null);
    setSelectingId(id);
    const lifetime = dialogLifetime.current;
    try {
      const opened = await onSelectSession(session);
      if (opened === false) {
        if (lifetime.active) setError(SearchError.Open);
        return;
      }
      if (lifetime.active) onClose();
    } catch {
      if (lifetime.active) setError(SearchError.Open);
    } finally {
      selecting.current = false;
      setSelectingId(null);
    }
  };

  return (
    <TaskSearchDialog
      open={isOpen}
      query={query}
      items={items}
      loading={loading}
      error={error ? i18nService.t(error) : null}
      selectingId={selectingId}
      isMac={isMac}
      newTaskShortcut={{
        label: formatShortcutLabel(newTaskShortcut, isMac),
        matches: event => matchesShortcut(event, newTaskShortcut),
      }}
      labels={{
        title: i18nService.t(isChat ? 'searchChatConversations' : 'searchConversations'),
        description: i18nService.t(isChat ? 'searchRecentChats' : 'searchRecentTasks'),
        group: i18nService.t(isChat ? 'conversations' : 'searchRecentTasks'),
        empty: i18nService.t(isChat ? 'searchChatNoResults' : 'searchNoResults'),
        loading: i18nService.t('loading'),
        quickActions: i18nService.t('searchQuickActions'),
        newTask: i18nService.t(isChat ? 'newChat' : 'newTask'),
        retry: i18nService.t('searchRetry'),
      }}
      onQueryChange={setQuery}
      onClose={onClose}
      onSelect={id => void handleSelect(id)}
      onRetry={error === SearchError.Load ? () => setRetry(value => value + 1) : undefined}
      onNewChat={
        onNewChat
          ? () => {
              if (!selecting.current) {
                onClose();
                onNewChat();
              }
            }
          : undefined
      }
    />
  );
};

export default CoworkSearchModal;
