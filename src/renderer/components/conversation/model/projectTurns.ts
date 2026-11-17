import { createSelector, lruMemoize } from '@reduxjs/toolkit';

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
import type {
  ActivityGroupItemPart,
  ConversationTurn,
  ToolCategory,
  ToolPhase,
  ToolTurnPart,
  TurnPart,
} from './types';

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

type PartGroupBy = (part: TurnPart) => readonly string[] | null;

/**
 * Ports `assistant-ui`'s `groupPartByType`: maps each part kind to synthetic
 * `"group-*"` keys (or `null` when standalone).
 */
export const groupPartByType = (
  mapping: Partial<Record<TurnPart['kind'], readonly string[]>>,
): PartGroupBy => {
  return part => mapping[part.kind] ?? null;
};

const defaultActivityGroupBy = groupPartByType({
  reasoning: ['group-activity'],
  tool: ['group-activity'],
});

const isGroupableActivityPart = (part: TurnPart): part is ActivityGroupItemPart =>
  part.kind === 'reasoning' || part.kind === 'tool';

/**
 * Coalesces contiguous ranges of reasoning and tool parts matching the same
 * `groupBy` key (1:1 with `assistant-ui` `GroupedParts`), unwrapping runs
 * shorter than `minGroupSize` (2) so isolated items render flat.
 */
export const groupContiguousActivityParts = (
  parts: TurnPart[],
  groupBy: PartGroupBy = defaultActivityGroupBy,
  minGroupSize = 2,
): TurnPart[] => {
  const result: TurnPart[] = [];
  let currentKey: string | null = null;
  let buffer: ActivityGroupItemPart[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    if (buffer.length < minGroupSize) {
      result.push(...buffer);
    } else {
      result.push({
        kind: 'tool_group',
        id: `group:${buffer[0].id}`,
        parts: buffer,
        hasError: buffer.some(item => item.kind === 'tool' && item.isError),
        hasApproval: buffer.some(
          item => item.kind === 'tool' && item.phase === 'approval-requested',
        ),
      });
    }
    currentKey = null;
    buffer = [];
  };

  for (const part of parts) {
    const rawKey = groupBy(part)?.[0] ?? null;
    const key = typeof rawKey === 'string' && rawKey.startsWith('group-') ? rawKey : null;
    if (key !== null && isGroupableActivityPart(part)) {
      if (currentKey === key) {
        buffer.push(part);
      } else {
        flush();
        currentKey = key;
        buffer = [part];
      }
      continue;
    }
    flush();
    result.push(part);
  }
  flush();
  return result;
};

interface DeliverableIndex {
  byMessageId: Map<string, Artifact[]>;
  byToolCallId: Map<string, Artifact[]>;
  orderById: Map<string, number>;
}

const buildDeliverableIndex = (
  artifacts: readonly Artifact[],
  previewableTypes: ReadonlySet<string>,
): DeliverableIndex => {
  const byMessageId = new Map<string, Artifact[]>();
  const byToolCallId = new Map<string, Artifact[]>();
  const orderById = new Map<string, number>();

  for (let i = 0; i < artifacts.length; i += 1) {
    const artifact = artifacts[i];
    if (
      artifact.role !== ArtifactRole.Deliverable ||
      !artifact.declared ||
      !previewableTypes.has(artifact.type)
    ) {
      continue;
    }
    orderById.set(artifact.id, i);
    if (artifact.messageId) {
      const list = byMessageId.get(artifact.messageId);
      if (list) list.push(artifact);
      else byMessageId.set(artifact.messageId, [artifact]);
    }
    if (artifact.toolCallId) {
      const list = byToolCallId.get(artifact.toolCallId);
      if (list) list.push(artifact);
      else byToolCallId.set(artifact.toolCallId, [artifact]);
    }
  }

  return { byMessageId, byToolCallId, orderById };
};

const EMPTY_DELIVERABLES: Artifact[] = [];

