import {
  CoworkToolActivityPhase,
  type CoworkToolActivity,
} from '../../../../shared/cowork/toolActivity';
import type { CoworkSessionInterruption } from '../../../../shared/cowork/interruption';
import { toThinkingDurationSeconds } from '../../../../common/thinkingDuration';
import { isCoworkTerminalErrorMessage } from '../../../services/coworkTerminalError';
import { ArtifactRole, type Artifact } from '../../../types/artifact';
import type {
  CoworkMessage,
  CoworkMessageMetadata,
  CoworkPermissionRequest,
} from '../../../types/cowork';
import { getToolResultDisplay } from '../tools/toolFormatters';
import type { ConversationTurn, ToolCategory, ToolPhase, ToolTurnPart, TurnPart } from './types';

interface ToolClassification {
  category: ToolCategory;
  readOnly: boolean;
}

function classifyTool(toolName: string): ToolClassification {
  const normalized = toolName.trim().toLowerCase();
  if (normalized.startsWith('mcp__')) return { category: 'mcp', readOnly: false };
  switch (normalized) {
    case 'bash':
    case 'exec':
    case 'shell':
      return { category: 'shell', readOnly: false };
    case 'read':
    case 'read_file':
      return { category: 'file-read', readOnly: true };
    case 'grep':
    case 'find':
    case 'glob':
    case 'ls':
      return { category: 'search', readOnly: true };
    case 'write':
    case 'edit':
    case 'multiedit':
      return { category: 'file-write', readOnly: false };
    case 'web_search':
    case 'websearch':
    case 'web_fetch':
    case 'webfetch':
      return { category: 'web', readOnly: true };
    case 'python_execute':
    case 'python_install':
      return { category: 'python', readOnly: false };
    case 'run_skill_script':
      return { category: 'skill', readOnly: false };
    default:
      return { category: 'other', readOnly: false };
  }
}

const getModelLabel = (metadata?: CoworkMessageMetadata | null): string | null => {
  const model = typeof metadata?.model === 'string' ? metadata.model.trim() : '';
  if (!model) return null;
  return model.includes('/') ? model.split('/').pop() || model : model;
};

const keepLatestInterruption = (messages: readonly CoworkMessage[]): CoworkMessage[] => {
  let latestIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.metadata?.interruption) {
      latestIndex = i;
      break;
    }
  }
  if (latestIndex < 0) return messages as CoworkMessage[];
  return messages.filter((msg, idx) => !msg.metadata?.interruption || idx === latestIndex);
};

const matchPermissionToTool = (
  parts: TurnPart[],
  permission: CoworkPermissionRequest,
): ToolTurnPart | null => {
  const toolParts = parts.filter((p): p is ToolTurnPart => p.kind === 'tool');
  const permId = permission.toolUseId?.trim() ?? '';
  const permName = permission.toolName.trim().toLowerCase();
  const permCommand =
    typeof permission.toolInput?.command === 'string' ? permission.toolInput.command.trim() : '';

  for (const part of toolParts) {
    if (part.phase === 'output-available' || part.phase === 'output-error') continue;
    if (permId && part.toolCallId === permId) return part;
    if (part.toolName.toLowerCase() === permName && permCommand) {
      const cmd = typeof part.input?.command === 'string' ? part.input.command.trim() : '';
      if (cmd && cmd === permCommand) return part;
    }
  }

  const sameNameOpen = toolParts.filter(
    part =>
      part.phase !== 'output-available' &&
      part.phase !== 'output-error' &&
      part.toolName.toLowerCase() === permName,
  );
  return sameNameOpen.length === 1 ? sameNameOpen[0] : null;
};

const groupConsecutiveReadOnlyTools = (parts: TurnPart[]): TurnPart[] => {
  const result: TurnPart[] = [];
  let buffer: ToolTurnPart[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    if (buffer.length === 1) {
      result.push(buffer[0]);
    } else {
      result.push({
        kind: 'tool_group',
        id: `group:${buffer[0].id}`,
        parts: buffer,
      });
    }
    buffer = [];
  };

  for (const part of parts) {
    const groupable =
      part.kind === 'tool' &&
      part.readOnly &&
      part.phase !== 'approval-requested' &&
      part.phase !== 'output-error' &&
      part.phase !== 'output-denied';
    if (groupable) {
      buffer.push(part);
    } else {
      flush();
      result.push(part);
    }
  }
  flush();
  return result;
};

export interface ProjectTurnsInput {
  messages: readonly CoworkMessage[];
  toolActivities: readonly CoworkToolActivity[];
  pendingPermission?: CoworkPermissionRequest | null;
  inlineQuestionPermission?: CoworkPermissionRequest | null;
  artifacts: readonly Artifact[];
  previewableTypes: ReadonlySet<string>;
  isStreaming: boolean;
}

export interface ProjectTurnsResult {
  turns: ConversationTurn[];
  unmatchedPermission: CoworkPermissionRequest | null;
}

