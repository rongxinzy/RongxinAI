import { CoworkMessageType, CoworkDisplayItemType } from '../../../../shared/cowork/constants';
import { ReasoningContent, ReasoningTrigger } from '@shared/components/ai-elements/reasoning';
import { ToolOutput } from '@shared/components/ai-elements/tool';
import { Alert, AlertDescription } from '@shared/components/ui/alert';
import { Button } from '@shared/components/ui/button';
import { Info, TriangleAlert } from 'lucide-react';
import React from 'react';

import type { CoworkErrorKind } from '../../../../common/coworkError';
import { getUserErrorI18nKey } from '../../../../common/coworkError';
import { getScheduledReminderDisplayText } from '../../../../scheduledTask/reminderText';
import type { CoworkMessageExpertIdentity } from '../../../../shared/cowork/sessionExperts';
import {
  CoworkInterruptionCause,
  type CoworkSessionInterruption,
} from '../../../../shared/cowork/interruption';
import type { CoworkToolActivity } from '../../../../shared/cowork/toolActivity';
import { i18nService } from '../../../services/i18n';
import { isCoworkTerminalErrorMessage } from '../../../services/coworkTerminalError';
import { ArtifactRole, type Artifact } from '../../../types/artifact';
import type {
  CoworkMessage,
  CoworkPermissionRequest,
  CoworkPermissionResult,
} from '../../../types/cowork';
import ArtifactPreviewCard from '../../artifacts/ArtifactPreviewCard';
import { ExpertAvatar } from '../../expert/expertAvatars';
import {
  getExecutionStatusText,
  getFinalAnswerIndex,
  getToolActivityExecutionStatus,
} from '../helpers/executionStatus';
import type { AssistantTurnItem, ConversationTurn } from '../helpers/messageGrouping';
import { getVisibleAssistantItems } from '../helpers/messageGrouping';
import { findToolGroupForPermission } from '../helpers/toolPermissionMatch';
import { getThinkingPresentation } from '../helpers/thinkingPresentation';
import { getToolResultDisplay, hasText } from '../helpers/toolUtils';
import { AssistantBubble } from './AssistantBubble';
import { CopyButton } from './CopyButton';
import { PersistentReasoning } from './PersistentCollapsible';
import { ToolCard } from './ToolCard';
import { WorkingIndicator } from './WorkingIndicator';

const getInterruptionMessage = (interruption: CoworkSessionInterruption): string => {
  switch (interruption.cause) {
    case CoworkInterruptionCause.ApprovalDenied:
      return i18nService.t('coworkInterruptionApprovalDenied');
    case CoworkInterruptionCause.RuntimePaused:
      return i18nService.t('coworkInterruptionRuntimePaused');
    case CoworkInterruptionCause.UserStop:
    default:
      return i18nService.t('coworkInterruptionUserStop');
  }
};

export const getTurnPrimaryExpert = (
  turn: ConversationTurn,
): CoworkMessageExpertIdentity | undefined => {
  const userExperts = turn.userMessage?.metadata?.experts;
  if (Array.isArray(userExperts)) return userExperts[0];
  const item = turn.assistantItems.find(
    entry =>
      entry.type === CoworkMessageType.Assistant && Array.isArray(entry.message.metadata?.experts),
  );
  return item?.type === CoworkMessageType.Assistant
    ? item.message.metadata?.experts?.[0]
    : undefined;
};

export const isTerminalErrorItem = (item: AssistantTurnItem): boolean =>
  item.type === CoworkMessageType.System && isCoworkTerminalErrorMessage(item.message);

/**
 * Live status line for a tool call whose arguments are still streaming in.
 * Ticks once per second (same approach as WorkingIndicator) so long argument
 * generation shows elapsed time instead of looking frozen.
 */
const ToolActivityStatusLine: React.FC<{ activity: CoworkToolActivity }> = ({ activity }) => {
  const [firstSeen, setFirstSeen] = React.useState({
    toolCallId: activity.toolCallId,
    at: activity.updatedAt,
  });
  if (firstSeen.toolCallId !== activity.toolCallId) {
    setFirstSeen({ toolCallId: activity.toolCallId, at: activity.updatedAt });
  }
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const statusText = getExecutionStatusText(getToolActivityExecutionStatus(activity));
  const elapsedSeconds = Math.max(0, Math.floor((now - firstSeen.at) / 1000));

  return (
    <p role="status" className="text-sm text-muted-foreground">
      {statusText}
      {elapsedSeconds > 0 &&
        ` · ${i18nService.t('coworkWorkingElapsed').replace('{seconds}', String(elapsedSeconds))}`}
    </p>
  );
};

