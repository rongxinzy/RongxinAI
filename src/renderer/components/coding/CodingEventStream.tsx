import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@shared/components/ai-elements/conversation';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@shared/components/ui/empty';
import { Code2 } from 'lucide-react';
import { useMemo, type RefObject } from 'react';

import type { CodingEvent } from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
import { CodingConversationTurn } from './CodingConversationTurn';
import { projectCodingEvents } from './codingEventProjection';

interface CodingEventStreamProps {
  events: CodingEvent[];
  isStreaming: boolean;
  scrollAreaRef: RefObject<HTMLDivElement | null>;
  onScrollPositionChange: (scrollPosition: number) => void;
  emptyDescription?: string;
}

export const CodingEventStream = ({
  events,
  isStreaming,
  scrollAreaRef,
  onScrollPositionChange,
  emptyDescription,
}: CodingEventStreamProps) => {
  const turns = useMemo(() => projectCodingEvents(events), [events]);

  return (
    <div
      ref={scrollAreaRef}
      className="min-h-0 flex-1"
      onScrollCapture={event => {
        if (event.target instanceof HTMLElement) onScrollPositionChange(event.target.scrollTop);
      }}
    >
      <Conversation
        className="h-full"
        initial="instant"
        resize={isStreaming ? 'smooth' : 'instant'}
      >
        <ConversationContent
          reverse={false}
          scrollClassName="coding-conversation-scroll"
          className="mx-auto min-h-full w-full max-w-5xl gap-6 px-4 py-4"
        >
          {turns.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Code2 />
                </EmptyMedia>
                <EmptyTitle>{i18nService.t('codingAgentEmptyTitle')}</EmptyTitle>
                <EmptyDescription>
                  {emptyDescription ?? i18nService.t('codingAgentEmpty')}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            turns.map((turn, index) => (
              <CodingConversationTurn
                key={turn.id}
                turn={turn}
                isStreaming={isStreaming && index === turns.length - 1}
              />
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </div>
  );
};
