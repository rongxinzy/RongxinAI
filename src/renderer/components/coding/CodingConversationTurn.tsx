import { Message, MessageContent, MessageResponse } from '@shared/components/ai-elements/message';
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@shared/components/ai-elements/reasoning';
import { Shimmer } from '@shared/components/ai-elements/shimmer';
import { CollapsibleContent } from '@shared/components/ui/collapsible';
import { CheckCircle2, CircleStop, TriangleAlert } from 'lucide-react';
import { memo, useEffect, useState, type ReactNode } from 'react';

import { i18nService } from '../../services/i18n';
import type { Artifact } from '../../types/artifact';
import { formatMessageDateTime } from '../../utils/tokenFormat';
import ArtifactPreviewCard from '../artifacts/ArtifactPreviewCard';
import { CopyButton, ReEditButton } from '../cowork/components/CopyButton';
import { CodingActivity } from './CodingActivityView';
import { CodingAgentWorkingIndicator } from './CodingAgentWorkingIndicator';
import {
  CodingConversationActivityKind,
  CodingConversationSegmentKind,
  CodingConversationTurnStatus,
} from './constants';
import { type CodingConversationTurn as CodingConversationTurnModel } from './codingEventProjection';

interface CodingConversationTurnProps {
  isStreaming: boolean;
  showWaitingIndicator: boolean;
  turn: CodingConversationTurnModel;
  /** Artifacts detected in this lane, keyed by the assistant message id. */
  artifactsByMessageId?: ReadonlyMap<string, Artifact[]>;
  /** File artifacts keyed by the tool call that produced them. */
  artifactsByToolCallId?: ReadonlyMap<string, Artifact[]>;
  expandedActivityIds: ReadonlySet<string>;
  onActivityOpenChange: (activityId: string, open: boolean) => void;
  onReEditUserMessage: (content: string) => void;
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

const formatExecutionDuration = (durationMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds} ${i18nService.t('codingAgentDurationSeconds')}`;
  }
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} ${i18nService.t('codingAgentDurationMinutes')} ${seconds} ${i18nService.t('codingAgentDurationSeconds')}`;
  }
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours} ${i18nService.t('codingAgentDurationHours')} ${minutes} ${i18nService.t('codingAgentDurationMinutes')} ${seconds} ${i18nService.t('codingAgentDurationSeconds')}`;
};

const TurnExecutionDuration = ({ turn }: { turn: CodingConversationTurnModel }) => {
  const [now, setNow] = useState(() => Date.now());
  const isFinished = turn.completedAt !== null;

  useEffect(() => {
    if (isFinished) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isFinished]);

  const endAt = turn.completedAt ?? now;
  const duration = Math.max(0, endAt - turn.startedAt);
  const label = isFinished
    ? i18nService.t('codingAgentExecutionDuration')
    : i18nService.t('codingAgentExecutionElapsed');
  return (
    <span className="shrink-0 font-medium text-sm text-muted-foreground">
      {label} {formatExecutionDuration(duration)}
    </span>
  );
};

const CodingUserMessage = ({
  content,
  createdAt,
  onReEdit,
}: {
  content: string;
  createdAt: number;
  onReEdit: () => void;
}) => (
  <div className="flex flex-col items-end">
    <Message from="user" className="animate-message-in">
      <MessageContent className="theme-message-code-user whitespace-pre-wrap">
        {content}
      </MessageContent>
    </Message>
    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
      <span>{formatMessageDateTime(createdAt)}</span>
      <CopyButton content={content} visible />
      <ReEditButton visible onClick={onReEdit} />
    </div>
  </div>
);

const CodingAssistantMessage = ({
  content,
  createdAt,
  isStreaming,
  children,
}: {
  content: string;
  createdAt: number;
  isStreaming: boolean;
  children?: ReactNode;
}) => (
  <div className="flex flex-col items-start">
    <Message from="assistant" className="animate-message-in">
      <MessageContent>
        <MessageResponse isAnimating={isStreaming}>{content}</MessageResponse>
        {children}
      </MessageContent>
    </Message>
    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
      <span>{formatMessageDateTime(createdAt)}</span>
      <CopyButton content={content} visible />
    </div>
  </div>
);

const CodingConversationTurnComponent = ({
  isStreaming,
  showWaitingIndicator,
  turn,
  artifactsByMessageId,
  artifactsByToolCallId,
  expandedActivityIds,
  onActivityOpenChange,
  onReEditUserMessage,
}: CodingConversationTurnProps) => {
  const hasPermission = turn.activities.some(
    activity => activity.kind === CodingConversationActivityKind.Permission,
  );
  const [isReasoningOpen, setIsReasoningOpen] = useState(hasPermission);

  useEffect(() => {
    if (hasPermission) setIsReasoningOpen(true);
  }, [hasPermission]);

  const renderActivity = (activity: CodingConversationTurnModel['activities'][number]) => {
    const toolCallId =
      typeof activity.event.payload.toolCallId === 'string'
        ? activity.event.payload.toolCallId
        : null;
    return (
      <CodingActivity
        key={activity.id}
        activity={activity}
        artifacts={toolCallId ? artifactsByToolCallId?.get(toolCallId) : undefined}
        open={expandedActivityIds.has(activity.id)}
        onOpenChange={open => onActivityOpenChange(activity.id, open)}
      />
    );
  };
  const hasReasoningGroup = turn.segments.length > 0;

  return (
    <section
      className="flex flex-col gap-3"
      aria-label={i18nService.t('codingAgentConversationTurn')}
    >
      {turn.userMessage && (
        <CodingUserMessage
          content={turn.userMessage.content}
          createdAt={turn.userMessage.createdAt}
          onReEdit={() => onReEditUserMessage(turn.userMessage!.content)}
        />
      )}

      <div className="flex flex-col gap-3">
        {showWaitingIndicator ? (
          <CodingAgentWorkingIndicator duration={<TurnExecutionDuration turn={turn} />} />
        ) : null}

        {hasReasoningGroup && (
          <Reasoning
            isStreaming={isStreaming}
            defaultOpen={false}
            open={isReasoningOpen}
            onOpenChange={setIsReasoningOpen}
          >
            <ReasoningTrigger
              getThinkingMessage={streaming => {
                const label =
                turn.reasoning ? (
                  streaming ? (
                    <Shimmer duration={1}>{i18nService.t('codingAgentReasoningActive')}</Shimmer>
                  ) : (
                    <span>{i18nService.t('codingAgentReasoningComplete')}</span>
                  )
                ) : (
                  <span>{i18nService.t('codingAgentToolCalls')}</span>
                );
                return (
                  <span className="flex min-w-0 items-center gap-2">
                    {label}
                    <TurnExecutionDuration turn={turn} />
                  </span>
                );
              }}
            />
            <CollapsibleContent className="theme-reasoning-panel mt-2">
              <div className="flex min-w-0 flex-col gap-2">
                {turn.segments.map(segment =>
                  segment.kind === CodingConversationSegmentKind.Reasoning ? (
                    <ReasoningContent key={segment.id} className="text-left">
                      {segment.content}
                    </ReasoningContent>
                  ) : (
                    <div key={segment.activity.id}>{renderActivity(segment.activity)}</div>
                  ),
                )}
              </div>
            </CollapsibleContent>
          </Reasoning>
        )}

        {turn.assistantMessages.map(message => {
          const artifacts = artifactsByMessageId?.get(message.id) ?? [];
          return (
            <CodingAssistantMessage
              key={message.id}
              content={message.content}
              createdAt={message.createdAt}
              isStreaming={isStreaming}
            >
              {artifacts.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2">
                  {artifacts.map(artifact => (
                    <ArtifactPreviewCard key={artifact.id} artifact={artifact} />
                  ))}
                </div>
              )}
            </CodingAssistantMessage>
          );
        })}

        {!hasReasoningGroup && turn.completedAt !== null ? (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <TurnExecutionDuration turn={turn} />
          </div>
        ) : null}

        <TurnStatus turn={turn} />
      </div>
    </section>
  );
};

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

const segmentContentsEqual = (
  a: CodingConversationTurnModel['segments'][number],
  b: CodingConversationTurnModel['segments'][number],
): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === CodingConversationSegmentKind.Reasoning && b.kind === a.kind) {
    return a.id === b.id && a.content === b.content && a.createdAt === b.createdAt;
  }
  if (a.kind === CodingConversationSegmentKind.Activity && b.kind === a.kind) {
    return (
      a.activity.id === b.activity.id &&
      a.activity.kind === b.activity.kind &&
      a.activity.event.kind === b.activity.event.kind &&
      JSON.stringify(a.activity.event.payload) === JSON.stringify(b.activity.event.payload)
    );
  }
  return false;
};

const turnContentsEqual = (a: CodingConversationTurnModel, b: CodingConversationTurnModel): boolean =>
  a === b ||
  (a.id === b.id &&
    a.startedAt === b.startedAt &&
    a.completedAt === b.completedAt &&
    a.status === b.status &&
    a.statusDetail === b.statusDetail &&
    messageContentsEqual(a.userMessage, b.userMessage) &&
    reasoningContentsEqual(a.reasoning, b.reasoning) &&
    a.segments.length === b.segments.length &&
    a.segments.every((segment, index) => segmentContentsEqual(segment, b.segments[index])) &&
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
  prev.expandedActivityIds === next.expandedActivityIds &&
  prev.onActivityOpenChange === next.onActivityOpenChange &&
  prev.onReEditUserMessage === next.onReEditUserMessage &&
  turnContentsEqual(prev.turn, next.turn);

export const CodingConversationTurn = memo(
  CodingConversationTurnComponent,
  conversationTurnPropsEqual,
);
