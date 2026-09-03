import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { cn } from '@shared/lib/utils';
import { Check, Compass, ListTodo, Pencil, RotateCcw, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import {
  CoworkQueueDelivery,
  CoworkQueueItemStatus,
  type CoworkPendingMessage,
} from '../../../shared/cowork/pendingMessageQueue';
import { coworkQueueService } from '../../services/coworkQueue';
import { i18nService } from '../../services/i18n';

interface PendingMessageQueueProps {
  sessionId: string;
  isStreaming: boolean;
  queueService?: Pick<typeof coworkQueueService, 'subscribe' | 'load' | 'update' | 'remove' | 'steer' | 'followUp'>;
}

const showQueueToast = (message: string): void => {
  window.dispatchEvent(new CustomEvent('app:showToast', { detail: message }));
};

const PendingMessageQueue = ({ sessionId, isStreaming, queueService = coworkQueueService }: PendingMessageQueueProps) => {
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
          showQueueToast(error instanceof Error ? error.message : String(error));
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
    const text = editingText.trim();
    if (!text) return;
    const result = await queueService.update(sessionId, itemId, text);
    if (!result.success) {
      showQueueToast(result.error || i18nService.t('coworkQueueUpdateFailed'));
      return;
    }
    cancelEdit();
  };

  const removeItem = async (itemId: string): Promise<void> => {
    const result = await queueService.remove(sessionId, itemId);
    if (!result.success) showQueueToast(result.error || i18nService.t('coworkQueueDeleteFailed'));
  };

  const steerItem = useCallback(
    async (itemId: string): Promise<void> => {
      const result = await queueService.steer(sessionId, itemId);
      if (!result.success) {
        showQueueToast(result.error || i18nService.t('coworkQueueSteerFailed'));
      }
    },
    [queueService, sessionId],
  );

  const retryItem = useCallback(
    async (itemId: string): Promise<void> => {
      const item = items.find(candidate => candidate.id === itemId);
      if (!item) return;
      const result =
        item.delivery === CoworkQueueDelivery.FollowUp
          ? await queueService.followUp(sessionId, itemId)
          : await queueService.steer(sessionId, itemId);
      if (!result.success) {
        showQueueToast(result.error || i18nService.t('coworkQueueRetryFailed'));
      }
    },
    [items, queueService, sessionId],
  );

  useEffect(() => {
    if (selectedItemId && items.some(item => item.id === selectedItemId)) return;
    setSelectedItemId(items[0]?.id ?? null);
  }, [items, selectedItemId]);

  useEffect(() => {
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
  }, [isStreaming, items, selectedItemId, steerItem]);

  if (loading || items.length === 0) return null;

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
              role="button"
              tabIndex={0}
              className={cn(
                'flex min-w-0 items-center gap-2 border-b border-border/70 px-3 py-2.5 transition-colors last:border-b-0 hover:bg-accent/40 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                selectedItemId === item.id && 'bg-accent/40',
                isFailed && 'bg-destructive/5',
              )}
              onClick={() => setSelectedItemId(item.id)}
              onKeyDown={event => {
                if (event.target !== event.currentTarget) return;
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
                  className="h-8 min-w-0 flex-1"
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
                      className="h-7 gap-1 px-2 text-xs"
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
                      className="h-7 gap-1 px-2 text-xs"
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
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PendingMessageQueue;
