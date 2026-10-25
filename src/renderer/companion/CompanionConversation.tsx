import { Square } from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import { Conversation, ConversationContent } from '@shared/components/ai-elements/conversation';
import { Message, MessageContent, MessageResponse } from '@shared/components/ai-elements/message';
import { WorkbenchRunStatus } from '../../shared/workbenchTask';
import type { CompanionWindowState } from '../../shared/companion/types';
import { i18nService } from '../services/i18n';

interface Props {
  state: CompanionWindowState | null;
  taskMode: boolean;
  openTask(sessionId: string): void;
  stopTask(sessionId: string): void;
}

/** Durable conversation and task projection inside the companion's bubble. */
export function CompanionConversation({ state, taskMode, openTask, stopTask }: Props) {
  const t = (key: string) => i18nService.t(key);
  return (
    <Conversation className="flex min-h-0 flex-1 flex-col">
      <ConversationContent className="flex flex-col gap-4 px-4">
        {taskMode ? (
          state?.tasks.length ? (
            state.tasks.map(task => (
              <div key={task.receipt.taskId} className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  className="min-w-0 flex-1 justify-between gap-3"
                  disabled={task.missing}
                  onClick={() => openTask(task.receipt.sessionId)}
                >
                  <span className="min-w-0 truncate">
                    {task.title || t('companionTaskMissing')}
                  </span>
                  <span className="theme-home-caption shrink-0">
                    {t(
                      task.missing ? 'companionTaskMissing' : `companionTaskStatus_${task.status}`,
                    )}
                  </span>
                </Button>
                {!task.missing &&
                (
                  [
                    WorkbenchRunStatus.Queued,
                    WorkbenchRunStatus.Running,
                    WorkbenchRunStatus.WaitingApproval,
                    WorkbenchRunStatus.Verifying,
                  ] as readonly WorkbenchRunStatus[]
                ).includes(task.status) ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('companionTaskStop')}
                    onClick={() => stopTask(task.receipt.sessionId)}
                  >
                    <Square />
                  </Button>
                ) : null}
              </div>
            ))
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <p className="theme-home-caption">{t('companionTaskEmpty')}</p>
            </div>
          )
        ) : state?.conversation.messages.length ? (
          state.conversation.messages.map(message => (
            <Message key={`${message.id}-${message.role}`} from={message.role}>
              <MessageContent>
                <MessageResponse>{message.text}</MessageResponse>
              </MessageContent>
            </Message>
          ))
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <p className="theme-home-caption">{t('companionEmpty')}</p>
          </div>
        )}
        {state?.conversation.pending && !taskMode ? (
          <p role="status" className="theme-home-caption">
            {t('companionWorking')}
          </p>
        ) : null}
      </ConversationContent>
    </Conversation>
  );
}
