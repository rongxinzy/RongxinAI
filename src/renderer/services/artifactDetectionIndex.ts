import { ArtifactRole } from '../types/artifact';
import type { CoworkMessage } from '../types/cowork';
import {
  normalizeFilePathForDedup,
  parseCodeBlockArtifacts,
  parseDeclareArtifactFromMessages,
  parseFinalAnswerPathArtifactsForMessage,
  parseToolArtifact,
  type DetectedArtifact,
} from './artifactParser';

/**
 * Maintains message-level artifact results for one session. Updates only
 * reparse changed messages and tool-use/result pairs; path deduplication is
 * applied once when the current projection is requested.
 */
export class ArtifactDetectionIndex {
  private readonly messagesById = new Map<string, CoworkMessage>();
  private readonly artifactsByMessage = new Map<string, DetectedArtifact[]>();
  private readonly toolUseByCallId = new Map<string, string>();
  private readonly toolResultByCallId = new Map<string, string>();
  private readonly callIdByMessageId = new Map<string, string>();
  private messageOrder: string[] = [];
  private sessionId: string | null = null;

  replace(messages: CoworkMessage[], sessionId: string): void {
    this.clear();
    this.sessionId = sessionId;
    this.messageOrder = messages.map(message => message.id);
    for (const message of messages) this.setMessage(message);
    for (const message of messages) this.recomputeMessage(message.id);
  }

  applyPatch(
    upserts: CoworkMessage[],
    relatedMessages: CoworkMessage[],
    removedMessageIds: string[],
    messageOrder: string[] | undefined,
    sessionId: string,
  ): void {
    if (this.sessionId !== sessionId) {
      throw new Error('Artifact detection patch received before a session snapshot');
    }

    const affected = new Set<string>();
    for (const messageId of removedMessageIds) {
      this.addRelatedMessageIds(messageId, affected);
      this.removeMessage(messageId);
    }
    for (const message of [...upserts, ...relatedMessages]) {
      this.addRelatedMessageIds(message.id, affected);
      this.setMessage(message);
      affected.add(message.id);
      this.addRelatedMessageIds(message.id, affected);
    }

    if (messageOrder) {
      this.messageOrder = messageOrder.filter(messageId => this.messagesById.has(messageId));
      this.addPositionalToolMessages(affected);
    } else {
      this.messageOrder = this.messageOrder.filter(messageId => this.messagesById.has(messageId));
    }

    for (const messageId of affected) this.recomputeMessage(messageId);
  }

  getArtifacts(): DetectedArtifact[] {
    const detected: DetectedArtifact[] = [];
    const detectedFilePathIndexes = new Map<string, number>();

    for (const messageId of this.messageOrder) {
      for (const detectedArtifact of this.artifactsByMessage.get(messageId) ?? []) {
        const filePath = detectedArtifact.artifact.filePath;
        if (!filePath) {
          detected.push(detectedArtifact);
          continue;
        }

        const normalized = normalizeFilePathForDedup(filePath);
        const existingIndex = detectedFilePathIndexes.get(normalized);
        if (existingIndex === undefined) {
          detectedFilePathIndexes.set(normalized, detected.length);
          detected.push(detectedArtifact);
          continue;
        }

        const existing = detected[existingIndex];
        if (
          (detectedArtifact.artifact.declared && !existing.artifact.declared) ||
          (existing.artifact.role !== ArtifactRole.Deliverable &&
            detectedArtifact.artifact.role === ArtifactRole.Deliverable)
        ) {
          detected[existingIndex] = {
            artifact: detectedArtifact.artifact,
            needsFileLoad: existing.needsFileLoad || detectedArtifact.needsFileLoad,
          };
        } else if (existing.artifact.role === detectedArtifact.artifact.role) {
          existing.needsFileLoad ||= detectedArtifact.needsFileLoad;
        }
      }
    }

    return detected;
  }

  clear(): void {
    this.messagesById.clear();
    this.artifactsByMessage.clear();
    this.toolUseByCallId.clear();
    this.toolResultByCallId.clear();
    this.callIdByMessageId.clear();
    this.messageOrder = [];
    this.sessionId = null;
  }

