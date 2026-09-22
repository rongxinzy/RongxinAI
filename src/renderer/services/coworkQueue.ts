import type { CoworkPendingMessage } from '../../shared/cowork/pendingMessageQueue';
import type { CoworkFileAttachment, CoworkImageAttachment } from '../types/cowork';

type QueueListener = (items: CoworkPendingMessage[]) => void;

class CoworkQueueService {
  private readonly itemsBySession = new Map<string, CoworkPendingMessage[]>();
  private readonly listenersBySession = new Map<string, Set<QueueListener>>();
  private readonly revisionsBySession = new Map<string, number>();
  private streamCleanup: (() => void) | null = null;

  subscribe(sessionId: string, listener: QueueListener): () => void {
    this.ensureStreamListener();
    const listeners = this.listenersBySession.get(sessionId) ?? new Set<QueueListener>();
    listeners.add(listener);
    this.listenersBySession.set(sessionId, listeners);
    listener(this.itemsBySession.get(sessionId) ?? []);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listenersBySession.delete(sessionId);
    };
  }

  async load(sessionId: string): Promise<CoworkPendingMessage[]> {
    this.ensureStreamListener();
    const revisionAtRequest = this.revisionsBySession.get(sessionId) ?? 0;
    const result = await window.electron.cowork.listPendingMessages(sessionId);
    if (!result.success) throw new Error(result.error || 'Failed to load pending messages.');
    if ((this.revisionsBySession.get(sessionId) ?? 0) === revisionAtRequest) {
      this.publish(sessionId, result.items ?? []);
      return result.items ?? [];
    }
    return this.itemsBySession.get(sessionId) ?? [];
  }

  enqueue(
    sessionId: string,
    text: string,
    imageAttachments?: CoworkImageAttachment[],
    fileAttachments?: CoworkFileAttachment[],
    skillIds?: string[],
    skillPrompt?: string,
  ) {
    return window.electron.cowork.enqueuePendingMessage({
      sessionId,
      text,
      imageAttachments,
      fileAttachments,
      skillIds,
      skillPrompt,
    });
  }

  update(sessionId: string, itemId: string, text: string) {
    return window.electron.cowork.updatePendingMessage({ sessionId, itemId, text });
  }

  remove(sessionId: string, itemId: string) {
    return window.electron.cowork.deletePendingMessage({ sessionId, itemId });
  }

  steer(sessionId: string, itemId: string) {
    return window.electron.cowork.steerPendingMessage({ sessionId, itemId });
  }

  followUp(sessionId: string, itemId: string) {
    return window.electron.cowork.followUpPendingMessage({ sessionId, itemId });
  }

  dispose(): void {
    this.streamCleanup?.();
    this.streamCleanup = null;
    this.itemsBySession.clear();
    this.revisionsBySession.clear();
    this.listenersBySession.clear();
  }

  private ensureStreamListener(): void {
    if (this.streamCleanup || !window.electron?.cowork?.onStreamQueueUpdated) return;
    this.streamCleanup = window.electron.cowork.onStreamQueueUpdated(({ sessionId, items }) => {
      this.publish(sessionId, items);
    });
  }

  private publish(sessionId: string, items: CoworkPendingMessage[]): void {
    const snapshot = items.map(item => ({ ...item }));
    this.itemsBySession.set(sessionId, snapshot);
    this.revisionsBySession.set(sessionId, (this.revisionsBySession.get(sessionId) ?? 0) + 1);
    this.listenersBySession.get(sessionId)?.forEach(listener => listener(snapshot));
  }
}

export const coworkQueueService = new CoworkQueueService();
