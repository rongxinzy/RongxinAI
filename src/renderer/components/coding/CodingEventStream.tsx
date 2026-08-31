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
import { useEffect, useMemo, type RefObject } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import type { CodingEvent } from '../../../shared/codingAgent';
import { detectArtifactsFromMessages } from '../../services/artifactParser';
import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import { addArtifact, selectSessionArtifacts } from '../../store/slices/artifactSlice';
import type { Artifact } from '../../types/artifact';
import type { CoworkMessage } from '../../types/cowork';
import { CodingConversationTurn } from './CodingConversationTurn';
import { projectCodingEvents, type CodingConversationTurn as TurnModel } from './codingEventProjection';

interface CodingEventStreamProps {
  events: CodingEvent[];
  isStreaming: boolean;
  scrollAreaRef: RefObject<HTMLDivElement | null>;
  onScrollPositionChange: (scrollPosition: number) => void;
  emptyDescription?: string;
  /**
   * Artifact store key for the active lane. When set, assistant messages are
   * scanned for previewable artifacts (HTML/SVG/Mermaid/code) and rendered as
   * cards that open the artifact panel.
   */
  artifactSessionKey?: string | null;
}

const toDetectableMessages = (turns: TurnModel[]): CoworkMessage[] =>
  turns.flatMap(turn =>
    turn.assistantMessages
      .filter(message => message.content.trim())
      .map(message => ({
        id: message.id,
        type: 'assistant' as const,
        content: message.content,
        timestamp: message.createdAt,
      })),
  );

const groupArtifactsByMessage = (artifacts: Artifact[]): Map<string, Artifact[]> => {
  const grouped = new Map<string, Artifact[]>();
  for (const artifact of artifacts) {
    if (!artifact.messageId) continue;
    const list = grouped.get(artifact.messageId) ?? [];
    list.push(artifact);
    grouped.set(artifact.messageId, list);
  }
  return grouped;
};

export const CodingEventStream = ({
  events,
  isStreaming,
  scrollAreaRef,
  onScrollPositionChange,
  emptyDescription,
  artifactSessionKey = null,
}: CodingEventStreamProps) => {
  const dispatch = useDispatch();
  const turns = useMemo(() => projectCodingEvents(events), [events]);
  const artifacts = useSelector((state: RootState) =>
    artifactSessionKey ? selectSessionArtifacts(state, artifactSessionKey) : undefined,
  );

  // Artifact detection runs on the settled transcript only — scanning on every
  // streamed chunk would redo the whole parse per token.
  const detectableMessages = useMemo(() => toDetectableMessages(turns), [turns]);
  useEffect(() => {
    if (!artifactSessionKey || isStreaming || detectableMessages.length === 0) return;
    for (const { artifact } of detectArtifactsFromMessages(
      detectableMessages,
      artifactSessionKey,
    )) {
      dispatch(addArtifact({ sessionId: artifactSessionKey, artifact }));
    }
  }, [artifactSessionKey, isStreaming, detectableMessages, dispatch]);

  const artifactsByMessageId = useMemo(
    () => groupArtifactsByMessage(artifacts ?? []),
    [artifacts],
  );

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
                artifactsByMessageId={artifactsByMessageId}
              />
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </div>
  );
};
