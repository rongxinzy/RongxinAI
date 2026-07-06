import { AgentId } from '@shared/agent';
import { Command, CommandInput, CommandItem, CommandList } from '@shared/components/ui/command';
import { Dialog, DialogContent } from '@shared/components/ui/dialog';
import React, { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { RootState } from '../../store';
import { CoworkSessionStatusValue, type CoworkSessionSummary } from '../../types/cowork';
import { getAgentDisplayNameById } from '../../utils/agentDisplay';

const SEARCH_SESSION_LIMIT = 100;

const getSessionAgentId = (session: CoworkSessionSummary) => {
  return session.agentId?.trim() || AgentId.Main;
};

interface CoworkSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: CoworkSessionSummary[];
  currentSessionId: string | null;
  onSelectSession: (session: CoworkSessionSummary) => void | Promise<void>;
}

const CoworkSearchModal: React.FC<CoworkSearchModalProps> = ({
  isOpen, onClose, sessions, currentSessionId, onSelectSession,
}) => {
  const agents = useSelector((state: RootState) => state.agent.agents);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSessions, setSearchSessions] = useState<CoworkSessionSummary[]>(sessions);
  const [isLoading, setIsLoading] = useState(false);

  const agentNameBySessionId = useMemo(() => {
    const names = new Map<string, string>();
    searchSessions.forEach((session) => {
      const agentId = getSessionAgentId(session);
      names.set(session.id, getAgentDisplayNameById(agentId, agents) ?? agentId);
    });
    return names;
  }, [agents, searchSessions]);

  const filteredSessions = useMemo(() => {
    const trimmedQuery = searchQuery.trim().toLowerCase();
    if (!trimmedQuery) return searchSessions;
    return searchSessions.filter((session) => {
      const agentName = agentNameBySessionId.get(session.id) ?? '';
      return session.title.toLowerCase().includes(trimmedQuery) || agentName.toLowerCase().includes(trimmedQuery);
    });
  }, [agentNameBySessionId, searchQuery, searchSessions]);

  useEffect(() => { if (!isOpen) setSearchQuery(''); }, [isOpen]);
  useEffect(() => { if (!isOpen) setSearchSessions(sessions); }, [isOpen, sessions]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsLoading(true);
    void coworkService.listSessionsForSearch(SEARCH_SESSION_LIMIT, 0)
      .then((result) => {
        if (cancelled || !result.success || !result.sessions) return;
        setSearchSessions(result.sessions);
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen]);

  const handleSelectSession = async (session: CoworkSessionSummary) => {
    await onSelectSession(session);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[520px] p-0" showCloseButton={false}>
        <Command shouldFilter={false}>
          <CommandInput
            value={searchQuery}
            onValueChange={setSearchQuery}
            placeholder={i18nService.t('searchConversations')}
            className="h-12 text-[13px] border-0"
          />
          <CommandList className="max-h-[320px] px-2 pb-2">
            <div className="px-2 pb-1 text-[12px] text-secondary pt-1">
              {i18nService.t('searchRecentTasks')}
            </div>
            {filteredSessions.length === 0 ? (
              <div className="py-10 text-center text-sm text-secondary">
                {isLoading ? i18nService.t('loading') : i18nService.t('searchNoResults')}
              </div>
            ) : (
              filteredSessions.map((session) => {
                const isSelected = session.id === currentSessionId;
                const isRunning = session.status === CoworkSessionStatusValue.Running;
                const agentName = agentNameBySessionId.get(session.id) ?? getSessionAgentId(session);
                return (
                  <CommandItem
                    key={session.id}
                    value={session.title}
                    onSelect={() => void handleSelectSession(session)}
                    className={`group flex h-8 gap-2 text-[13px] ${isSelected ? 'bg-accent' : ''}`}
                  >
                    {isRunning && (
                      <svg className="h-3 w-3 animate-spin text-primary shrink-0" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                      </svg>
                    )}
                    <span className="min-w-0 flex-1 truncate font-medium">{session.title}</span>
                    <span className="max-w-[136px] shrink-0 truncate text-[12px] text-secondary/75">{agentName}</span>
                  </CommandItem>
                );
              })
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
};

export default CoworkSearchModal;
