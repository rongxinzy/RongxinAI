import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Badge } from '@shared/components/ui/badge';
import { cn } from '@shared/lib/utils';
import { Check, Compass, ListTodo, Pencil, RotateCcw, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import {
  CoworkQueueDelivery,
  CoworkQueueItemStatus,
  type CoworkPendingMessage,
} from '../../../shared/cowork/pendingMessageQueue';
import { showAppError } from '../../services/appToast';
import { coworkQueueService } from '../../services/coworkQueue';
import { i18nService } from '../../services/i18n';

export interface PendingMessageQueueActions {
  update(
    sessionId: string,
    itemId: string,
    text: string,
  ): Promise<{ success: boolean; error?: string }>;
  remove(sessionId: string, itemId: string): Promise<{ success: boolean; error?: string }>;
  steer(sessionId: string, itemId: string): Promise<{ success: boolean; error?: string }>;
  followUp(sessionId: string, itemId: string): Promise<{ success: boolean; error?: string }>;
}

interface PendingMessageQueueProps {
  sessionId: string;
  isStreaming: boolean;
  queueService?: Pick<typeof coworkQueueService, 'subscribe' | 'load'>;
  queueActions?: PendingMessageQueueActions;
}

const QUEUE_LOG_TAG = 'Queue';

const PendingMessageQueue = ({
  sessionId,
  isStreaming,
  queueService = coworkQueueService,
  queueActions,
}: PendingMessageQueueProps) => {
  const [items, setItems] = useState<CoworkPendingMessage[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    const unsubscribe = queueService.subscribe(sessionId, nextItems => {
      if (!disposed) setItems(nextItems);
    });
    void queueService
      .load(sessionId)
      .catch(error => {
        if (!disposed) {
          showAppError(error, 'operationFailed', QUEUE_LOG_TAG);
        }
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [queueService, sessionId]);

  const beginEdit = (item: CoworkPendingMessage): void => {
    setEditingId(item.id);
    setEditingText(item.text);
  };

  const cancelEdit = (): void => {
    setEditingId(null);
    setEditingText('');
  };

  const saveEdit = async (itemId: string): Promise<void> => {
    if (!queueActions) return;
    const text = editingText.trim();
    if (!text) return;
    const result = await queueActions.update(sessionId, itemId, text);
    if (!result.success) {
      showAppError(result.error, 'coworkQueueUpdateFailed', QUEUE_LOG_TAG);
      return;
    }
    cancelEdit();
  };

  const removeItem = async (itemId: string): Promise<void> => {
    if (!queueActions) return;
    const result = await queueActions.remove(sessionId, itemId);
    if (!result.success) showAppError(result.error, 'coworkQueueDeleteFailed', QUEUE_LOG_TAG);
  };

  const steerItem = useCallback(
    async (itemId: string): Promise<void> => {
      if (!queueActions) return;
      const result = await queueActions.steer(sessionId, itemId);
      if (!result.success) {
        showAppError(result.error, 'coworkQueueSteerFailed', QUEUE_LOG_TAG);
      }
    },
    [queueActions, sessionId],
  );

  const retryItem = useCallback(
    async (itemId: string): Promise<void> => {
      if (!queueActions) return;
      const item = items.find(candidate => candidate.id === itemId);
      if (!item) return;
      const result =
        item.delivery === CoworkQueueDelivery.FollowUp
          ? await queueActions.followUp(sessionId, itemId)
          : await queueActions.steer(sessionId, itemId);
      if (!result.success) {
        showAppError(result.error, 'coworkQueueRetryFailed', QUEUE_LOG_TAG);
      }
    },
    [items, queueActions, sessionId],
  );

  useEffect(() => {
    if (selectedItemId && items.some(item => item.id === selectedItemId)) return;
    setSelectedItemId(items[0]?.id ?? null);
  }, [items, selectedItemId]);

  useEffect(() => {
    if (!queueActions) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      const isSteerShortcut =
        event.key === 'Enter' &&
        event.shiftKey &&
        !event.altKey &&
        (event.ctrlKey || event.metaKey);
      if (!isSteerShortcut || !isStreaming || !selectedItemId) return;
      const selected = items.find(item => item.id === selectedItemId);
      if (!selected || selected.status === CoworkQueueItemStatus.Sending) return;
      event.preventDefault();
      void steerItem(selected.id);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [queueActions, isStreaming, items, selectedItemId, steerItem]);

  if (loading || items.length === 0) return null;

  if (!queueActions) {
    return (
      <ul className="mb-2 overflow-hidden" aria-label={i18nService.t('coworkQueuePendingInputs')}>
        {items.map(item => (
          <li
            key={item.id}
            className="theme-surface-pending-content flex min-w-0 items-center gap-2"
          >
            <ListTodo className="theme-surface-pending-icon shrink-0" />
            <span className="min-w-0 flex-1 truncate" title={item.text}>
              {item.text}
            </span>
            {item.status === CoworkQueueItemStatus.Failed ? (
              <Badge variant="destructive">{i18nService.t('coworkQueueStatusFailed')}</Badge>
            ) : item.status === CoworkQueueItemStatus.Sending ? (
              <Badge variant="secondary">{i18nService.t('coworkQueueStatusSending')}</Badge>
            ) : null}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="mb-2 overflow-hidden rounded-xl border border-border bg-card text-sm">
      <div>
        {items.map(item => {
          const isEditing = editingId === item.id;
          const isSending = item.status === CoworkQueueItemStatus.Sending;
          const isFailed = item.status === CoworkQueueItemStatus.Failed;
          return (
            <div
              key={item.id}
              role={queueActions ? 'button' : undefined}
              tabIndex={queueActions ? 0 : undefined}
              className={cn(
                'theme-surface-pending-row flex min-w-0 items-center gap-2 px-3 py-2.5',
                queueActions && selectedItemId === item.id && 'theme-surface-pending-selected',
                isFailed && 'theme-surface-pending-failed',
              )}
              onClick={queueActions ? () => setSelectedItemId(item.id) : undefined}
              onKeyDown={event => {
                if (!queueActions || event.target !== event.currentTarget) return;
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                setSelectedItemId(item.id);
              }}
            >
              {isEditing ? (
                <Input
                  value={editingText}
                  autoFocus
                  onChange={event => setEditingText(event.currentTarget.value)}
                  onKeyDown={event => {
                    if (event.key === 'Escape') cancelEdit();
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void saveEdit(item.id);
                    }
                  }}
                  className="theme-control-sizing-14 min-w-0 flex-1"
                />
              ) : (
                <>
                  <ListTodo className="size-4 shrink-0 text-muted-foreground" />
                  <div
                    className="min-w-0 flex-1 truncate font-medium text-foreground"
                    title={item.text}
                  >
                    {item.text}
                  </div>
                  {(isFailed || isSending) && (
                    <span
                      className={cn(
                        'shrink-0 text-xs',
                        isFailed ? 'text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      {isFailed
                        ? i18nService.t('coworkQueueStatusFailed')
                        : i18nService.t('coworkQueueStatusSending')}
                    </span>
                  )}
                </>
              )}
              {queueActions ? (
                <div className="flex shrink-0 items-center gap-0.5">
                  {isEditing ? (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        title={i18nService.t('save')}
                        aria-label={i18nService.t('save')}
                        onClick={() => void saveEdit(item.id)}
                      >
                        <Check />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        title={i18nService.t('cancel')}
                        aria-label={i18nService.t('cancel')}
                        onClick={cancelEdit}
                      >
                        <X />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        type="button"
                        variant={isFailed ? 'outline' : 'ghost'}
                        size="sm"
                        className="theme-action-small"
                        disabled={isSending || (!isFailed && !isStreaming)}
                        onClick={() => void (isFailed ? retryItem(item.id) : steerItem(item.id))}
                      >
                        {isFailed ? <RotateCcw /> : <Compass />}
                        {isFailed
                          ? i18nService.t('coworkQueueRetry')
                          : i18nService.t('coworkQueueSteer')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="theme-action-small"
                        disabled={isSending}
                        onClick={() => beginEdit(item)}
                      >
                        <Pencil />
                        {i18nService.t('edit')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        title={i18nService.t('delete')}
                        aria-label={i18nService.t('delete')}
                        disabled={isSending}
                        onClick={() => void removeItem(item.id)}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PendingMessageQueue;
