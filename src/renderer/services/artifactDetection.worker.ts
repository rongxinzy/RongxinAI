import type { CoworkMessage } from '../types/cowork';
import { ArtifactDetectionRequestKind } from './artifactDetection.constants';
import { detectArtifactsFromMessages, type DetectedArtifact } from './artifactParser';

interface ArtifactDetectionWorkerRequestBase {
  sessionId: string;
  seq: number;
}

export interface ArtifactDetectionSnapshotRequest extends ArtifactDetectionWorkerRequestBase {
  kind: typeof ArtifactDetectionRequestKind.Snapshot;
  messages: CoworkMessage[];
}

export interface ArtifactDetectionPatchRequest extends ArtifactDetectionWorkerRequestBase {
  kind: typeof ArtifactDetectionRequestKind.Patch;
  upserts: CoworkMessage[];
  relatedMessages: CoworkMessage[];
  removedMessageIds: string[];
  messageOrder?: string[];
}

export type ArtifactDetectionWorkerRequest =
  | ArtifactDetectionSnapshotRequest
  | ArtifactDetectionPatchRequest;

export interface ArtifactDetectionWorkerResponse {
  artifacts: DetectedArtifact[];
  seq: number;
  error?: string;
}

let activeSessionId: string | null = null;
const messagesById = new Map<string, CoworkMessage>();
let messageOrder: string[] = [];

function resetSession(sessionId: string): void {
  activeSessionId = sessionId;
  messagesById.clear();
  messageOrder = [];
}

function upsertMessages(messages: CoworkMessage[]): void {
  const knownMessageIds = new Set(messageOrder);
  for (const message of messages) {
    messagesById.set(message.id, message);
    if (!knownMessageIds.has(message.id)) {
      messageOrder.push(message.id);
      knownMessageIds.add(message.id);
    }
  }
}

function applySnapshot(request: ArtifactDetectionSnapshotRequest): void {
  resetSession(request.sessionId);
  for (const message of request.messages) messagesById.set(message.id, message);
  messageOrder = request.messages.map(message => message.id);
}

function applyPatch(request: ArtifactDetectionPatchRequest): void {
  if (activeSessionId !== request.sessionId) {
    throw new Error('Artifact detection patch received before a session snapshot');
  }

  for (const messageId of request.removedMessageIds) {
    messagesById.delete(messageId);
  }
  upsertMessages([...request.upserts, ...request.relatedMessages]);

  if (request.messageOrder) {
    messageOrder = request.messageOrder.filter(messageId => messagesById.has(messageId));
  } else {
    messageOrder = messageOrder.filter(messageId => messagesById.has(messageId));
  }
}

self.onmessage = (event: MessageEvent<ArtifactDetectionWorkerRequest>) => {
  const request = event.data;
  const { sessionId, seq } = request;
  try {
    if (request.kind === ArtifactDetectionRequestKind.Snapshot) {
      applySnapshot(request);
    } else {
      applyPatch(request);
    }
    const artifacts = detectArtifactsFromMessages(
      messageOrder
        .map(messageId => messagesById.get(messageId))
        .filter((message): message is CoworkMessage => message !== undefined),
      sessionId,
    );
    self.postMessage({ artifacts, seq } satisfies ArtifactDetectionWorkerResponse);
  } catch (error) {
    self.postMessage({
      artifacts: [],
      seq,
      error: error instanceof Error ? error.message : String(error),
    } satisfies ArtifactDetectionWorkerResponse);
  }
};
