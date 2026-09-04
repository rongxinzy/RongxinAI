import type { Artifact } from '../types/artifact';
import type { CoworkMessage } from '../types/cowork';
import { ArtifactDetectionRequestKind } from './artifactDetection.constants';
import type {
  ArtifactDetectionWorkerRequest,
  ArtifactDetectionWorkerResponse,
} from './artifactDetection.worker';

export type ArtifactDetectionResult = {
  artifact: Artifact;
  needsFileLoad: boolean;
};

type ProcessedMessageSnapshot = {
  type: CoworkMessage['type'];
  content: string;
  metadata: string;
};

function createMessageSnapshot(message: CoworkMessage): ProcessedMessageSnapshot {
  const metadata = message.metadata;
  return {
    type: message.type,
    content: message.content,
    metadata: JSON.stringify({
      toolName: metadata?.toolName,
      toolInput: metadata?.toolInput,
      toolUseId: metadata?.toolUseId,
      isError: metadata?.isError,
      error: metadata?.error,
      isStreaming: metadata?.isStreaming,
      isFinal: metadata?.isFinal,
      isFinalAnswer: metadata?.isFinalAnswer,
      isThinking: metadata?.isThinking,
    }),
  };
}

function hasMessageChanged(
  previous: ProcessedMessageSnapshot | undefined,
  current: ProcessedMessageSnapshot,
): boolean {
  return (
    !previous ||
    previous.type !== current.type ||
    previous.content !== current.content ||
    previous.metadata !== current.metadata
  );
}

export class ArtifactDetectionService {
  private worker: Worker | null = null;
  private pending = new Map<number, (result: ArtifactDetectionResult[]) => void>();
  private seq = 0;
  private processedMessages = new Map<string, ProcessedMessageSnapshot>();
  private processedMessageOrder: string[] = [];
  private processedSessionId: string | null = null;

  constructor(private onDetected: (artifacts: ArtifactDetectionResult[]) => void) {}

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./artifactDetection.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<ArtifactDetectionWorkerResponse>) => {
      const data = event.data;
      const resolver = this.pending.get(data.seq);
      this.pending.delete(data.seq);
      if (data.error) {
        console.error('[ArtifactDetectionService] worker error:', data.error);
      }
      if (resolver) {
        resolver(data.artifacts ?? []);
      }
    };
    worker.onerror = error => {
      console.error('[ArtifactDetectionService] worker runtime error:', error);
    };
    this.worker = worker;
    return worker;
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }

  async processMessages(messages: CoworkMessage[], sessionId: string): Promise<void> {
    const snapshots = messages.map(message => ({
      id: message.id,
      snapshot: createMessageSnapshot(message),
    }));
    const messagesById = new Map(messages.map(message => [message.id, message]));
    const changedMessages = snapshots
      .filter(({ id, snapshot }) => hasMessageChanged(this.processedMessages.get(id), snapshot))
      .map(({ id }) => messagesById.get(id))
      .filter((message): message is CoworkMessage => message !== undefined);
    const currentMessageIds = new Set(snapshots.map(({ id }) => id));
    const removedMessageIds = [...this.processedMessages.keys()].filter(
      messageId => !currentMessageIds.has(messageId),
    );
    const currentMessageOrder = snapshots.map(({ id }) => id);
    const orderChanged = !areArraysEqual(this.processedMessageOrder, currentMessageOrder);
    const sessionChanged = this.processedSessionId !== sessionId;
    const hasChanges = changedMessages.length > 0 || removedMessageIds.length > 0 || orderChanged;
    if (!hasChanges && !sessionChanged) return;

    const isInitialSnapshot = sessionChanged || this.processedMessageOrder.length === 0;

    for (const { id, snapshot } of snapshots) {
      this.processedMessages.set(id, snapshot);
    }
    for (const messageId of removedMessageIds) {
      this.processedMessages.delete(messageId);
    }
    this.processedMessageOrder = currentMessageOrder;
    this.processedSessionId = sessionId;

    const detected = await this.detect(
      isInitialSnapshot
        ? {
            kind: ArtifactDetectionRequestKind.Snapshot,
            messages,
            sessionId,
            seq: 0,
          }
        : {
            kind: ArtifactDetectionRequestKind.Patch,
            upserts: changedMessages,
            relatedMessages: collectRelatedMessages(messages, changedMessages),
            removedMessageIds,
            messageOrder: orderChanged ? currentMessageOrder : undefined,
            sessionId,
            seq: 0,
          },
    );
    if (detected.length === 0) return;

    this.onDetected(detected);
  }

  reset(): void {
    this.processedMessages.clear();
    this.processedMessageOrder = [];
    this.processedSessionId = null;
  }

  private detect(request: ArtifactDetectionWorkerRequest): Promise<ArtifactDetectionResult[]> {
    return new Promise(resolve => {
      const seq = ++this.seq;
      this.pending.set(seq, resolve);
      this.ensureWorker().postMessage({ ...request, seq } satisfies ArtifactDetectionWorkerRequest);
    });
  }
}

function areArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function collectRelatedMessages(
  messages: CoworkMessage[],
  changedMessages: CoworkMessage[],
): CoworkMessage[] {
  const changedIds = new Set(changedMessages.map(message => message.id));
  const toolUseIds = new Set(
    changedMessages
      .map(message => message.metadata?.toolUseId)
      .filter((toolUseId): toolUseId is string => typeof toolUseId === 'string'),
  );
  const related = new Map<string, CoworkMessage>();

  for (const message of messages) {
    if (changedIds.has(message.id)) continue;
    if (message.metadata?.toolUseId && toolUseIds.has(message.metadata.toolUseId)) {
      related.set(message.id, message);
    }
  }

  for (const changedMessage of changedMessages) {
    const index = messages.findIndex(message => message.id === changedMessage.id);
    if (index < 0) continue;
    for (const neighbor of [messages[index - 1], messages[index + 1]]) {
      if (
        neighbor &&
        (neighbor.type === 'tool_use' || neighbor.type === 'tool_result') &&
        !changedIds.has(neighbor.id)
      ) {
        related.set(neighbor.id, neighbor);
      }
    }
  }

  return [...related.values()];
}