const collectTurnDeliverables = (
  messageIds: ReadonlySet<string>,
  toolCallIds: ReadonlySet<string>,
  index: DeliverableIndex,
): Artifact[] => {
  if (index.orderById.size === 0) return EMPTY_DELIVERABLES;
  const seen = new Set<string>();
  const collected: Artifact[] = [];

  for (const messageId of messageIds) {
    const items = index.byMessageId.get(messageId);
    if (!items) continue;
    for (const artifact of items) {
      if (!seen.has(artifact.id)) {
        seen.add(artifact.id);
        collected.push(artifact);
      }
    }
  }

  for (const toolCallId of toolCallIds) {
    const items = index.byToolCallId.get(toolCallId);
    if (!items) continue;
    for (const artifact of items) {
      if (!seen.has(artifact.id)) {
        seen.add(artifact.id);
        collected.push(artifact);
      }
    }
  }

  if (collected.length <= 1) return collected;
  collected.sort((a, b) => (index.orderById.get(a.id) ?? 0) - (index.orderById.get(b.id) ?? 0));
  return collected;
};

interface TurnMessageBucket {
  id: string;
  userMessage: CoworkMessage | null;
  ownMessages: CoworkMessage[];
  externalResults: CoworkMessage[];
  messageIds: Set<string>;
  toolCallIds: Set<string>;
}

/**
 * Partitions session messages into turn buckets while preserving cross-turn
 * correlation for steered tool results (`user -> tool_use(c1) -> user -> tool_result(c1)`).
 */
const partitionMessagesIntoTurnBuckets = (
  messages: readonly CoworkMessage[],
): TurnMessageBucket[] => {
  const cleaned = keepLatestInterruption(messages);
  const buckets: TurnMessageBucket[] = [];
  const originBucketByToolCallId = new Map<string, TurnMessageBucket>();

  const ensureBucket = (fallbackId: string): TurnMessageBucket => {
    const last = buckets[buckets.length - 1];
    if (last) return last;
    const orphan: TurnMessageBucket = {
      id: `orphan:${fallbackId}`,
      userMessage: null,
      ownMessages: [],
      externalResults: [],
      messageIds: new Set<string>(),
      toolCallIds: new Set<string>(),
    };
    buckets.push(orphan);
    return orphan;
  };

  for (const message of cleaned) {
    if (message.type === 'user') {
      const bucket: TurnMessageBucket = {
        id: message.id,
        userMessage: message,
        ownMessages: [],
        externalResults: [],
        messageIds: new Set([message.id]),
        toolCallIds: new Set(),
      };
      buckets.push(bucket);
      continue;
    }

    const currentBucket = ensureBucket(message.id);
    if (message.type === 'tool_use') {
      const toolCallId =
        typeof message.metadata?.toolUseId === 'string' && message.metadata.toolUseId.trim()
          ? message.metadata.toolUseId.trim()
          : message.id;
      currentBucket.ownMessages.push(message);
      currentBucket.messageIds.add(message.id);
      currentBucket.toolCallIds.add(toolCallId);
      originBucketByToolCallId.set(toolCallId, currentBucket);
      continue;
    }

    if (message.type === 'tool_result') {
      const toolCallId =
        typeof message.metadata?.toolUseId === 'string' && message.metadata.toolUseId.trim()
          ? message.metadata.toolUseId.trim()
          : '';
      const originBucket = toolCallId ? originBucketByToolCallId.get(toolCallId) : undefined;
      if (originBucket && originBucket !== currentBucket) {
        originBucket.externalResults.push(message);
        originBucket.messageIds.add(message.id);
        continue;
      }
    }

    currentBucket.ownMessages.push(message);
    currentBucket.messageIds.add(message.id);
  }

  return buckets;
};

interface BuiltTurnState {
  id: string;
  userMessage: CoworkMessage | null;
  parts: TurnPart[];
  toolPartsByCallId: Map<string, ToolTurnPart>;
  toolCallIds: Set<string>;
}

