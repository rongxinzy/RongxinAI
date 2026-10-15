import { useMemo, useRef } from 'react';

import { CoworkMessageType } from '../../../../shared/cowork/constants';
import { resolveArtifactPath } from '../../../../shared/cowork/artifactPath';
import {
  normalizeFilePathForDedup,
  parseFinalAnswerPathArtifactsForMessage,
} from '../../../services/artifactParser';
import { ArtifactRole, type Artifact } from '../../../types/artifact';
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

const sameArtifactList = (a: Artifact[] | undefined, b: Artifact[]): boolean =>
  a !== undefined && a.length === b.length && a.every((artifact, index) => artifact === b[index]);

/**
 * Maps turn id → previewable artifacts for that turn, preserving array
 * identity when the underlying artifact references did not change. Without
 * this, `filter()` would produce a fresh array per turn on every streaming
 * frame and defeat the TurnBlock memo boundary (issue #141).
 */
export const useTurnArtifacts = (
  turns: ConversationTurn[],
  sessionArtifacts: Artifact[],
  previewableTypes: ReadonlySet<string>,
  cwd?: string,
): Map<string, Artifact[]> => {
  const cacheRef = useRef(new Map<string, Artifact[]>());
  const deliveryAnchors = useMemo(() => {
    const anchors = new Map<string, string>();
    for (const turn of turns) {
      for (const item of turn.assistantItems) {
        if (item.type !== CoworkMessageType.Assistant) continue;
        for (const artifact of parseFinalAnswerPathArtifactsForMessage(item.message, '')) {
          if (artifact.filePath)
            anchors.set(normalizeFilePathForDedup(artifact.filePath), item.message.id);
        }
        const { metadata } = item.message;
        if (metadata?.isThinking || !(metadata?.isFinal || metadata?.isFinalAnswer)) continue;
        // Final answers also name workspace files as inline code. Resolve the
        // complete path, so equal basenames in other directories cannot match.
        for (const match of item.message.content.matchAll(/`([^`\r\n]+)`/g)) {
          anchors.set(
            normalizeFilePathForDedup(resolveArtifactPath(match[1], cwd)),
            item.message.id,
          );
        }
      }
    }
    return anchors;
  }, [turns, cwd]);
  return useMemo(() => {
    const previous = cacheRef.current;
    const next = new Map<string, Artifact[]>();
    for (const turn of turns) {
      const messageIds = collectTurnMessageIds(turn);
      const artifacts = sessionArtifacts.filter(artifact => {
        // Persisted declarations may precede the loaded page. Match the same
        // final-answer path anchor as the async store merge, from the first paint.
        const anchor =
          artifact.role === ArtifactRole.Deliverable && artifact.filePath
            ? deliveryAnchors.get(
                normalizeFilePathForDedup(resolveArtifactPath(artifact.filePath, cwd)),
              )
            : undefined;
        return messageIds.has(anchor ?? artifact.messageId) && previewableTypes.has(artifact.type);
      });
      const cached = previous.get(turn.id);
      next.set(turn.id, sameArtifactList(cached, artifacts) ? (cached as Artifact[]) : artifacts);
    }
    cacheRef.current = next;
    return next;
  }, [turns, sessionArtifacts, previewableTypes, deliveryAnchors, cwd]);
};
