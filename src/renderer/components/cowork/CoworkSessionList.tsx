import { MessageCircle } from 'lucide-react';
import React, { useMemo } from 'react';
import { useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { selectUnreadSessionIds } from '../../store/selectors/coworkSelectors';
import type { CoworkSessionSummary } from '../../types/cowork';
import CoworkSessionItem from './CoworkSessionItem';

interface CoworkSessionListProps {
  sessions: CoworkSessionSummary[];
  isLoading?: boolean;
  currentSessionId: string | null;
  isBatchMode: boolean;
  selectedIds: Set<string>;
  showBatchOption?: boolean;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onTogglePin: (sessionId: string, pinned: boolean) => void;
  onRenameSession: (sessionId: string, title: string) => void;
  onToggleSelection: (sessionId: string) => void;
  onEnterBatchMode: (sessionId: string) => void;
  /** Optional override for empty-state label (defaults to coworkNoSessions i18n key) */
  emptyLabel?: string;
  /** Optional override for empty-state hint (defaults to coworkNoSessionsHint i18n key) */
  emptyHint?: string;
}

const CoworkSessionList: React.FC<CoworkSessionListProps> = ({
  sessions,
  isLoading = false,
  currentSessionId,
  isBatchMode,
  selectedIds,
  showBatchOption = true,
  onSelectSession,
  onDeleteSession,
  onTogglePin,
  onRenameSession,
  onToggleSelection,
  onEnterBatchMode,
  emptyLabel,
  emptyHint,
}) => {
  const unreadSessionIds = useSelector(selectUnreadSessionIds);
  const unreadSessionIdSet = useMemo(() => new Set(unreadSessionIds), [unreadSessionIds]);

  const sortedSessions = useMemo(() => {
    const sortByPinOrder = (a: CoworkSessionSummary, b: CoworkSessionSummary) => {
      const aPinOrder = a.pinOrder ?? a.updatedAt ?? a.createdAt;
      const bPinOrder = b.pinOrder ?? b.updatedAt ?? b.createdAt;
      if (aPinOrder !== bPinOrder) {
        return aPinOrder - bPinOrder;
      }
      return b.updatedAt - a.updatedAt;
    };
    const sortByRecentActivity = (a: CoworkSessionSummary, b: CoworkSessionSummary) => {
      if (b.updatedAt !== a.updatedAt) {
        return b.updatedAt - a.updatedAt;
      }
      return b.createdAt - a.createdAt;
    };

    const pinnedSessions = sessions
      .filter((session) => session.pinned)
      .sort(sortByPinOrder);
    const unpinnedSessions = sessions
      .filter((session) => !session.pinned)
      .sort(sortByRecentActivity);
    return [...pinnedSessions, ...unpinnedSessions];
  }, [sessions]);

  if (sessions.length === 0) {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center py-10">
          <svg className="animate-spin size-6 text-muted-foreground/60" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center py-10 px-4">
        <MessageCircle className="size-10 text-muted-foreground mb-3" />
        <p className="text-sm font-medium text-muted-foreground mb-1">
          {emptyLabel ?? i18nService.t('coworkNoSessions')}
        </p>
        <p className="text-xs text-muted-foreground text-center">
          {emptyHint ?? i18nService.t('coworkNoSessionsHint')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sortedSessions.map((session) => (
        <CoworkSessionItem
          key={session.id}
          session={session}
          hasUnread={unreadSessionIdSet.has(session.id)}
          isActive={session.id === currentSessionId}
          isBatchMode={isBatchMode}
          isSelected={selectedIds.has(session.id)}
          showBatchOption={showBatchOption}
          onSelect={() => onSelectSession(session.id)}
          onDelete={() => onDeleteSession(session.id)}
          onTogglePin={(pinned) => onTogglePin(session.id, pinned)}
          onRename={(title) => onRenameSession(session.id, title)}
          onToggleSelection={() => onToggleSelection(session.id)}
          onEnterBatchMode={() => onEnterBatchMode(session.id)}
        />
      ))}
    </div>
  );
};

export default CoworkSessionList;
