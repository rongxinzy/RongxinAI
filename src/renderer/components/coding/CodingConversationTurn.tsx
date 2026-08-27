import { Message, MessageContent, MessageResponse } from '@shared/components/ai-elements/message';
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@shared/components/ai-elements/reasoning';
import { Shimmer } from '@shared/components/ai-elements/shimmer';
import { Tool, ToolContent, ToolHeader } from '@shared/components/ai-elements/tool';
import { CheckCircle2, CircleStop, TriangleAlert } from 'lucide-react';
import { memo } from 'react';

import { i18nService } from '../../services/i18n';
import {
  CodingConversationActivityKind,
  CodingConversationTurnStatus,
  CodingExternalActivityStatus,
  CodingToolPartState,
  type CodingToolPartState as CodingToolPartStateType,
} from './constants';
import {
  getCodingEventText,
  type CodingConversationActivity,
  type CodingConversationTurn as CodingConversationTurnModel,
} from './codingEventProjection';

interface CodingConversationTurnProps {
  isStreaming: boolean;
  turn: CodingConversationTurnModel;
}

const activityTitle = (activity: CodingConversationActivity): string => {
  const payload = activity.event.payload;
  for (const value of [payload.title, payload.name, payload.toolName]) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  const keys = {
    [CodingConversationActivityKind.Plan]: 'codingAgentPlan',
    [CodingConversationActivityKind.Tool]: 'codingAgentTool',
    [CodingConversationActivityKind.Permission]: 'codingAgentPermissionEvent',
  } as const;
  return i18nService.t(keys[activity.kind]);
};

const activityState = (activity: CodingConversationActivity): CodingToolPartStateType => {
  if (activity.kind === CodingConversationActivityKind.Permission) {
    return CodingToolPartState.ApprovalRequested;
  }
  const status = activity.event.payload.status;
  if (status === CodingExternalActivityStatus.Failed) return CodingToolPartState.OutputError;
  if (status === CodingExternalActivityStatus.Completed) return CodingToolPartState.OutputAvailable;
  if (status === CodingExternalActivityStatus.Pending) return CodingToolPartState.InputStreaming;
  return CodingToolPartState.InputAvailable;
};

const activityDetails = (activity: CodingConversationActivity): string => {
  const content = getCodingEventText(activity.event);
  if (content) return content;
  return Object.keys(activity.event.payload).length > 0
    ? JSON.stringify(activity.event.payload, null, 2)
    : '';
};

const activityStatusLabel = (state: CodingToolPartStateType): string => {
  const keys = {
    [CodingToolPartState.ApprovalRequested]: 'codingAgentPermissionEvent',
    [CodingToolPartState.InputAvailable]: 'codingAgentToolRunning',
    [CodingToolPartState.InputStreaming]: 'codingAgentToolPending',
    [CodingToolPartState.OutputAvailable]: 'codingAgentToolCompleted',
    [CodingToolPartState.OutputError]: 'codingAgentToolFailed',
  } as const;
  return i18nService.t(keys[state]);
};

const CodingActivity = ({ activity }: { activity: CodingConversationActivity }) => {
  const details = activityDetails(activity);
  const state = activityState(activity);
  return (
    <Tool defaultOpen={activity.kind === CodingConversationActivityKind.Permission}>
      <ToolHeader
        type="dynamic-tool"
        toolName="coding-agent"
        state={state}
        statusLabel={activityStatusLabel(state)}
        title={activityTitle(activity)}
      />
      {details && (
        <ToolContent>
          <pre className="whitespace-pre-wrap break-words font-mono text-xs">{details}</pre>
        </ToolContent>
      )}
    </Tool>
  );
};

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

const CodingConversationTurnComponent = ({ isStreaming, turn }: CodingConversationTurnProps) => (
  <section
    className="flex flex-col gap-3"
    aria-label={i18nService.t('codingAgentConversationTurn')}
  >
    {turn.userMessage && (
      <Message from="user" className="animate-message-in">
        <MessageContent className="rounded-xl rounded-br-md bg-primary/10 px-4 py-3 leading-relaxed whitespace-pre-wrap">
          {turn.userMessage.content}
        </MessageContent>
      </Message>
    )}

    <div className="flex flex-col gap-3">
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

      {turn.activities.map(activity => (
        <CodingActivity key={activity.id} activity={activity} />
      ))}

      {turn.assistantMessages.map(message => (
        <Message key={message.id} from="assistant" className="animate-message-in">
          <MessageContent>
            <MessageResponse isAnimating={isStreaming}>{message.content}</MessageResponse>
          </MessageContent>
        </Message>
      ))}

      <TurnStatus turn={turn} />
    </div>
  </section>
);

export const CodingConversationTurn = memo(CodingConversationTurnComponent);