  private setMessage(message: CoworkMessage): void {
    this.clearCallId(message.id);
    this.messagesById.set(message.id, message);
    const callId = message.metadata?.toolUseId;
    if (typeof callId !== 'string' || !callId) return;

    this.callIdByMessageId.set(message.id, callId);
    if (message.type === 'tool_use') this.toolUseByCallId.set(callId, message.id);
    if (message.type === 'tool_result') this.toolResultByCallId.set(callId, message.id);
  }

  private clearCallId(messageId: string): void {
    const previousCallId = this.callIdByMessageId.get(messageId);
    if (!previousCallId) return;
    this.callIdByMessageId.delete(messageId);
    if (this.toolUseByCallId.get(previousCallId) === messageId) {
      this.toolUseByCallId.delete(previousCallId);
    }
    if (this.toolResultByCallId.get(previousCallId) === messageId) {
      this.toolResultByCallId.delete(previousCallId);
    }
  }

  private removeMessage(messageId: string): void {
    this.clearCallId(messageId);
    this.messagesById.delete(messageId);
    this.artifactsByMessage.delete(messageId);
    this.messageOrder = this.messageOrder.filter(id => id !== messageId);
  }

  private addRelatedMessageIds(messageId: string, affected: Set<string>): void {
    affected.add(messageId);
    const message = this.messagesById.get(messageId);
    if (!message) return;

    const callId = this.callIdByMessageId.get(messageId);
    if (callId) {
      const relatedId =
        message.type === 'tool_use'
          ? this.toolResultByCallId.get(callId)
          : this.toolUseByCallId.get(callId);
      if (relatedId) affected.add(relatedId);
      return;
    }

    const index = this.messageOrder.indexOf(messageId);
    if (index < 0) return;
    const neighbor =
      message.type === 'tool_use' ? this.messageOrder[index + 1] : this.messageOrder[index - 1];
    if (neighbor) affected.add(neighbor);
  }

  private addPositionalToolMessages(affected: Set<string>): void {
    for (const message of this.messagesById.values()) {
      if (
        (message.type === 'tool_use' || message.type === 'tool_result') &&
        !this.callIdByMessageId.has(message.id)
      ) {
        affected.add(message.id);
      }
    }
  }

  private findToolResult(toolUse: CoworkMessage): CoworkMessage | undefined {
    const callId = this.callIdByMessageId.get(toolUse.id);
    if (callId) {
      const resultId = this.toolResultByCallId.get(callId);
      return resultId ? this.messagesById.get(resultId) : undefined;
    }
    const index = this.messageOrder.indexOf(toolUse.id);
    const next = index >= 0 ? this.messagesById.get(this.messageOrder[index + 1]) : undefined;
    return next?.type === 'tool_result' ? next : undefined;
  }

  private recomputeMessage(messageId: string): void {
    const message = this.messagesById.get(messageId);
    if (!message || !this.sessionId) {
      this.artifactsByMessage.delete(messageId);
      return;
    }

    const artifacts: DetectedArtifact[] = [];
    if (message.type === 'assistant' && !message.metadata?.isThinking && message.content) {
      artifacts.push(
        ...parseCodeBlockArtifacts(message.content, message.id, this.sessionId).map(artifact => ({
          artifact,
          needsFileLoad: false,
        })),
        ...parseFinalAnswerPathArtifactsForMessage(message, this.sessionId).map(artifact => ({
          artifact,
          needsFileLoad: true,
        })),
      );
    }

    if (message.type === 'tool_use') {
      artifacts.push(
        ...parseDeclareArtifactFromMessages(
          [message],
          this.sessionId,
          () => ArtifactRole.Deliverable,
        ).map(artifact => ({ artifact, needsFileLoad: true })),
      );
      const toolArtifact = parseToolArtifact(message, this.findToolResult(message), this.sessionId);
      if (toolArtifact) artifacts.push({ artifact: toolArtifact, needsFileLoad: true });
    }

    this.artifactsByMessage.set(messageId, artifacts);
  }
}
