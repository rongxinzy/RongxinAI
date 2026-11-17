import { TurnNavigator, type TurnNavigatorItem } from '@shared/components/conversation';
import { Button } from '@shared/components/ui/button';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown } from 'lucide-react';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { i18nService } from '../../../services/i18n';
import type {
  CoworkMessage,
  CoworkPermissionRequest,
  CoworkPermissionResult,
} from '../../../types/cowork';
import type { Skill } from '../../../types/skill';
import CoworkPermissionModal from '../../cowork/CoworkPermissionModal';
import type { ConversationTurn } from '../model/types';
import { TurnView } from './TurnView';

const CHAT_SCROLL_END_THRESHOLD = 80;
const CHAT_INITIAL_VIEWPORT = { width: 800, height: 600 };

const estimateTurnHeight = (turn: ConversationTurn | undefined): number => {
  if (!turn) return 220;
  let height = turn.userMessage ? 84 : 24;
  for (const part of turn.parts) {
    if (part.kind === 'reasoning') {
      height += 52;
    } else if (part.kind === 'text') {
      height += Math.max(72, Math.min(960, Math.ceil(part.message.content.length / 4)));
    } else if (part.kind === 'tool' || part.kind === 'tool_group') {
      height += 52;
    } else {
      height += 72;
    }
  }
  if (turn.deliverables.length > 0) height += 116;
  return Math.max(96, height);
};

interface ConversationThreadProps {
  sessionId?: string;
  turns: ConversationTurn[];
  skills: Skill[];
  cwd?: string;
  isExporting?: boolean;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  unmatchedPermission?: CoworkPermissionRequest | null;
  onRespondToPermission?: (result: CoworkPermissionResult) => void | Promise<void>;
  onRespondToQuestion?: (result: CoworkPermissionResult) => void | Promise<void>;
  onReEdit?: (message: CoworkMessage) => void;
  onInitialScrollReady?: () => void;
}

/**
 * Virtualized scrollable transcript powered exclusively by TanStack Virtual's
 * native chat mode (`anchorTo: 'end'`, `followOnAppend: true`), with a static
 * full-DOM path reserved strictly for long-screenshot export.
 */
export const ConversationThread: React.FC<ConversationThreadProps> = ({
  sessionId,
  turns,
  skills,
  cwd,
  isExporting = false,
  scrollContainerRef,
  unmatchedPermission = null,
  onRespondToPermission,
  onRespondToQuestion,
  onReEdit,
  onInitialScrollReady,
}) => {
  const threadRootRef = useRef<HTMLDivElement>(null);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const initialPositionedKeyRef = useRef<string | null>(null);

  const attachScrollElement = useCallback(
    (node: HTMLDivElement | null) => {
      scrollContainerRef.current = node;
      setScrollElement(node);
    },
    [scrollContainerRef],
  );

  const virtualizer = useVirtualizer({
    count: turns.length,
    getScrollElement: () => scrollElement,
    getItemKey: index => turns[index]?.id ?? index,
    estimateSize: index => estimateTurnHeight(turns[index]),
    overscan: 4,
    initialRect: CHAT_INITIAL_VIEWPORT,
    anchorTo: 'end',
    followOnAppend: true,
    scrollEndThreshold: CHAT_SCROLL_END_THRESHOLD,
    enabled: !isExporting,
  });

  useEffect(() => {
    initialPositionedKeyRef.current = null;
  }, [sessionId]);

  useLayoutEffect(() => {
    if (isExporting || !scrollElement || turns.length === 0) return;
    const sessionKey = sessionId ?? '__active__';
    if (initialPositionedKeyRef.current === sessionKey) return;
    initialPositionedKeyRef.current = sessionKey;
    virtualizer.scrollToEnd({ behavior: 'auto' });
    onInitialScrollReady?.();
  }, [isExporting, onInitialScrollReady, scrollElement, sessionId, turns.length, virtualizer]);

  const navigatorItems = useMemo<TurnNavigatorItem[]>(
    () =>
      turns.map(turn => {
        const promptPreview = turn.userMessage?.content?.trim().replace(/\s+/g, ' ');
        const label = promptPreview
          ? promptPreview.length > 36
            ? `${promptPreview.slice(0, 36)}…`
            : promptPreview
          : i18nService.t('coworkTurnJumpLabel').replace('{index}', String(turn.index + 1));

        const state: TurnNavigatorItem['state'] = turn.hasApproval
          ? 'approval'
          : turn.hasError
            ? 'error'
            : turn.isStreaming
              ? 'streaming'
              : 'idle';

        return { id: turn.id, index: turn.index, label, state };
      }),
    [turns],
  );

  const handleSelectTurn = useCallback(
    (_turnId: string, index: number) => {
      if (isExporting) {
        const target = threadRootRef.current?.querySelector<HTMLElement>(
          `[data-turn-index="${index}"]`,
        );
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      virtualizer.scrollToIndex(index, { align: 'start', behavior: 'smooth' });
    },
    [isExporting, virtualizer],
  );

  const activeTurnId = turns[turns.length - 1]?.id ?? null;
  const virtualItems = virtualizer.getVirtualItems();
  const showScrollToBottom = !isExporting && turns.length > 0 && !virtualizer.isAtEnd();

  return (
    <div
      ref={threadRootRef}
      role="log"
      className="relative flex flex-1 flex-col h-full min-h-0 overflow-hidden"
    >
      <div
        ref={attachScrollElement}
        className="cowork-conversation-scroll relative flex-1 min-h-0 overflow-y-auto pt-4"
        style={{ overflowAnchor: 'none' }}
      >
        {isExporting ? (
          <div className="mx-auto w-full max-w-[calc(56rem+2rem)] px-4">
            {turns.map(turn => (
              <TurnView
                key={turn.id}
                turn={turn}
                skills={skills}
                cwd={cwd}
                forceExpand
                onReEdit={onReEdit}
                onRespondToPermission={onRespondToPermission}
                onRespondToQuestion={onRespondToQuestion}
              />
            ))}
          </div>
        ) : (
          <div className="mx-auto w-full max-w-[calc(56rem+2rem)] px-4">
            <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
              {virtualItems.map(virtualRow => {
                const turn = turns[virtualRow.index];
                if (!turn) return null;
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    className="absolute top-0 left-0 w-full"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <TurnView
                      turn={turn}
                      skills={skills}
                      cwd={cwd}
                      onReEdit={onReEdit}
                      onRespondToPermission={onRespondToPermission}
                      onRespondToQuestion={onRespondToQuestion}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {unmatchedPermission && onRespondToPermission ? (
        <div className="shrink-0 px-3 pt-3">
          <div className="mx-auto w-full max-w-4xl min-w-[320px]">
            <CoworkPermissionModal
              permission={unmatchedPermission}
              onRespond={onRespondToPermission}
            />
          </div>
        </div>
      ) : null}

      {showScrollToBottom ? (
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label="Scroll to bottom"
          onClick={() => virtualizer.scrollToEnd({ behavior: 'smooth' })}
          className="theme-page-conversation-button-variant-1 absolute bottom-4 left-[50%] z-10 translate-x-[-50%]"
        >
          <ArrowDown className="size-4" />
        </Button>
      ) : null}

      <div className="pointer-events-none absolute inset-y-4 right-2 z-10">
        <div className="pointer-events-auto max-h-full">
          <TurnNavigator
            label={i18nService.t('coworkConversationTurns')}
            items={navigatorItems}
            activeTurnId={activeTurnId}
            onSelectTurn={handleSelectTurn}
          />
        </div>
      </div>
    </div>
  );
};
