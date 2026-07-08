import { AgentId } from '@shared/agent';
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@shared/components/ui/command';
import { Spinner } from '@shared/components/ui/spinner';
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
  workMode?: 'work' | 'chat';
}

const CoworkSearchModal: React.FC<CoworkSearchModalProps> = ({
  isOpen, onClose, sessions, currentSessionId: _currentSessionId, onSelectSession, workMode = 'work',
}) => {
  const agents = useSelector((state: RootState) => state.agent.agents);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSessions, setSearchSessions] = useState<CoworkSessionSummary[]>(sessions);
  const [isLoading, setIsLoading] = useState(false);

  const modeFilteredSessions = useMemo(() => {
    return searchSessions.filter(s =>
      workMode === 'chat' ? s.mode === 'chat' : s.mode !== 'chat'
    );
  }, [searchSessions, workMode]);

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
    if (!trimmedQuery) return modeFilteredSessions;
    return modeFilteredSessions.filter((session) => {
      const agentName = agentNameBySessionId.get(session.id) ?? '';
      return session.title.toLowerCase().includes(trimmedQuery) || agentName.toLowerCase().includes(trimmedQuery);
    });
  }, [agentNameBySessionId, searchQuery, modeFilteredSessions]);

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
    <CommandDialog
      open={isOpen}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={i18nService.t('searchConversations')}
      description={i18nService.t('searchRecentTasks')}
      className="ring-0"
    >
      <Command shouldFilter={false}>
        <CommandInput
          value={searchQuery}
          onValueChange={setSearchQuery}
          placeholder={i18nService.t('searchConversations')}
        />
        <CommandList>
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Spinner />
            </div>
          ) : filteredSessions.length === 0 ? (
            <CommandEmpty>{i18nService.t('searchNoResults')}</CommandEmpty>
          ) : (
            <CommandGroup heading={i18nService.t('searchRecentTasks')}>
              {filteredSessions.map((session) => {
                const isRunning = session.status === CoworkSessionStatusValue.Running;
                const agentName = agentNameBySessionId.get(session.id) ?? getSessionAgentId(session);
                return (
                  <CommandItem
                    key={session.id}
                    value={session.title}
                    onSelect={() => void handleSelectSession(session)}
                  >
                    {isRunning && <Spinner />}
                    <span className="flex-1 truncate">{session.title}</span>
                    <span className="text-xs text-muted-foreground">{agentName}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
};

export default CoworkSearchModal;
