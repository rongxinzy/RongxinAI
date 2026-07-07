import type { CoworkMessage } from '../types/cowork';
import { detectArtifactsFromMessages, type DetectedArtifact } from './artifactParser';

export interface ArtifactDetectionWorkerRequest {
  messages: CoworkMessage[];
  sessionId: string;
  seq: number;
}

export interface ArtifactDetectionWorkerResponse {
  artifacts: DetectedArtifact[];
  seq: number;
  error?: string;
}

self.onmessage = (event: MessageEvent<ArtifactDetectionWorkerRequest>) => {
  const { messages, sessionId, seq } = event.data;
  try {
    const artifacts = detectArtifactsFromMessages(messages, sessionId);
    self.postMessage({ artifacts, seq } satisfies ArtifactDetectionWorkerResponse);
  } catch (error) {
    self.postMessage({
      artifacts: [],
      seq,
      error: error instanceof Error ? error.message : String(error),
    } satisfies ArtifactDetectionWorkerResponse);
  }
};
