import type { CoworkMessage } from '../types/cowork';
import { ArtifactDetectionRequestKind } from './artifactDetection.constants';
import { ArtifactDetectionIndex } from './artifactDetectionIndex';
import type { DetectedArtifact } from './artifactParser';

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
const artifactIndex = new ArtifactDetectionIndex();

function resetSession(sessionId: string): void {
  activeSessionId = sessionId;
  artifactIndex.clear();
}

self.onmessage = (event: MessageEvent<ArtifactDetectionWorkerRequest>) => {
  const request = event.data;
  const { seq } = request;
  try {
    if (request.kind === ArtifactDetectionRequestKind.Snapshot) {
      resetSession(request.sessionId);
      artifactIndex.replace(request.messages, request.sessionId);
    } else {
      if (activeSessionId !== request.sessionId) {
        throw new Error('Artifact detection patch received before a session snapshot');
      }
      artifactIndex.applyPatch(
        request.upserts,
        request.relatedMessages,
        request.removedMessageIds,
        request.messageOrder,
        request.sessionId,
      );
    }
    const artifacts = artifactIndex.getArtifacts();
    self.postMessage({ artifacts, seq } satisfies ArtifactDetectionWorkerResponse);
  } catch (error) {
    self.postMessage({
      artifacts: [],
      seq,
      error: error instanceof Error ? error.message : String(error),
    } satisfies ArtifactDetectionWorkerResponse);
  }
};
