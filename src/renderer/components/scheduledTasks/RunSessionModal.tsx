import { Button } from '@shared/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@shared/components/ui/dialog';
import { Spinner } from '@shared/components/ui/spinner';
import { RefreshCw } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { i18nService } from '../../services/i18n';
import type { CoworkSession } from '../../types/cowork';
import { TurnBlock } from '../cowork/components/TurnBlock';
import { UserBubble } from '../cowork/components/UserBubble';
import { buildConversationTurns, buildDisplayItems } from '../cowork/helpers/messageGrouping';

interface RunSessionModalProps {
  sessionId?: string | null;
  sessionKey?: string | null;
  title?: string;
  onClose: () => void;
}

const MAX_RETRIES = 5;
const RETRY_INTERVAL_MS = 3000;

const RunSessionModal: React.FC<RunSessionModalProps> = ({
  sessionId,
  sessionKey,
  title,
  onClose,
}) => {
  const [session, setSession] = useState<CoworkSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  const loadSession = useCallback(
    async (isRetry = false): Promise<boolean> => {
      if (!isRetry) {
        setLoading(true);
        setError(null);
      }

      try {
        let loadedSession: CoworkSession | null = null;

        if (sessionId) {
          const result = await window.electron?.cowork?.getSession(sessionId);
          if (result?.success && result.session) {
            const s = result.session;
            loadedSession = {
              ...s,
              messagesOffset: s.messagesOffset ?? 0,
              totalMessages: s.totalMessages ?? s.messages?.length ?? 0,
            };
          }
        }

        if (!loadedSession && sessionKey) {
          const result = await window.electron?.scheduledTasks?.resolveSession(sessionKey);
          if (result?.success && result.session) {
            const s = result.session;
            loadedSession = {
              ...s,
              messagesOffset: s.messagesOffset ?? 0,
              totalMessages: s.totalMessages ?? s.messages?.length ?? 0,
            };
          }
        }

        if (cancelledRef.current) return false;

        if (loadedSession) {
          setSession(loadedSession);
          setLoading(false);
          setError(null);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [sessionId, sessionKey],
  );

  useEffect(() => {
    cancelledRef.current = false;

    const run = async () => {
      const success = await loadSession();
      if (cancelledRef.current) return;

      if (!success) {
        setRetryCount(1);
      }
    };

    run();

    return () => {
      cancelledRef.current = true;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [loadSession]);

  useEffect(() => {
    if (retryCount === 0 || retryCount > MAX_RETRIES || session) return;

    retryTimerRef.current = setTimeout(async () => {
      if (cancelledRef.current) return;
      const success = await loadSession(true);
      if (cancelledRef.current) return;

      if (!success) {
        if (retryCount >= MAX_RETRIES) {
          setLoading(false);
          setError(i18nService.t('scheduledTasksSessionNotSynced'));
        } else {
          setRetryCount(prev => prev + 1);
        }
      }
    }, RETRY_INTERVAL_MS);

    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [retryCount, session, loadSession]);

  const handleManualRetry = async () => {
    setError(null);
    setLoading(true);
    setRetryCount(0);
    const success = await loadSession();
    if (!success) {
      setRetryCount(1);
    }
  };

  const displayItems = useMemo(
    () => buildDisplayItems(session?.messages ?? []),
    [session?.messages],
  );
  const turns = useMemo(() => buildConversationTurns(displayItems), [displayItems]);

  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="theme-page-run-session-modal-dialog-content-1 flex max-h-[72vh] flex-col overflow-hidden sm:max-w-[56rem]">
        <DialogHeader className="theme-part-run-session-modal-dialog-header-1 flex flex-row items-center justify-between shrink-0">
          <DialogTitle className="theme-part-run-session-modal-dialog-title-1 truncate">
            {title || session?.title || i18nService.t('scheduledTasksViewSession')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto bg-card">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Spinner />
              <span className="text-sm text-muted-foreground">
                {retryCount > 0
                  ? `${i18nService.t('scheduledTasksSessionSyncing')} (${retryCount}/${MAX_RETRIES})`
                  : i18nService.t('loading')}
              </span>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <span className="text-sm text-muted-foreground">{error}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleManualRetry}
                className="inline-flex items-center gap-1.5"
              >
                <RefreshCw className="size-3.5" />
                {i18nService.t('scheduledTasksSessionRetry')}
              </Button>
            </div>
          )}

          {!loading && !error && turns.length === 0 && (
            <div className="flex items-center justify-center py-16">
              <span className="text-sm text-muted-foreground">
                {i18nService.t('scheduledTasksNoRuns')}
              </span>
            </div>
          )}

          {!loading && !error && turns.length > 0 && (
            <div className="py-2">
              {turns.map(turn => {
                const showAssistantBlock = turn.assistantItems.length > 0;

                return (
                  <React.Fragment key={turn.id}>
                    {turn.userMessage && <UserBubble message={turn.userMessage} skills={[]} />}
                    {showAssistantBlock && (
                      <TurnBlock turn={turn} showTypingIndicator={false} showCopyButtons={true} />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default RunSessionModal;
