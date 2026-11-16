import { MessageActions } from '@shared/components/conversation';
import { Alert, AlertDescription } from '@shared/components/ui/alert';
import { Button } from '@shared/components/ui/button';
import { Check, Copy, Info, TriangleAlert } from 'lucide-react';
import React, { useCallback, useState } from 'react';

import { type CoworkErrorKind, getUserErrorI18nKey } from '../../../../common/coworkError';
import { getScheduledReminderDisplayText } from '../../../../scheduledTask/reminderText';
import {
  CoworkInterruptionCause,
  type CoworkSessionInterruption,
} from '../../../../shared/cowork/interruption';
import { i18nService } from '../../../services/i18n';
import type { CoworkMessage, CoworkPermissionResult } from '../../../types/cowork';
import type { Skill } from '../../../types/skill';
import ArtifactPreviewCard from '../../artifacts/ArtifactPreviewCard';
import { ExpertAvatar } from '../../expert/expertAvatars';
import AskUserQuestionCard from '../../cowork/AskUserQuestionCard';
import { WorkingIndicator } from '../../cowork/components/WorkingIndicator';
import type { ConversationTurn, NoticeTurnPart, ToolTurnPart } from '../model/types';
import { getToolDisplayName, getToolInputSummary } from '../tools/toolFormatters';
import { ToolGroupView } from '../tools/ToolGroupView';
import { ToolPartView } from '../tools/ToolPartView';
import { AssistantTextPartView } from './AssistantTextPartView';
import { ThinkingPartView } from './ThinkingPartView';
import { UserPromptBubble } from './UserPromptBubble';

interface TurnViewProps {
  turn: ConversationTurn;
  skills: Skill[];
  cwd?: string;
  forceExpand?: boolean;
  isExporting?: boolean;
  onReEdit?: (message: CoworkMessage) => void;
  onRespondToPermission?: (result: CoworkPermissionResult) => void | Promise<void>;
  onRespondToQuestion?: (result: CoworkPermissionResult) => void | Promise<void>;
}

const getInterruptionLabel = (interruption: CoworkSessionInterruption): string => {
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

const NoticePartView: React.FC<{ part: NoticeTurnPart }> = ({ part }) => {
  const errorKind = part.message.metadata?.errorKind as CoworkErrorKind | undefined;
  const key = part.isError && errorKind ? getUserErrorI18nKey(errorKind) : null;
  const raw = part.interruption
    ? getInterruptionLabel(part.interruption)
    : key
      ? i18nService.t(key)
      : part.message.content.trim()
        ? part.message.content
        : typeof part.message.metadata?.error === 'string'
          ? part.message.metadata.error
          : '';
  const text = getScheduledReminderDisplayText(raw) ?? raw;
  if (!text.trim()) return null;

  return (
    <Alert>
      {part.isError ? <TriangleAlert /> : <Info />}
      <AlertDescription className="flex flex-wrap items-center gap-2">
        <span className="whitespace-pre-wrap">{text}</span>
      </AlertDescription>
    </Alert>
  );
};

const CopyResponseButton: React.FC<{ content: string }> = ({ content }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Ignore clipboard denial in non-focused environments.
    }
  }, [content]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={i18nService.t('copy')}
      title={i18nService.t('copy')}
      onClick={() => void handleCopy()}
    >
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </Button>
  );
};

type BottomActivityState =
  | { kind: 'initial' }
  | { kind: 'waiting'; resetKey: string }
  | { kind: 'tool'; tool: ToolTurnPart };

const resolveBottomActivity = (turn: ConversationTurn): BottomActivityState | null => {
  if (!turn.isStreaming || turn.hasApproval) return null;
  if (turn.parts.length === 0) return { kind: 'initial' };

  let activeTool: ToolTurnPart | null = null;
  for (const part of turn.parts) {
    if (part.kind === 'tool') {
      if (part.phase === 'input-streaming' || part.phase === 'running') {
        activeTool = part;
      }
    } else if (part.kind === 'tool_group') {
      for (const nested of part.parts) {
        if (nested.phase === 'input-streaming' || nested.phase === 'running') {
          activeTool = nested;
        }
      }
    }
  }
  if (activeTool) return { kind: 'tool', tool: activeTool };

  const lastPart = turn.parts[turn.parts.length - 1];
  if (lastPart?.kind === 'reasoning' && lastPart.isStreaming) return null;
  if (lastPart?.kind === 'text' && lastPart.isStreaming && lastPart.message.content.trim()) {
    return null;
  }

  return { kind: 'waiting', resetKey: `${turn.id}:${lastPart?.id ?? 'tail'}` };
};

