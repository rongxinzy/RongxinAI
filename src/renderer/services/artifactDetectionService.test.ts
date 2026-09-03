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

  test('reprocesses when a declare_artifact tool call arrives after thinking is done', async () => {
    const detectedArtifacts: ReturnType<typeof detectArtifactsFromMessages> = [];
    const service = new ArtifactDetectionService(detected => detectedArtifacts.push(...detected));
    const messageId = 'assistant-message';
    const toolMessageId = 'tool-declare';
    const sessionId = 'session-1';
    const thinkingMessage: CoworkMessage = {
      id: messageId,
      type: 'assistant',
      content: 'Preparing the presentation.',
      timestamp: 1,
      metadata: { isStreaming: false, isFinal: true, isThinking: true },
    };

    // First pass: only thinking message, no tool calls
    await service.processMessages([thinkingMessage], sessionId);

    // Second pass: thinking becomes final answer + declare_artifact tool call arrives
    const finalAssistant: CoworkMessage = {
      ...thinkingMessage,
      content: 'Deliverable completed.',
      metadata: {
        isStreaming: false,
        isFinal: true,
        isFinalAnswer: true,
      },
    };
    const declareToolMessage: CoworkMessage = {
      id: toolMessageId,
      type: 'tool_use',
      content: '',
      timestamp: 2,
      metadata: {
        toolName: 'declare_artifact',
        toolInput: {
          filePath: 'C:/workspace/presentation.pptx',
          role: 'deliverable',
        },
      },
    };
    await service.processMessages([finalAssistant, declareToolMessage], sessionId);
    // Third pass: same messages, should be skipped (no changes)
    await service.processMessages([finalAssistant, declareToolMessage], sessionId);

    expect(FakeArtifactDetectionWorker.requests).toHaveLength(2);
    // Only the declare_artifact tool call produces an artifact
    // (the assistant message content no longer triggers file path detection)
    expect(detectedArtifacts).toHaveLength(1);
    expect(detectedArtifacts[0].artifact).toMatchObject({
      messageId: toolMessageId,
      filePath: 'C:/workspace/presentation.pptx',
      role: ArtifactRole.Deliverable,
    });
  });

  test('does not read CSV files while detecting artifacts', async () => {
    const detectedArtifacts: ReturnType<typeof detectArtifactsFromMessages> = [];
    const service = new ArtifactDetectionService(detected => detectedArtifacts.push(...detected));

    await service.processMessages(
      [
        {
          id: 'write-csv',
          type: 'tool_use',
          content: '',
          timestamp: 1,
          metadata: {
            toolName: 'write',
            toolInput: { path: 'C:/workspace/scores.csv' },
          },
        },
      ],
      'session-csv',
    );

    expect(detectedArtifacts).toHaveLength(1);
    expect(detectedArtifacts[0].artifact.content).toBe('');
  });

  test('keeps binary artifact loading out of detection', async () => {
    const detectedArtifacts: ReturnType<typeof detectArtifactsFromMessages> = [];
    const service = new ArtifactDetectionService(detected => detectedArtifacts.push(...detected));

    await service.processMessages(
      [
        {
          id: 'write-model',
          type: 'tool_use',
          content: '',
          timestamp: 1,
          metadata: {
            toolName: 'write',
            toolInput: { path: 'C:/workspace/model.stl' },
          },
        },
      ],
      'session-model',
    );

    expect(detectedArtifacts).toHaveLength(1);
    expect(detectedArtifacts[0].artifact).toMatchObject({ type: 'model', content: '' });
  });

  test('does not preload declared document files', async () => {
    const detectedArtifacts: ReturnType<typeof detectArtifactsFromMessages> = [];
    const service = new ArtifactDetectionService(detected => detectedArtifacts.push(...detected));

    await service.processMessages(
      [
        {
          id: 'write-xls',
          type: 'tool_use',
          content: '',
          timestamp: 1,
          metadata: {
            toolName: 'write',
            toolInput: { path: 'C:/workspace/scores.xls' },
          },
        },
      ],
      'session-xls',
    );

    expect(detectedArtifacts).toHaveLength(1);
    expect(detectedArtifacts[0].artifact).toMatchObject({ type: 'document', content: '' });
  });

  test('keeps declared artifact metadata available before preview', async () => {
    const detectedArtifacts: ReturnType<typeof detectArtifactsFromMessages> = [];
    const service = new ArtifactDetectionService(
      detected => detectedArtifacts.push(...detected),
    );

    await service.processMessages(
      [
        {
          id: 'declare-model',
          type: 'tool_use',
          content: '',
          timestamp: 1,
          metadata: {
            toolName: 'declare_artifact',
            toolInput: {
              filePath: 'C:/workspace/model.stl',
              role: 'deliverable',
            },
          },
        },
      ],
      'session-model',
    );

    expect(detectedArtifacts[0]?.artifact).toMatchObject({
      type: 'model',
      filePath: 'C:/workspace/model.stl',
    });
  });
});