const buildTurnPartsFromBucket = (bucket: TurnMessageBucket): BuiltTurnState => {
  const parts: TurnPart[] = [];
  const toolPartsByCallId = new Map<string, ToolTurnPart>();
  const openTools: ToolTurnPart[] = [];

  const applyToolResult = (message: CoworkMessage) => {
    const toolCallId =
      typeof message.metadata?.toolUseId === 'string' && message.metadata.toolUseId.trim()
        ? message.metadata.toolUseId.trim()
        : '';
    const target =
      (toolCallId ? toolPartsByCallId.get(toolCallId) : undefined) ??
      openTools.find(candidate => candidate.phase === 'running');
    const output = getToolResultDisplay(message);
    const isError = Boolean(message.metadata?.isError || message.metadata?.error);
    const phase: ToolPhase = isError ? 'output-error' : 'output-available';
    if (target) {
      target.phase = phase;
      target.output = output;
      target.isError = isError;
      target.contentTruncated = Boolean(message.metadata?.contentTruncated);
      target.updatedAt = message.timestamp;
      const openIdx = openTools.indexOf(target);
      if (openIdx >= 0) openTools.splice(openIdx, 1);
      return;
    }

    const classification = classifyTool(
      typeof message.metadata?.toolName === 'string' ? message.metadata.toolName : 'Tool',
    );
    parts.push({
      kind: 'tool',
      id: `tool:${message.id}`,
      toolCallId: toolCallId || message.id,
      toolName: typeof message.metadata?.toolName === 'string' ? message.metadata.toolName : 'Tool',
      category: classification.category,
      readOnly: classification.readOnly,
      phase,
      output,
      contentTruncated: Boolean(message.metadata?.contentTruncated),
      isError,
      updatedAt: message.timestamp,
    });
  };

  for (const message of bucket.ownMessages) {
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
      parts.push(part);
      toolPartsByCallId.set(toolCallId, part);
      openTools.push(part);
      continue;
    }

    if (message.type === 'tool_result') {
      applyToolResult(message);
      continue;
    }

    if (message.type === 'system') {
      const interruption = message.metadata?.interruption as CoworkSessionInterruption | undefined;
      if (interruption) {
        for (const openTool of openTools) {
          openTool.phase = 'output-error';
          openTool.isError = true;
          openTool.output = openTool.output ?? '';
        }
        openTools.length = 0;
      }
      parts.push({
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
        parts.push({
          kind: 'reasoning',
          id: `reasoning:${message.id}`,
          message,
          isStreaming: Boolean(message.metadata?.isStreaming) && !message.metadata?.isFinal,
          isComplete: Boolean(message.metadata?.isFinal),
          durationSeconds: toThinkingDurationSeconds(message.metadata?.thinkingDurationMs),
        });
      } else if (message.content.trim().length > 0 || message.metadata?.isStreaming) {
        parts.push({
          kind: 'text',
          id: `text:${message.id}`,
          message,
          isStreaming: Boolean(message.metadata?.isStreaming),
          isFinalAnswer: Boolean(message.metadata?.isFinalAnswer),
        });
      }
    }
  }

  // Apply any cross-turn tool results that landed after a steered user prompt.
  for (const steeredResult of bucket.externalResults) {
    applyToolResult(steeredResult);
  }

  return {
    id: bucket.id,
    userMessage: bucket.userMessage,
    parts,
    toolPartsByCallId,
    toolCallIds: new Set(bucket.toolCallIds),
  };
};

