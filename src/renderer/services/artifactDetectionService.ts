import type { Artifact } from '../types/artifact';
import type { CoworkMessage } from '../types/cowork';
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

  constructor(
    private onDetected: (artifacts: ArtifactDetectionResult[]) => void,
  ) {}

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

  /**
   * Process when messages are added or their artifact-relevant state changes.
   *
   * For incremental detection we send the full message list because tool_use
   * messages need to be paired with their tool_result, and the result may
   * arrive later. Assistant messages also update in place while streaming, so
   * message ids alone cannot determine whether a snapshot was processed.
   */
  async processMessages(
    messages: CoworkMessage[],
    sessionId: string,
  ): Promise<void> {
    const snapshots = messages.map(message => ({
      id: message.id,
      snapshot: createMessageSnapshot(message),
    }));
    const hasChanges = snapshots.some(({ id, snapshot }) =>
      hasMessageChanged(this.processedMessages.get(id), snapshot),
    );
    if (!hasChanges) return;

    for (const { id, snapshot } of snapshots) {
      this.processedMessages.set(id, snapshot);
    }

    const detected = await this.detect(messages, sessionId);
    if (detected.length === 0) return;

    this.onDetected(detected);
  }

  reset(): void {
    this.processedMessages.clear();
  }

  private detect(messages: CoworkMessage[], sessionId: string): Promise<ArtifactDetectionResult[]> {
    return new Promise(resolve => {
      const seq = ++this.seq;
      this.pending.set(seq, resolve);
      this.ensureWorker().postMessage({
        messages,
        sessionId,
        seq,
      } satisfies ArtifactDetectionWorkerRequest);
    });
  }

}
