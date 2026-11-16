import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@shared/components/ai-elements/conversation';
import { TurnNavigator, type TurnNavigatorItem } from '@shared/components/conversation';
import React, { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useStickToBottomContext } from 'use-stick-to-bottom';

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

interface ConversationThreadProps {
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

const StickToBottomBridge: React.FC<{
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  hasTurns: boolean;
  onInitialScrollReady?: () => void;
}> = ({ scrollContainerRef, hasTurns, onInitialScrollReady }) => {
  const { scrollRef } = useStickToBottomContext();
  const notifiedRef = useRef(false);

  useLayoutEffect(() => {
    scrollContainerRef.current = (scrollRef.current as HTMLDivElement | null) ?? null;
    if (hasTurns && !notifiedRef.current) {
      notifiedRef.current = true;
      onInitialScrollReady?.();
    }
  }, [hasTurns, onInitialScrollReady, scrollContainerRef, scrollRef]);

  return null;
};

/**
 * Main scrollable transcript surface powered by `use-stick-to-bottom`.
 * Exposes the scroll element for export/link interception and renders a subtle
 * TurnNavigator rail for long conversations (>= 6 turns).
 */
export const ConversationThread: React.FC<ConversationThreadProps> = ({
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

  const handleSelectTurn = useCallback((turnId: string) => {
    const target = threadRootRef.current?.querySelector<HTMLElement>(`[data-turn-id="${turnId}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const activeTurnId = turns[turns.length - 1]?.id ?? null;

  return (
    <div ref={threadRootRef} className="relative flex-1 h-full min-h-0 overflow-hidden">
      <Conversation className="relative flex-1 h-full overflow-y-hidden">
        <StickToBottomBridge
          scrollContainerRef={scrollContainerRef}
          hasTurns={turns.length > 0}
          onInitialScrollReady={onInitialScrollReady}
        />
        <ConversationContent
          className="pt-3"
          reverse={false}
          scrollClassName="cowork-conversation-scroll"
        >
          <div>
            <div className="mx-auto w-full max-w-4xl">
              {turns.map(turn => (
                <TurnView
                  key={turn.id}
                  turn={turn}
                  skills={skills}
                  cwd={cwd}
                  forceExpand={isExporting}
                  isExporting={isExporting}
                  onReEdit={onReEdit}
                  onRespondToPermission={onRespondToPermission}
                  onRespondToQuestion={onRespondToQuestion}
                />
              ))}
            </div>

            {unmatchedPermission && onRespondToPermission ? (
              <div className="px-3 pt-3">
                <div className="mx-auto w-full max-w-4xl min-w-[320px]">
                  <CoworkPermissionModal
                    permission={unmatchedPermission}
                    onRespond={onRespondToPermission}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="pointer-events-none absolute top-4 right-2 z-10">
        <div className="pointer-events-auto">
          <TurnNavigator
            items={navigatorItems}
            activeTurnId={activeTurnId}
            onSelectTurn={handleSelectTurn}
          />
        </div>
      </div>
    </div>
  );
};
