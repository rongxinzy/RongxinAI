import { Message, MessageContent, MessageResponse } from '@shared/components/ai-elements/message';
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@shared/components/ai-elements/reasoning';
import { Shimmer } from '@shared/components/ai-elements/shimmer';
import { CheckCircle2, CircleStop, TriangleAlert } from 'lucide-react';
import { memo } from 'react';

import { i18nService } from '../../services/i18n';
import type { Artifact } from '../../types/artifact';
import ArtifactPreviewCard from '../artifacts/ArtifactPreviewCard';
import { CodingActivity } from './CodingActivityView';
import { CodingAgentWorkingIndicator } from './CodingAgentWorkingIndicator';
import { CodingConversationTurnStatus } from './constants';
import { type CodingConversationTurn as CodingConversationTurnModel } from './codingEventProjection';

interface CodingConversationTurnProps {
  isStreaming: boolean;
  showWaitingIndicator: boolean;
  turn: CodingConversationTurnModel;
  /** Artifacts detected in this lane, keyed by the assistant message id. */
  artifactsByMessageId?: ReadonlyMap<string, Artifact[]>;
  /** File artifacts keyed by the tool call that produced them. */
  artifactsByToolCallId?: ReadonlyMap<string, Artifact[]>;
}

const TurnStatus = ({ turn }: { turn: CodingConversationTurnModel }) => {
  if (turn.status === null) return null;
  if (turn.status === CodingConversationTurnStatus.Complete) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CheckCircle2 className="size-3.5" />
        <span>{i18nService.t('codingAgentTurnComplete')}</span>
      </div>
    );
  }
  if (turn.status === CodingConversationTurnStatus.Cancelled) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CircleStop className="size-3.5" />
        <span>{turn.statusDetail || i18nService.t('codingAgentTurnCancelled')}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 text-xs text-destructive">
      <TriangleAlert className="size-3.5" />
      <span>{turn.statusDetail || i18nService.t('codingAgentTurnFailed')}</span>
    </div>
  );
};

const CodingConversationTurnComponent = ({
  isStreaming,
  showWaitingIndicator,
  turn,
  artifactsByMessageId,
  artifactsByToolCallId,
}: CodingConversationTurnProps) => (
  <section
    className="flex flex-col gap-3"
    aria-label={i18nService.t('codingAgentConversationTurn')}
  >
    {turn.userMessage && (
      <Message from="user" className="animate-message-in">
        <MessageContent className="theme-message-code-user whitespace-pre-wrap">
          {turn.userMessage.content}
        </MessageContent>
      </Message>
    )}

    <div className="flex flex-col gap-3">
      {showWaitingIndicator ? <CodingAgentWorkingIndicator /> : null}

      {turn.reasoning && (
        <Reasoning isStreaming={isStreaming} defaultOpen={false}>
          <ReasoningTrigger
            getThinkingMessage={streaming =>
              streaming ? (
                <Shimmer duration={1}>{i18nService.t('codingAgentReasoningActive')}</Shimmer>
              ) : (
                <span>{i18nService.t('codingAgentReasoningComplete')}</span>
              )
            }
          />
          <ReasoningContent>{turn.reasoning.content}</ReasoningContent>
        </Reasoning>
      )}

      {turn.activities.map(activity => {
        const toolCallId =
          typeof activity.event.payload.toolCallId === 'string'
            ? activity.event.payload.toolCallId
            : null;
        return (
          <CodingActivity
            key={activity.id}
            activity={activity}
            artifacts={toolCallId ? artifactsByToolCallId?.get(toolCallId) : undefined}
          />
        );
      })}

      {turn.assistantMessages.map(message => {
        const artifacts = artifactsByMessageId?.get(message.id) ?? [];
        return (
          <Message key={message.id} from="assistant" className="animate-message-in">
            <MessageContent>
              <MessageResponse isAnimating={isStreaming}>{message.content}</MessageResponse>
              {artifacts.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2">
                  {artifacts.map(artifact => (
                    <ArtifactPreviewCard key={artifact.id} artifact={artifact} />
                  ))}
                </div>
              )}
            </MessageContent>
          </Message>
        );
      })}

      <TurnStatus turn={turn} />
    </div>
  </section>
);

const messageContentsEqual = (
  a:
    | { id: string; content: string; createdAt: number; role: string }
    | null,
  b:
    | { id: string; content: string; createdAt: number; role: string }
    | null,
): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.id === b.id &&
    a.content === b.content &&
    a.createdAt === b.createdAt &&
    a.role === b.role);

const reasoningContentsEqual = (
  a: { id: string; content: string; createdAt: number } | null,
  b: { id: string; content: string; createdAt: number } | null,
): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.id === b.id &&
    a.content === b.content &&
    a.createdAt === b.createdAt);

const turnContentsEqual = (a: CodingConversationTurnModel, b: CodingConversationTurnModel): boolean =>
  a === b ||
  (a.id === b.id &&
    a.status === b.status &&
    a.statusDetail === b.statusDetail &&
    messageContentsEqual(a.userMessage, b.userMessage) &&
    reasoningContentsEqual(a.reasoning, b.reasoning) &&
    a.assistantMessages.length === b.assistantMessages.length &&
    a.assistantMessages.every((message, index) =>
      messageContentsEqual(message, b.assistantMessages[index]),
    ) &&
    a.activities.length === b.activities.length &&
    a.activities.every(
      (activity, index) =>
        activity.id === b.activities[index].id &&
        activity.kind === b.activities[index].kind &&
        activity.event.kind === b.activities[index].event.kind &&
        JSON.stringify(activity.event.payload) ===
          JSON.stringify(b.activities[index].event.payload),
    ));

// CodingEventStream re-projects every event on each streamed chunk, which
// re-creates all turn objects and defeats the default shallow memo. Comparing
// the actual turn content lets unchanged completed turns skip re-rendering
// while the streaming turn (and any turn whose content changed) still updates.
const conversationTurnPropsEqual = (
  prev: CodingConversationTurnProps,
  next: CodingConversationTurnProps,
): boolean =>
  prev.isStreaming === next.isStreaming &&
  prev.showWaitingIndicator === next.showWaitingIndicator &&
  prev.artifactsByMessageId === next.artifactsByMessageId &&
  prev.artifactsByToolCallId === next.artifactsByToolCallId &&
  turnContentsEqual(prev.turn, next.turn);

export const CodingConversationTurn = memo(
  CodingConversationTurnComponent,
  conversationTurnPropsEqual,
);
