import type { Artifact } from '../types/artifact';
import type { CoworkMessage } from '../types/cowork';
import type { ArtifactDetectionWorkerRequest, ArtifactDetectionWorkerResponse } from './artifactDetection.worker';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const BINARY_DOCUMENT_EXTENSIONS = new Set(['.docx', '.xlsx', '.pptx', '.pdf']);

function getExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filePath.slice(lastDot).toLowerCase();
}

function isImageExtension(ext: string): boolean {
  return IMAGE_EXTENSIONS.has(ext.toLowerCase());
}

function isBinaryDocumentExtension(ext: string): boolean {
  return BINARY_DOCUMENT_EXTENSIONS.has(ext.toLowerCase());
}

export type ArtifactDetectionResult = {
  artifact: Artifact;
  needsFileLoad: boolean;
};

export class ArtifactDetectionService {
  private worker: Worker | null = null;
  private pending = new Map<number, (result: ArtifactDetectionResult[]) => void>();
  private seq = 0;
  private processedMessageIds = new Set<string>();
  private loadedFileIds = new Set<string>();

  constructor(
    private onDetected: (artifacts: ArtifactDetectionResult[]) => void,
    private onFileLoaded: (artifact: Artifact) => void,
    private readFile?: (absPath: string) => Promise<{ success: boolean; dataUrl?: string } | null | undefined>,
  ) {}

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./artifactDetection.worker.ts', import.meta.url), { type: 'module' });
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
    worker.onerror = (error) => {
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
   * Process only messages that have not been processed yet.
   *
   * For incremental detection we send the full message list because tool_use
   * messages need to be paired with their tool_result, and the result may
   * arrive later. The worker deduplicates via message ids naturally; we just
   * avoid redundant work on the caller side by remembering the last message
   * count and re-sending from the start only when new messages appear.
   */
  async processMessages(
    messages: CoworkMessage[],
    sessionId: string,
    cwd?: string | null,
  ): Promise<void> {
    const unprocessed = messages.filter((m) => !this.processedMessageIds.has(m.id));
    if (unprocessed.length === 0) return;

    for (const m of messages) {
      this.processedMessageIds.add(m.id);
    }

    const detected = await this.detect(messages, sessionId);
    if (detected.length === 0) return;

    this.onDetected(detected);
    await this.loadFiles(detected, cwd);
  }

  reset(): void {
    this.processedMessageIds.clear();
    this.loadedFileIds.clear();
  }

  private detect(messages: CoworkMessage[], sessionId: string): Promise<ArtifactDetectionResult[]> {
    return new Promise((resolve) => {
      const seq = ++this.seq;
      this.pending.set(seq, resolve);
      this.ensureWorker().postMessage({ messages, sessionId, seq } satisfies ArtifactDetectionWorkerRequest);
    });
  }

  private async loadFiles(detected: ArtifactDetectionResult[], cwd?: string | null): Promise<void> {
    if (!this.readFile) return;
    const toLoad = detected.filter((d) => d.needsFileLoad && d.artifact.filePath && !this.loadedFileIds.has(d.artifact.id));
    if (toLoad.length === 0) return;

    for (const { artifact } of toLoad) {
      let rawPath = artifact.filePath!;
      rawPath = this.toAbsolutePath(rawPath);
      const absPath = rawPath.startsWith('/')
        ? rawPath
        : (/^[A-Za-z]:/.test(rawPath) ? rawPath : `${cwd ?? ''}/${rawPath}`);
      try {
        const result = await this.readFile(absPath);
        if (result?.success && result.dataUrl) {
          const ext = getExtension(absPath);
          const isTextType = !isImageExtension(ext) && !isBinaryDocumentExtension(ext);
          let content = result.dataUrl;
          if (isTextType) {
            try {
              const base64 = result.dataUrl.split(',')[1] || '';
              const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
              content = new TextDecoder('utf-8').decode(bytes);
            } catch {
              content = result.dataUrl;
            }
          }
          this.loadedFileIds.add(artifact.id);
          this.onFileLoaded({ ...artifact, content, filePath: absPath });
        } else {
          this.loadedFileIds.add(artifact.id);
        }
      } catch {
        this.loadedFileIds.add(artifact.id);
      }
    }
  }

  private toAbsolutePath(rawPath: string): string {
    let p = rawPath;
    if (p.startsWith('file:///')) p = p.slice(7);
    else if (p.startsWith('file://')) p = p.slice(7);
    else if (p.startsWith('file:/')) p = p.slice(5);
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
    return p;
  }
}
