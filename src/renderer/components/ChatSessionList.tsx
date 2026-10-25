import { memo, useSyncExternalStore } from 'react';

import { i18nService } from '../services/i18n';
import type { CoworkSessionSummary } from '../types/cowork';
import AgentTaskRow from './agentSidebar/AgentTaskRow';
import type { AgentSidebarTaskNode } from './agentSidebar/types';

const subscribeLanguage = (listener: () => void) => i18nService.subscribe(listener);
const getLanguage = () => i18nService.getLanguage();

interface ChatSessionListProps {
  tasks: AgentSidebarTaskNode[];
  sessions: CoworkSessionSummary[];
  isBatchMode: boolean;
  selectedIds: ReadonlySet<string>;
  onSelectSession: (session: CoworkSessionSummary) => Promise<boolean>;
  onDeleteSession: (sessionId: string) => Promise<void>;
  onToggleSessionPin: (sessionId: string, pinned: boolean) => Promise<void>;
  onRenameSession: (sessionId: string, title: string) => Promise<void>;
  onToggleSelection: (sessionId: string) => void;
  onEnterBatchMode: (sessionId: string) => void;
  onDismissSearch: () => void;
}

const ChatSessionList = memo(function ChatSessionList({
  tasks,
  sessions,
  isBatchMode,
  selectedIds,
  onSelectSession,
  onDeleteSession,
  onToggleSessionPin,
  onRenameSession,
  onToggleSelection,
  onEnterBatchMode,
  onDismissSearch,
}: ChatSessionListProps) {
  useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
  return (
    <div className="space-y-0.5">
      {tasks.map(task => (
        <AgentTaskRow
          key={task.id}
          task={task}
          isBatchMode={isBatchMode}
          isSelected={isBatchMode ? selectedIds.has(task.id) : task.isSelected}
          isNested={false}
          showBatchOption
          onSelect={() => {
            const session = sessions.find(item => item.id === task.id);
            if (session) {
              onDismissSearch();
              void onSelectSession(session);
            }
          }}
          onDelete={() => onDeleteSession(task.id)}
          onShare={async () => {
            const session = sessions.find(item => item.id === task.id);
            if (session) {
              onDismissSearch();
              await onSelectSession(session);
              window.setTimeout(() => {
                window.dispatchEvent(
                  new CustomEvent('cowork:open-share-options', {
                    detail: { sessionId: task.id },
                  }),
                );
              }, 0);
            }
          }}
          onTogglePin={pinned => onToggleSessionPin(task.id, pinned)}
          onRename={title => onRenameSession(task.id, title)}
          onToggleSelection={() => onToggleSelection(task.id)}
          onEnterBatchMode={() => onEnterBatchMode(task.id)}
        />
      ))}
    </div>
  );
});

export default ChatSessionList;