const renderBottomActivity = (activity: BottomActivityState | null): React.ReactNode => {
  if (!activity) return null;
  if (activity.kind === 'initial') return <WorkingIndicator />;
  if (activity.kind === 'waiting') {
    return (
      <WorkingIndicator
        statusLabel={i18nService.t('coworkRunWaiting')}
        showElapsedImmediately
        resetKey={activity.resetKey}
      />
    );
  }
  const { tool } = activity;
  const actionLabel =
    tool.category === 'file-write'
      ? i18nService.t('coworkExecutionWrite')
      : tool.category === 'file-read'
        ? i18nService.t('coworkExecutionRead')
        : tool.category === 'shell'
          ? i18nService.t('coworkExecutionCommand')
          : tool.category === 'search'
            ? i18nService.t('coworkExecutionSearch')
            : i18nService.t('coworkExecutionTool');
  const displayName = getToolDisplayName(tool.toolName);
  const statusLabel =
    tool.category === 'other' ||
    tool.category === 'mcp' ||
    tool.category === 'python' ||
    tool.category === 'skill'
      ? `${actionLabel} ${displayName}`
      : `${actionLabel} (${displayName})`;
  const summary = getToolInputSummary(tool.toolName, tool.input);
  const charsText =
    tool.phase === 'input-streaming' && tool.progress?.argsChars
      ? i18nService
          .t('coworkExecutionGeneratedChars')
          .replace('{chars}', tool.progress.argsChars.toLocaleString())
      : null;
  const detailLabel = [summary, charsText].filter(Boolean).join(' · ') || undefined;

  return (
    <WorkingIndicator
      statusLabel={statusLabel}
      detailLabel={detailLabel}
      showElapsedImmediately
      resetKey={`${tool.toolCallId}:${tool.phase}`}
    />
  );
};

/**
 * Renders one user+assistant turn in normal DOM order with `content-visibility: auto`
 * on settled turns (bypassed for active streaming turns and long-screenshot export).
 */
export const TurnView: React.FC<TurnViewProps> = React.memo(
  ({
    turn,
    skills,
    cwd,
    forceExpand = false,
    isExporting = false,
    onReEdit,
    onRespondToPermission,
    onRespondToQuestion,
  }) => {
    const primaryExpert = turn.experts[0];
    const bottomActivity = resolveBottomActivity(turn);
    const hasAssistantBody =
      turn.parts.length > 0 ||
      turn.deliverables.length > 0 ||
      turn.isStreaming ||
      Boolean(primaryExpert);

    return (
      <section
        data-turn-id={turn.id}
        data-turn-index={turn.index}
        style={
          !isExporting && !turn.isStreaming
            ? { contentVisibility: 'auto', containIntrinsicSize: 'auto 280px' }
            : undefined
        }
      >
        {turn.userMessage ? (
          <UserPromptBubble message={turn.userMessage} skills={skills} onReEdit={onReEdit} />
        ) : null}

        {hasAssistantBody ? (
          <div data-export-role="assistant-block" className="group/turn py-2">
            <div className="mx-auto w-full max-w-4xl min-w-[320px]">
              <div className="flex min-w-0 flex-col gap-3 py-2">
                {primaryExpert ? (
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <ExpertAvatar
                      name={primaryExpert.presetId}
                      label={primaryExpert.expertName}
                      className="size-7 rounded-full border-0"
                    />
                    <span className="truncate">{primaryExpert.expertName}</span>
                  </div>
                ) : null}

                {turn.parts.map(part => {
                  switch (part.kind) {
                    case 'reasoning':
                      return <ThinkingPartView key={part.id} part={part} />;
                    case 'text':
                      return <AssistantTextPartView key={part.id} part={part} cwd={cwd} />;
                    case 'tool':
                      return (
                        <ToolPartView
                          key={part.id}
                          part={part}
                          forceExpand={forceExpand}
                          onRespondToPermission={onRespondToPermission}
                        />
                      );
                    case 'tool_group':
                      return <ToolGroupView key={part.id} group={part} forceExpand={forceExpand} />;
                    case 'question':
                      return onRespondToQuestion ? (
                        <AskUserQuestionCard
                          key={part.id}
                          permission={part.permission}
                          onRespond={onRespondToQuestion}
                        />
                      ) : null;
                    case 'notice':
                      return <NoticePartView key={part.id} part={part} />;
                    default:
                      return null;
                  }
                })}

                {renderBottomActivity(bottomActivity)}

                {turn.deliverables.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {turn.deliverables.map(artifact => (
                      <ArtifactPreviewCard key={artifact.id} artifact={artifact} />
                    ))}
                  </div>
                ) : null}

                {turn.copyText ? (
                  <MessageActions align="start" visible={forceExpand}>
                    <CopyResponseButton content={turn.copyText} />
                  </MessageActions>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </section>
    );
  },
);

TurnView.displayName = 'TurnView';
