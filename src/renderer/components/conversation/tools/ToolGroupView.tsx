import { Shimmer } from '@shared/components/ai-elements/shimmer';
import { ToolState } from '@shared/components/ai-elements/constants';
import { Steps, StepsContent, StepsItem, StepsTrigger } from '@shared/components/conversation';
import { Badge } from '@shared/components/ui/badge';
import { CheckCircle2, Clock, Layers, XCircle } from 'lucide-react';
import React, { useEffect, useRef } from 'react';

import { i18nService } from '../../../services/i18n';
import { useLiveMessageText } from '../../../services/useLiveMessageText';
import type { CoworkPermissionResult } from '../../../types/cowork';
import { usePersistentToggle } from '../../cowork/hooks/usePersistentToggle';
import type { ActivityGroupItemPart, ToolGroupTurnPart } from '../model/types';
import { ThinkingPartView } from '../thread/ThinkingPartView';
import {
  getToolCategoryActionLabel,
  getToolDisplayName,
  getToolInputSummary,
} from './toolFormatters';
import { ToolPartView } from './ToolPartView';

export interface ToolGroupViewProps {
  group: ToolGroupTurnPart;
  forceExpand?: boolean;
  onRespondToPermission?: (result: CoworkPermissionResult) => void | Promise<void>;
}

const isPartActive = (part: ActivityGroupItemPart): boolean => {
  if (part.kind === 'reasoning') return part.isStreaming;
  return (
    part.phase === 'approval-requested' ||
    part.phase === 'running' ||
    part.phase === 'input-streaming'
  );
};

const findTargetPart = (parts: readonly ActivityGroupItemPart[]): ActivityGroupItemPart => {
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (isPartActive(parts[i])) return parts[i];
  }
  return parts[parts.length - 1];
};

const getFirstNonEmptyLine = (text: string): string | null => {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
  }
  return null;
};

/**
 * Collapses contiguous reasoning and tool parts into a compact Steps timeline
 * inspired by assistant-ui GroupedParts and prompt-kit Steps. Collapsed by
 * default; auto-expands on error (while remaining collapsible) and locks open
 * when awaiting permission or during export.
 */
export const ToolGroupView: React.FC<ToolGroupViewProps> = React.memo(
  ({ group, forceExpand = false, onRespondToPermission }) => {
    const [open, setOpen] = usePersistentToggle(`tool-group:${group.id}`, group.hasError);
    const prevHasErrorRef = useRef(group.hasError);
    useEffect(() => {
      const hadError = prevHasErrorRef.current;
      prevHasErrorRef.current = group.hasError;
      if (!hadError && group.hasError) {
        setOpen(true);
      }
    }, [group.hasError, setOpen]);

    const lockedOpen = forceExpand || group.hasApproval;
    const isOpen = lockedOpen || open;

    const targetPart = findTargetPart(group.parts);
    const liveThinkingText = useLiveMessageText(
      targetPart.kind === 'reasoning' ? targetPart.message.id : '',
      targetPart.kind === 'reasoning' && targetPart.isStreaming,
    );

    const hasReasoning = group.parts.some(part => part.kind === 'reasoning');
    const isRunning = group.parts.some(part =>
      part.kind === 'reasoning'
        ? part.isStreaming
        : part.phase === 'running' || part.phase === 'input-streaming',
    );
    const badgeState: ToolState = group.hasApproval
      ? ToolState.ApprovalRequested
      : isRunning
        ? ToolState.InputAvailable
        : group.hasError
          ? ToolState.OutputError
          : ToolState.OutputAvailable;

    let title: string;
    let summary: string | null;
    if (targetPart.kind === 'reasoning') {
      title = i18nService.t(
        targetPart.isStreaming ? 'codingAgentReasoningActive' : 'codingAgentReasoningComplete',
      );
      const rawThinking =
        (targetPart.isStreaming ? liveThinkingText : undefined) ?? targetPart.message.content ?? '';
      summary = getFirstNonEmptyLine(rawThinking);
    } else {
      const isToolRunning =
        targetPart.phase === 'running' || targetPart.phase === 'input-streaming';
      title = isToolRunning
        ? getToolCategoryActionLabel(targetPart.category)
        : getToolDisplayName(targetPart.toolName);
      summary = getToolInputSummary(targetPart.toolName, targetPart.input);
    }

    const stepCountLabel = i18nService
      .t('coworkActivityGroupSteps')
      .replace('{count}', String(group.parts.length));
    const statusLabel = group.hasApproval
      ? i18nService.t('codingAgentPermissionEvent')
      : isRunning
        ? i18nService.t('codingAgentToolRunning')
        : group.hasError
          ? i18nService.t('codingAgentToolFailed')
          : i18nService.t('codingAgentToolCompleted');

    const leftIcon = group.hasApproval ? (
      <Clock className="theme-conversation-icon" />
    ) : isRunning ? (
      <Layers className="theme-conversation-icon" />
    ) : group.hasError ? (
      <XCircle className="theme-conversation-icon" />
    ) : (
      <CheckCircle2 className="theme-conversation-icon" />
    );

    return (
      <Steps
        open={isOpen}
        onOpenChange={next => {
          if (!lockedOpen) setOpen(next);
        }}
      >
        <StepsTrigger
          data-slot="tool"
          data-tool-state={badgeState}
          data-has-reasoning={hasReasoning ? 'true' : undefined}
          leftIcon={leftIcon}
          trailing={
            <Badge
              className="theme-chat-tool-status"
              variant="secondary"
              data-tool-state={badgeState}
            >
              {stepCountLabel} · {statusLabel}
            </Badge>
          }
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="theme-chat-tool-title shrink-0">
              {isRunning ? (
                <Shimmer as="span" duration={1.5}>
                  {title}
                </Shimmer>
              ) : (
                title
              )}
            </span>
            {summary ? (
              <span className="theme-chat-tool-summary min-w-0 flex-1 truncate" title={summary}>
                {summary}
              </span>
            ) : null}
          </span>
        </StepsTrigger>
        <StepsContent>
          {group.parts.map(part => (
            <StepsItem key={part.id}>
              {part.kind === 'reasoning' ? (
                <ThinkingPartView part={part} />
              ) : (
                <ToolPartView
                  part={part}
                  forceExpand={forceExpand}
                  onRespondToPermission={onRespondToPermission}
                />
              )}
            </StepsItem>
          ))}
        </StepsContent>
      </Steps>
    );
  },
);

ToolGroupView.displayName = 'ToolGroupView';