const finalizeTurnState = (
  state: BuiltTurnState,
  index: number,
  isLastTurn: boolean,
  isStreaming: boolean,
  deliverables: Artifact[],
): ConversationTurn => {
  const turnIsStreaming = isStreaming && isLastTurn;
  const turnIsComplete = !turnIsStreaming;

  const settledParts = state.parts.map(part => {
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

  const groupedParts = groupContiguousActivityParts(settledParts);
  const lastTextPart = [...groupedParts]
    .reverse()
    .find(
      (part): part is Extract<TurnPart, { kind: 'text' }> =>
        part.kind === 'text' && part.message.content.trim().length > 0,
    );

  const experts = Array.isArray(state.userMessage?.metadata?.experts)
    ? state.userMessage.metadata.experts
    : [];

  const hasApproval = groupedParts.some(
    part =>
      (part.kind === 'tool' && part.phase === 'approval-requested') ||
      (part.kind === 'tool_group' && part.hasApproval) ||
      part.kind === 'question',
  );
  const hasError = groupedParts.some(
    part =>
      (part.kind === 'tool' && part.isError) ||
      (part.kind === 'tool_group' && part.hasError) ||
      (part.kind === 'notice' && part.isError),
  );

  return {
    id: state.id,
    index,
    userMessage: state.userMessage,
    parts: groupedParts,
    deliverables,
    copyText: lastTextPart ? lastTextPart.message.content : null,
    experts,
    isStreaming: turnIsStreaming,
    isComplete: turnIsComplete,
    hasApproval,
    hasError,
    modelLabel:
      getModelLabel(lastTextPart?.message.metadata) ?? getModelLabel(state.userMessage?.metadata),
    timestamp: lastTextPart?.message.timestamp ?? state.userMessage?.timestamp ?? null,
  };
};

const shallowArrayEqual = <T>(a: readonly T[], b: readonly T[]): boolean => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const historicalArgEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return shallowArrayEqual(a, b);
  return false;
};

const finalizeTailTurnWithOverlay = ({
  tailBucket,
  tailIndex,
  deliverableIndex,
  toolActivities,
  pendingPermission,
  inlineQuestionPermission,
  isStreaming,
}: {
  tailBucket: TurnMessageBucket | null;
  tailIndex: number;
  deliverableIndex: DeliverableIndex;
  toolActivities: readonly CoworkToolActivity[];
  pendingPermission: CoworkPermissionRequest | null;
  inlineQuestionPermission: CoworkPermissionRequest | null;
  isStreaming: boolean;
}): { tailTurn: ConversationTurn | null; unmatchedPermission: CoworkPermissionRequest | null } => {
  let state = tailBucket ? buildTurnPartsFromBucket(tailBucket) : null;

  const ensureTailState = (fallbackId: string): BuiltTurnState => {
    if (state) return state;
    state = {
      id: `orphan:${fallbackId}`,
      userMessage: null,
      parts: [],
      toolPartsByCallId: new Map(),
      toolCallIds: new Set(),
    };
    return state;
  };

  if (isStreaming && toolActivities.length > 0) {
    const activeTurn = ensureTailState('streaming');
    for (const activity of toolActivities) {
      const existing = activeTurn.toolPartsByCallId.get(activity.toolCallId);
      if (existing) {
        if (
          (existing.phase === 'running' || existing.phase === 'input-streaming') &&
          activity.progress
        ) {
          existing.progress = activity.progress;
          if (activity.toolInput) existing.input = activity.toolInput;
          existing.updatedAt = activity.updatedAt;
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

  let unmatchedPermission: CoworkPermissionRequest | null = null;
  if (pendingPermission && state) {
    const matched = matchPermissionToTool(state.parts, pendingPermission);
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
    const activeTurn = ensureTailState(`question:${inlineQuestionPermission.requestId}`);
    activeTurn.parts.push({
      kind: 'question',
      id: `question:${inlineQuestionPermission.requestId}`,
      permission: inlineQuestionPermission,
    });
  }

  if (!state) {
    return { tailTurn: null, unmatchedPermission };
  }

  const tailMessageIds = tailBucket?.messageIds ?? new Set<string>();
  const deliverables = collectTurnDeliverables(tailMessageIds, state.toolCallIds, deliverableIndex);
  return {
    tailTurn: finalizeTurnState(state, tailIndex, true, isStreaming, deliverables),
    unmatchedPermission,
  };
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

/**
 * Creates a layered `@reduxjs/toolkit` selector pipeline for one session.
 * Historical turns remain reference-identical across `toolActivities`,
 * permission updates, and tail streaming deltas, while artifacts are indexed
 * in O(artifacts) instead of scanned per turn.
 */
export function createSessionTurnsSelector(): (input: ProjectTurnsInput) => ProjectTurnsResult {
  const projectHistoricalTurnMemo = lruMemoize(
    (
      _id: string,
      index: number,
      userMessage: CoworkMessage | null,
      ownMessages: readonly CoworkMessage[],
      externalResults: readonly CoworkMessage[],
      deliverables: Artifact[],
    ): ConversationTurn => {
      const bucket: TurnMessageBucket = {
        id: _id,
        userMessage,
        ownMessages: ownMessages as CoworkMessage[],
        externalResults: externalResults as CoworkMessage[],
        messageIds: new Set(),
        toolCallIds: new Set(),
      };
      const built = buildTurnPartsFromBucket(bucket);
      return finalizeTurnState(built, index, false, false, deliverables);
    },
    { maxSize: 6000, equalityCheck: historicalArgEqual },
  );

  const selectDeliverableIndex = createSelector(
    [
      (input: ProjectTurnsInput) => input.artifacts,
      (input: ProjectTurnsInput) => input.previewableTypes,
    ],
    buildDeliverableIndex,
  );

  const selectTurnBuckets = createSelector(
    [(input: ProjectTurnsInput) => input.messages],
    partitionMessagesIntoTurnBuckets,
  );

  const selectHistoryTurns = createSelector(
    [selectTurnBuckets, selectDeliverableIndex],
    (buckets, deliverableIndex): ConversationTurn[] => {
      if (buckets.length <= 1) return [];
      const historyCount = buckets.length - 1;
      const result = new Array<ConversationTurn>(historyCount);
      for (let i = 0; i < historyCount; i += 1) {
        const bucket = buckets[i];
        const deliverables = collectTurnDeliverables(
          bucket.messageIds,
          bucket.toolCallIds,
          deliverableIndex,
        );
        result[i] = projectHistoricalTurnMemo(
          bucket.id,
          i,
          bucket.userMessage,
          bucket.ownMessages,
          bucket.externalResults,
          deliverables,
        );
      }
      return result;
    },
  );

  return createSelector(
    [
      selectHistoryTurns,
      selectTurnBuckets,
      selectDeliverableIndex,
      (input: ProjectTurnsInput) => input.toolActivities,
      (input: ProjectTurnsInput) => input.pendingPermission ?? null,
      (input: ProjectTurnsInput) => input.inlineQuestionPermission ?? null,
      (input: ProjectTurnsInput) => input.isStreaming,
    ],
    (
      historyTurns,
      buckets,
      deliverableIndex,
      toolActivities,
      pendingPermission,
      inlineQuestionPermission,
      isStreaming,
    ): ProjectTurnsResult => {
      const tailBucket = buckets.length > 0 ? buckets[buckets.length - 1] : null;
      const tailIndex = Math.max(0, buckets.length - 1);
      const { tailTurn, unmatchedPermission } = finalizeTailTurnWithOverlay({
        tailBucket,
        tailIndex,
        deliverableIndex,
        toolActivities,
        pendingPermission,
        inlineQuestionPermission,
        isStreaming,
      });

      const turns = tailTurn ? [...historyTurns, tailTurn] : historyTurns;
      return { turns, unmatchedPermission };
    },
  );
}

/** Convenience stateless projection for modals and unit tests. */
export function projectSessionToTurns(input: ProjectTurnsInput): ProjectTurnsResult {
  const deliverableIndex = buildDeliverableIndex(input.artifacts, input.previewableTypes);
  const buckets = partitionMessagesIntoTurnBuckets(input.messages);
  const historyCount = Math.max(0, buckets.length - 1);
  const historyTurns = new Array<ConversationTurn>(historyCount);
  for (let i = 0; i < historyCount; i += 1) {
    const bucket = buckets[i];
    const deliverables = collectTurnDeliverables(
      bucket.messageIds,
      bucket.toolCallIds,
      deliverableIndex,
    );
    historyTurns[i] = finalizeTurnState(
      buildTurnPartsFromBucket(bucket),
      i,
      false,
      false,
      deliverables,
    );
  }
  const tailBucket = buckets.length > 0 ? buckets[buckets.length - 1] : null;
  const tailIndex = Math.max(0, buckets.length - 1);
  const { tailTurn, unmatchedPermission } = finalizeTailTurnWithOverlay({
    tailBucket,
    tailIndex,
    deliverableIndex,
    toolActivities: input.toolActivities,
    pendingPermission: input.pendingPermission ?? null,
    inlineQuestionPermission: input.inlineQuestionPermission ?? null,
    isStreaming: input.isStreaming,
  });
  return {
    turns: tailTurn ? [...historyTurns, tailTurn] : historyTurns,
    unmatchedPermission,
  };
}
