import { useMemo, useRef } from 'react';

import { type Artifact } from '../../../types/artifact';
import type { ConversationTurn } from './messageGrouping';

const collectTurnMessageIds = (turn: ConversationTurn): Set<string> => {
  const ids = new Set<string>();
  for (const item of turn.assistantItems) {
    if (item.type === 'assistant' || item.type === 'system' || item.type === 'tool_result') {
      ids.add(item.message.id);
    } else if (item.type === 'tool_group') {
      ids.add(item.group.toolUse.id);
      if (item.group.toolResult) ids.add(item.group.toolResult.id);
    }
  }
  return ids;
};

/** Tool-call ids of a turn's tool groups (the ledger anchors cards by these). */
const collectTurnToolCallIds = (turn: ConversationTurn): Set<string> => {
  const ids = new Set<string>();
  for (const item of turn.assistantItems) {
    if (item.type !== 'tool_group') continue;
    const toolUseId = item.group.toolUse.metadata?.toolUseId;
    if (typeof toolUseId === 'string' && toolUseId) ids.add(toolUseId);
  }
  return ids;
};

const sameArtifactList = (a: Artifact[] | undefined, b: Artifact[]): boolean =>
  a !== undefined && a.length === b.length && a.every((artifact, index) => artifact === b[index]);

/**
 * Maps turn id → previewable artifacts for that turn, preserving array
 * identity when the underlying artifact references did not change. Without
 * this, `filter()` would produce a fresh array per turn on every streaming
 * frame and defeat the TurnBlock memo boundary (issue #141).
 *
 * An artifact belongs to the turn that contains its anchor: the artifact's
 * message id (tool_result or final answer), or its producing tool call when
 * the ledger row carries a `toolCallId`. Artifacts anchored outside the
 * loaded page simply have no turn card here; the panel still lists them.
 */
export const useTurnArtifacts = (
  turns: ConversationTurn[],
  sessionArtifacts: Artifact[],
  previewableTypes: ReadonlySet<string>,
): Map<string, Artifact[]> => {
  const cacheRef = useRef(new Map<string, Artifact[]>());
  return useMemo(() => {
    const previous = cacheRef.current;
    const next = new Map<string, Artifact[]>();
    for (const turn of turns) {
      const messageIds = collectTurnMessageIds(turn);
      const toolCallIds = collectTurnToolCallIds(turn);
      const artifacts = sessionArtifacts.filter(
        artifact =>
          previewableTypes.has(artifact.type) &&
          (messageIds.has(artifact.messageId) ||
            (artifact.toolCallId !== undefined &&
              artifact.toolCallId !== null &&
              toolCallIds.has(artifact.toolCallId))),
      );
      const cached = previous.get(turn.id);
      next.set(turn.id, sameArtifactList(cached, artifacts) ? (cached as Artifact[]) : artifacts);
    }
    cacheRef.current = next;
    return next;
  }, [turns, sessionArtifacts, previewableTypes]);
};