export function projectSessionToTurns({
  messages,
  toolActivities,
  pendingPermission = null,
  inlineQuestionPermission = null,
  artifacts,
  previewableTypes,
  isStreaming,
}: ProjectTurnsInput): ProjectTurnsResult {
  const cleaned = keepLatestInterruption(messages);
  const rawTurns: Array<{
    id: string;
    userMessage: CoworkMessage | null;
    parts: TurnPart[];
    messageIds: Set<string>;
    toolCallIds: Set<string>;
    toolPartsByCallId: Map<string, ToolTurnPart>;
    openTools: ToolTurnPart[];
  }> = [];

  const ensureTurn = (fallbackId: string) => {
    const last = rawTurns[rawTurns.length - 1];
    if (last) return last;
    const orphan = {
      id: `orphan:${fallbackId}`,
      userMessage: null,
      parts: [],
      messageIds: new Set<string>(),
      toolCallIds: new Set<string>(),
      toolPartsByCallId: new Map<string, ToolTurnPart>(),
      openTools: [],
    };
    rawTurns.push(orphan);
    return orphan;
  };

  for (const message of cleaned) {
    if (message.type === 'user') {
      rawTurns.push({
        id: message.id,
        userMessage: message,
        parts: [],
        messageIds: new Set([message.id]),
        toolCallIds: new Set(),
        toolPartsByCallId: new Map(),
        openTools: [],
      });
      continue;
    }

    const turn = ensureTurn(message.id);
    turn.messageIds.add(message.id);

    if (message.type === 'tool_use') {
      const toolName =
        typeof message.metadata?.toolName === 'string' && message.metadata.toolName.trim()
          ? message.metadata.toolName.trim()
          : 'Tool';
      const toolCallId =
        typeof message.metadata?.toolUseId === 'string' && message.metadata.toolUseId.trim()
          ? message.metadata.toolUseId.trim()
          : message.id;
      const classification = classifyTool(toolName);
      const part: ToolTurnPart = {
        kind: 'tool',
        id: `tool:${toolCallId}`,
        toolCallId,
        toolName,
        category: classification.category,
        readOnly: classification.readOnly,
        input: message.metadata?.toolInput,
        phase: 'running',
        isError: false,
        startedAt: message.timestamp,
      };
      turn.parts.push(part);
      turn.toolCallIds.add(toolCallId);
      turn.toolPartsByCallId.set(toolCallId, part);
      turn.openTools.push(part);
      continue;
    }

    if (message.type === 'tool_result') {
      const toolCallId =
        typeof message.metadata?.toolUseId === 'string' && message.metadata.toolUseId.trim()
          ? message.metadata.toolUseId.trim()
          : '';
      const target =
        (toolCallId ? turn.toolPartsByCallId.get(toolCallId) : undefined) ??
        turn.openTools.find(candidate => candidate.phase === 'running');
      const output = getToolResultDisplay(message);
      const isError = Boolean(message.metadata?.isError || message.metadata?.error);
      const phase: ToolPhase = isError ? 'output-error' : 'output-available';
      if (target) {
        target.phase = phase;
        target.output = output;
        target.isError = isError;
        target.contentTruncated = Boolean(message.metadata?.contentTruncated);
        target.updatedAt = message.timestamp;
        const openIdx = turn.openTools.indexOf(target);
        if (openIdx >= 0) turn.openTools.splice(openIdx, 1);
      } else {
        const classification = classifyTool(
          typeof message.metadata?.toolName === 'string' ? message.metadata.toolName : 'Tool',
        );
        turn.parts.push({
          kind: 'tool',
          id: `tool:${message.id}`,
          toolCallId: toolCallId || message.id,
          toolName:
            typeof message.metadata?.toolName === 'string' ? message.metadata.toolName : 'Tool',
          category: classification.category,
          readOnly: classification.readOnly,
          phase,
          output,
          contentTruncated: Boolean(message.metadata?.contentTruncated),
          isError,
          updatedAt: message.timestamp,
        });
      }
      continue;
    }

    if (message.type === 'system') {
      const interruption = message.metadata?.interruption as CoworkSessionInterruption | undefined;
      if (interruption) {
        for (const openTool of turn.openTools) {
          openTool.phase = 'output-error';
          openTool.isError = true;
          openTool.output = openTool.output ?? '';
        }
        turn.openTools.length = 0;
      }
      turn.parts.push({
        kind: 'notice',
        id: `notice:${message.id}`,
        message,
        isError: isCoworkTerminalErrorMessage(message),
        interruption,
      });
      continue;
    }

    if (message.type === 'assistant') {
      if (message.metadata?.isThinking) {
        turn.parts.push({
          kind: 'reasoning',
          id: `reasoning:${message.id}`,
          message,
          isStreaming: Boolean(message.metadata?.isStreaming) && !message.metadata?.isFinal,
          isComplete: Boolean(message.metadata?.isFinal),
          durationSeconds: toThinkingDurationSeconds(message.metadata?.thinkingDurationMs),
        });
      } else if (message.content.trim().length > 0 || message.metadata?.isStreaming) {
        turn.parts.push({
          kind: 'text',
          id: `text:${message.id}`,
          message,
          isStreaming: Boolean(message.metadata?.isStreaming),
          isFinalAnswer: Boolean(message.metadata?.isFinalAnswer),
        });
      }
    }
  }

  // Merge in-flight pre-call tool activities onto the active last turn without creating a separate UI track.
  if (isStreaming && toolActivities.length > 0) {
    const activeTurn = ensureTurn('streaming');
    for (const activity of toolActivities) {
      if (activeTurn.toolPartsByCallId.has(activity.toolCallId)) {
        const existing = activeTurn.toolPartsByCallId.get(activity.toolCallId)!;
        if (existing.phase === 'running' && activity.progress) {
          existing.progress = activity.progress;
        }
        continue;
      }
      const resolvedToolName = activity.toolName ?? 'tool';
      const classification = classifyTool(resolvedToolName);
      const part: ToolTurnPart = {
        kind: 'tool',
        id: `tool:${activity.toolCallId}`,
        toolCallId: activity.toolCallId,
        toolName: resolvedToolName,
        category: classification.category,
        readOnly: classification.readOnly,
        input: activity.toolInput,
        phase: activity.phase === CoworkToolActivityPhase.Preparing ? 'input-streaming' : 'running',
        progress: activity.progress,
        isError: false,
        startedAt: activity.updatedAt,
        updatedAt: activity.updatedAt,
      };
      activeTurn.parts.push(part);
      activeTurn.toolCallIds.add(activity.toolCallId);
      activeTurn.toolPartsByCallId.set(activity.toolCallId, part);
    }
  }

  // Bind pending permission directly into the matching tool part on the active turn.
  let unmatchedPermission: CoworkPermissionRequest | null = null;
  if (pendingPermission && rawTurns.length > 0) {
    const lastTurn = rawTurns[rawTurns.length - 1];
    const matched = matchPermissionToTool(lastTurn.parts, pendingPermission);
    if (matched) {
      matched.phase = 'approval-requested';
      matched.pendingPermission = pendingPermission;
    } else {
      unmatchedPermission = pendingPermission;
    }
  } else if (pendingPermission) {
    unmatchedPermission = pendingPermission;
  }

  if (inlineQuestionPermission) {
    const activeTurn = ensureTurn(`question:${inlineQuestionPermission.requestId}`);
    activeTurn.parts.push({
      kind: 'question',
      id: `question:${inlineQuestionPermission.requestId}`,
      permission: inlineQuestionPermission,
    });
  }

  const turns: ConversationTurn[] = rawTurns.map((raw, index) => {
    const isLastTurn = index === rawTurns.length - 1;
    const turnIsStreaming = isStreaming && isLastTurn;
    const turnIsComplete = !turnIsStreaming;

    // Settle streaming state on completed turns cleanly, while honoring streamReopen on the active last turn.
    const settledParts = raw.parts.map(part => {
      if (part.kind === 'reasoning') {
        const partStreaming = isLastTurn
          ? Boolean(part.message.metadata?.isStreaming) &&
            (isStreaming || Boolean(part.message.metadata?.isStreaming))
          : false;
        return {
          ...part,
          isStreaming: partStreaming,
          isComplete: part.isComplete || (turnIsComplete && !partStreaming),
        };
      }
      if (part.kind === 'text') {
        return {
          ...part,
          isStreaming: isLastTurn ? Boolean(part.message.metadata?.isStreaming) : false,
        };
      }
      return part;
    });

    const groupedParts = groupConsecutiveReadOnlyTools(settledParts);
    const deliverables = artifacts.filter(
      artifact =>
        artifact.role === ArtifactRole.Deliverable &&
        artifact.declared &&
        previewableTypes.has(artifact.type) &&
        (raw.messageIds.has(artifact.messageId) ||
          (artifact.toolCallId ? raw.toolCallIds.has(artifact.toolCallId) : false)),
    );

    const lastTextPart = [...groupedParts]
      .reverse()
      .find(
        (part): part is Extract<TurnPart, { kind: 'text' }> =>
          part.kind === 'text' && part.message.content.trim().length > 0,
      );

    const experts = Array.isArray(raw.userMessage?.metadata?.experts)
      ? raw.userMessage.metadata.experts
      : [];

    const hasApproval = groupedParts.some(
      part =>
        (part.kind === 'tool' && part.phase === 'approval-requested') || part.kind === 'question',
    );
    const hasError = groupedParts.some(
      part => (part.kind === 'tool' && part.isError) || (part.kind === 'notice' && part.isError),
    );

    return {
      id: raw.id,
      index,
      userMessage: raw.userMessage,
      parts: groupedParts,
      deliverables,
      copyText: lastTextPart ? lastTextPart.message.content : null,
      experts,
      isStreaming: turnIsStreaming,
      isComplete: turnIsComplete,
      hasApproval,
      hasError,
      modelLabel:
        getModelLabel(lastTextPart?.message.metadata) ?? getModelLabel(raw.userMessage?.metadata),
      timestamp: lastTextPart?.message.timestamp ?? raw.userMessage?.timestamp ?? null,
    };
  });

  return { turns, unmatchedPermission };
}
