import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ArtifactRole } from '../types/artifact';
import type { CoworkMessage } from '../types/cowork';
import { ArtifactDetectionService } from './artifactDetectionService';
import type {
  ArtifactDetectionWorkerRequest,
  ArtifactDetectionWorkerResponse,
} from './artifactDetection.worker';
import { detectArtifactsFromMessages } from './artifactParser';

class FakeArtifactDetectionWorker {
  static requests: ArtifactDetectionWorkerRequest[] = [];

  onmessage: ((event: MessageEvent<ArtifactDetectionWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  postMessage(request: ArtifactDetectionWorkerRequest): void {
    FakeArtifactDetectionWorker.requests.push(request);
    this.onmessage?.({
      data: {
        seq: request.seq,
        artifacts: detectArtifactsFromMessages(request.messages, request.sessionId),
      },
    } as MessageEvent<ArtifactDetectionWorkerResponse>);
  }

  terminate(): void {}
}

describe('ArtifactDetectionService', () => {
  beforeEach(() => {
    FakeArtifactDetectionWorker.requests = [];
    vi.stubGlobal('Worker', FakeArtifactDetectionWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('reprocesses an assistant message when the same id becomes the final answer', async () => {
    const detectedArtifacts: ReturnType<typeof detectArtifactsFromMessages> = [];
    const service = new ArtifactDetectionService(
      detected => detectedArtifacts.push(...detected),
      () => {},
    );
    const messageId = 'assistant-message';
    const sessionId = 'session-1';
    const thinkingMessage: CoworkMessage = {
      id: messageId,
      type: 'assistant',
      content: 'Preparing the presentation.',
      timestamp: 1,
      metadata: { isStreaming: false, isFinal: true, isThinking: true },
    };

    await service.processMessages([thinkingMessage], sessionId);

    const finalMessage: CoworkMessage = {
      ...thinkingMessage,
      content: 'Final file: `C:/workspace/presentation.pptx`',
      metadata: {
        isStreaming: false,
        isFinal: true,
        isFinalAnswer: true,
      },
    };
    await service.processMessages([finalMessage], sessionId);
    await service.processMessages([finalMessage], sessionId);

    expect(FakeArtifactDetectionWorker.requests).toHaveLength(2);
    expect(detectedArtifacts).toHaveLength(1);
    expect(detectedArtifacts[0].artifact).toMatchObject({
      messageId,
      filePath: 'C:/workspace/presentation.pptx',
      role: ArtifactRole.Deliverable,
    });
  });
});