const TurnBlockComponent: React.FC<{
  turn: ConversationTurn;
  artifacts?: Artifact[];
  resolveLocalFilePath?: (href: string, text: string) => string | null;
  mapDisplayText?: (value: string) => string;
  showTypingIndicator?: boolean;
  showCopyButtons?: boolean;
  isTurnComplete?: boolean;
  toolActivities?: CoworkToolActivity[];
  recoverableTaskId?: string | null;
  resumeTaskId?: string | null;
  resumeDisabled?: boolean;
  onResumeTask?: (interruption: CoworkSessionInterruption) => void;
  hideDefaultAssistantHeader?: boolean;
  pendingPermission?: CoworkPermissionRequest | null;
  onRespondToPermission?: (result: CoworkPermissionResult) => void;
  /** Expand long tool results fully for image export. */
  expandToolResults?: boolean;
  beforeCopySlot?: React.ReactNode;
}> = ({
  turn,
  artifacts,
  resolveLocalFilePath,
  mapDisplayText,
  showTypingIndicator = false,
  showCopyButtons = true,
  isTurnComplete = true,
  toolActivities = [],
  recoverableTaskId,
  resumeTaskId,
  resumeDisabled = false,
  onResumeTask,
  hideDefaultAssistantHeader = false,
  pendingPermission = null,
  onRespondToPermission,
  expandToolResults = false,
  beforeCopySlot = null,
}) => {
  const items = getVisibleAssistantItems(turn.assistantItems);
  const primaryExpert = getTurnPrimaryExpert(turn);
  const pendingToolGroup =
    pendingPermission && onRespondToPermission
      ? findToolGroupForPermission(items, pendingPermission)
      : null;
  const finalAnswerIndex = getFinalAnswerIndex(items, isTurnComplete);

  const renderSystemMessage = (message: CoworkMessage) => {
    const interruption = message.metadata?.interruption as CoworkSessionInterruption | undefined;
    const isError = isCoworkTerminalErrorMessage(message);
    const errorKind = message.metadata?.errorKind as CoworkErrorKind | undefined;
    const key = isError && errorKind ? getUserErrorI18nKey(errorKind) : null;
    const raw = interruption
      ? getInterruptionMessage(interruption)
      : key
        ? i18nService.t(key)
        : hasText(message.content)
          ? message.content
          : typeof message.metadata?.error === 'string'
            ? message.metadata.error
            : '';
    const normalized = getScheduledReminderDisplayText(raw) ?? raw;
    const content = mapDisplayText ? mapDisplayText(normalized) : normalized;
    if (!content.trim()) return null;
    const canResume = Boolean(
      interruption?.recoverable && interruption.taskId && interruption.taskId === recoverableTaskId,
    );
    return (
      <Alert key={message.id}>
        {isError ? <TriangleAlert /> : <Info />}
        <AlertDescription className="flex flex-wrap items-center gap-2">
          <span className="whitespace-pre-wrap">{content}</span>
          {canResume && interruption && onResumeTask && (
            <Button
              type="button"
              size="sm"
              disabled={resumeDisabled || resumeTaskId === interruption.taskId}
              onClick={() => onResumeTask(interruption)}
            >
              {i18nService.t('coworkResumeTaskAction')}
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  };

  const renderItem = (item: AssistantTurnItem, index: number) => {
    if (item.type === CoworkMessageType.Assistant && item.message.metadata?.isThinking) {
      const { durationSeconds, isComplete, isStreaming } = getThinkingPresentation(
        item.message.metadata,
        isTurnComplete,
        hasText(item.message.content),
      );
      const content = mapDisplayText ? mapDisplayText(item.message.content) : item.message.content;
      return (
        <PersistentReasoning
          key={item.message.id}
          persistKey={`reasoning-${item.message.id}`}
          isStreaming={isStreaming}
          defaultOpen={false}
          autoClose={false}
          duration={durationSeconds}
        >
          <ReasoningTrigger
            getThinkingMessage={() =>
              i18nService
                .t(
                  isComplete
                    ? durationSeconds
                      ? 'localInferenceThoughtForSeconds'
                      : 'codingAgentReasoningComplete'
                    : isStreaming
                      ? 'codingAgentReasoningActive'
                      : 'reasoning',
                )
                .replace('{seconds}', String(durationSeconds ?? 0))
            }
          />
          <ReasoningContent>{content}</ReasoningContent>
        </PersistentReasoning>
      );
    }
    if (item.type === CoworkDisplayItemType.ToolGroup) {
      const isPendingTool = pendingToolGroup?.toolUse.id === item.group.toolUse.id;
      return (
        <ToolCard
          key={item.group.toolUse.id}
          group={item.group}
          mapDisplayText={mapDisplayText}
          forceExpand={expandToolResults}
          pendingPermission={isPendingTool ? pendingPermission : null}
          onRespondToPermission={isPendingTool ? onRespondToPermission : undefined}
        />
      );
    }
    if (item.type === CoworkMessageType.ToolResult) {
      const raw = getToolResultDisplay(item.message);
      const content = mapDisplayText ? mapDisplayText(raw) : raw;
      const isError = Boolean(item.message.metadata?.isError || item.message.metadata?.error);
      return (
        <ToolOutput
          key={item.message.id}
          output={isError ? undefined : content}
          errorText={isError ? content || i18nService.t('coworkToolNoErrorDetail') : undefined}
        />
      );
    }
    if (item.type === CoworkMessageType.System) return renderSystemMessage(item.message);
    if (item.type === CoworkMessageType.Assistant && hasText(item.message.content)) {
      return (
        <AssistantBubble
          key={item.message.id}
          message={item.message}
          resolveLocalFilePath={resolveLocalFilePath}
          mapDisplayText={mapDisplayText}
          turnMetadata={
            showCopyButtons && index === finalAnswerIndex ? item.message.metadata : undefined
          }
        />
      );
    }
    return null;
  };

  const latestActivity = toolActivities[toolActivities.length - 1];
  // Tool owns its status once the call reaches the message stream.
  const hasActiveTool = items.some(
    item => item.type === CoworkDisplayItemType.ToolGroup && !item.group.toolResult,
  );
  const showTransportStatus = Boolean(!isTurnComplete && latestActivity && !hasActiveTool);
  const deliverables =
    artifacts?.filter(
      artifact => artifact.role === ArtifactRole.Deliverable && artifact.declared,
    ) ?? [];
  const copyContent = showCopyButtons
    ? [...items]
        .reverse()
        .find(
          item =>
            item.type === CoworkMessageType.Assistant &&
            !item.message.metadata?.isThinking &&
            hasText(item.message.content),
        )
    : undefined;

  return (
    <div className="py-2">
      <div className="mx-auto w-full max-w-6xl min-w-[320px] pl-4">
        <div className="flex min-w-0 flex-col gap-3 py-3">
          {primaryExpert ? (
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ExpertAvatar
                name={primaryExpert.presetId}
                label={primaryExpert.expertName}
                className="size-7 rounded-full border-0"
              />
              <span className="truncate">{primaryExpert.expertName}</span>
            </div>
          ) : !hideDefaultAssistantHeader ? (
            <span className="text-sm font-semibold">{i18nService.t('cowork')}</span>
          ) : null}
          {items.map(renderItem)}
          {showTransportStatus && latestActivity && (
            <ToolActivityStatusLine activity={latestActivity} />
          )}
          {showTypingIndicator && !isTurnComplete && <WorkingIndicator />}
          {(deliverables.length > 0 || copyContent || beforeCopySlot) && (
            <div className="flex flex-col gap-1">
              {deliverables.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {deliverables.map(artifact => (
                    <ArtifactPreviewCard key={artifact.id} artifact={artifact} />
                  ))}
                </div>
              )}
              {beforeCopySlot}
              {copyContent?.type === CoworkMessageType.Assistant && (
                <div className="flex items-center gap-1">
                  <CopyButton content={copyContent.message.content} visible />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const TurnBlock = React.memo(TurnBlockComponent);
