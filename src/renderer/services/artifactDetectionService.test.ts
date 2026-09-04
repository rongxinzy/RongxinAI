import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ArtifactRole } from '../types/artifact';
import type { CoworkMessage } from '../types/cowork';
import { ArtifactDetectionRequestKind } from './artifactDetection.constants';
import { ArtifactDetectionService } from './artifactDetectionService';
import type {
  ArtifactDetectionWorkerRequest,
  ArtifactDetectionWorkerResponse,
} from './artifactDetection.worker';
import { detectArtifactsFromMessages } from './artifactParser';

class FakeArtifactDetectionWorker {
  static requests: ArtifactDetectionWorkerRequest[] = [];
  private messages = new Map<string, CoworkMessage>();
  private messageOrder: string[] = [];

  onmessage: ((event: MessageEvent<ArtifactDetectionWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  postMessage(request: ArtifactDetectionWorkerRequest): void {
    FakeArtifactDetectionWorker.requests.push(request);
    if (request.kind === ArtifactDetectionRequestKind.Snapshot) {
      this.messages.clear();
      this.messageOrder = request.messages.map(message => message.id);
      for (const message of request.messages) this.messages.set(message.id, message);
    } else {
      for (const messageId of request.removedMessageIds) this.messages.delete(messageId);
      for (const message of [...request.upserts, ...request.relatedMessages]) {
        this.messages.set(message.id, message);
        if (!this.messageOrder.includes(message.id)) this.messageOrder.push(message.id);
      }
      this.messageOrder = request.messageOrder ?? this.messageOrder;
      this.messageOrder = this.messageOrder.filter(messageId => this.messages.has(messageId));
    }
    const messages = this.messageOrder
      .map(messageId => this.messages.get(messageId))
      .filter((message): message is CoworkMessage => message !== undefined);
    this.onmessage?.({
      data: {
        seq: request.seq,
        artifacts: detectArtifactsFromMessages(messages, request.sessionId),
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
    expect(FakeArtifactDetectionWorker.requests[0]?.kind).toBe(
      ArtifactDetectionRequestKind.Snapshot,
    );
    const patchRequest = FakeArtifactDetectionWorker.requests[1];
    expect(patchRequest?.kind).toBe(ArtifactDetectionRequestKind.Patch);
    if (patchRequest?.kind === ArtifactDetectionRequestKind.Patch) {
      expect(patchRequest.upserts.map(message => message.id)).toEqual([messageId, toolMessageId]);
      expect(patchRequest).not.toHaveProperty('messages');
    }
    // Only the declare_artifact tool call produces an artifact
    // (the assistant message content no longer triggers file path detection)
    expect(detectedArtifacts).toHaveLength(1);
    expect(detectedArtifacts[0].artifact).toMatchObject({
      messageId: toolMessageId,
      filePath: 'C:/workspace/presentation.pptx',
      role: ArtifactRole.Deliverable,
    });
  });

  test('sends only a changed tool result and its linked tool call', async () => {
    const toolUse: CoworkMessage = {
      id: 'tool-use',
      type: 'tool_use',
      content: '',
      timestamp: 1,
      metadata: {
        toolName: 'write',
        toolUseId: 'call-1',
        toolInput: { path: 'C:/workspace/report.md' },
      },
    };
    const assistant: CoworkMessage = {
      id: 'assistant',
      type: 'assistant',
      content: 'Working',
      timestamp: 2,
      metadata: { isFinal: true },
    };
    const toolResult: CoworkMessage = {
      id: 'tool-result',
      type: 'tool_result',
      content: 'written',
      timestamp: 3,
      metadata: { toolUseId: 'call-1' },
    };
    const service = new ArtifactDetectionService(() => {});

    await service.processMessages([toolUse, assistant], 'session-2');
    await service.processMessages([toolUse, assistant, toolResult], 'session-2');

    const patchRequest = FakeArtifactDetectionWorker.requests[1];
    expect(patchRequest?.kind).toBe(ArtifactDetectionRequestKind.Patch);
    if (patchRequest?.kind !== ArtifactDetectionRequestKind.Patch) return;
    expect(patchRequest.upserts.map(message => message.id)).toEqual(['tool-result']);
    expect(patchRequest.relatedMessages.map(message => message.id)).toEqual(['tool-use']);
    expect(patchRequest.messageOrder).toEqual(['tool-use', 'assistant', 'tool-result']);
  });

  test('reports removed message ids when history shrinks', async () => {
    const message: CoworkMessage = {
      id: 'removed-message',
      type: 'assistant',
      content: 'Temporary',
      timestamp: 1,
      metadata: { isFinal: true },
    };
    const service = new ArtifactDetectionService(() => {});

    await service.processMessages([message], 'session-3');
    await service.processMessages([], 'session-3');

    const patchRequest = FakeArtifactDetectionWorker.requests[1];
    expect(patchRequest?.kind).toBe(ArtifactDetectionRequestKind.Patch);
    if (patchRequest?.kind !== ArtifactDetectionRequestKind.Patch) return;
    expect(patchRequest.upserts).toEqual([]);
    expect(patchRequest.removedMessageIds).toEqual(['removed-message']);
    expect(patchRequest.messageOrder).toEqual([]);
  });

  test('starts a new snapshot when the session id changes', async () => {
    const message: CoworkMessage = {
      id: 'same-message-id',
      type: 'assistant',
      content: 'Same content',
      timestamp: 1,
      metadata: { isFinal: true },
    };
    const service = new ArtifactDetectionService(() => {});

    await service.processMessages([message], 'session-a');
    await service.processMessages([message], 'session-b');

    expect(FakeArtifactDetectionWorker.requests).toHaveLength(2);
    expect(FakeArtifactDetectionWorker.requests[0]?.kind).toBe(
      ArtifactDetectionRequestKind.Snapshot,
    );
    expect(FakeArtifactDetectionWorker.requests[1]?.kind).toBe(
      ArtifactDetectionRequestKind.Snapshot,
    );
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
    const service = new ArtifactDetectionService(detected => detectedArtifacts.push(...detected));

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
