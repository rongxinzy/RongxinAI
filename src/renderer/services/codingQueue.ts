import type { CoworkPendingMessage } from '../../shared/cowork/pendingMessageQueue';

type Listener = (items: CoworkPendingMessage[]) => void;

class CodingQueueService {
  constructor(private readonly workspaceRoot: string) {}
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly items = new Map<string, CoworkPendingMessage[]>();
  private streamCleanup: (() => void) | null = null;

  subscribe(sessionId: string, listener: Listener): () => void {
    this.ensureStreamListener();
    const set = this.listeners.get(sessionId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(sessionId, set);
    listener(this.items.get(sessionId) ?? []);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(sessionId);
      if (this.listeners.size === 0) {
        this.streamCleanup?.();
        this.streamCleanup = null;
      }
    };
  }
  async load(sessionId: string): Promise<CoworkPendingMessage[]> {
    const result = await window.electron.codingAgent.listPendingMessages(sessionId);
    if (!result.success) throw new Error(result.error ?? 'Failed to load pending messages.');
    const items = result.items ?? [];
    this.publish(sessionId, items);
    return items;
  }
  update(sessionId: string, itemId: string, text: string) {
    return window.electron.codingAgent.updatePendingMessage({ laneId: sessionId, itemId, text }).then(result => {
      if (result.success) void this.load(sessionId);
      return result;
    });
  }
  remove(sessionId: string, itemId: string) {
    return window.electron.codingAgent.deletePendingMessage({ laneId: sessionId, itemId }).then(result => {
      if (result.success) void this.load(sessionId);
      return result;
    });
  }
  steer(sessionId: string, itemId: string) {
    const laneId = sessionId;
    return window.electron.codingAgent.steerPendingMessage({
      workspaceRoot: this.workspaceRoot,
      laneId,
      itemId,
    }).then(result => {
      if (result.success) void this.load(sessionId);
      return result;
    });
  }
  followUp(sessionId: string, itemId: string) {
    return window.electron.codingAgent
      .followUpPendingMessage({ workspaceRoot: this.workspaceRoot, laneId: sessionId, itemId })
      .then(result => {
        if (result.success) void this.load(sessionId);
        return result;
      });
  }
  publish(sessionId: string, items: CoworkPendingMessage[]) {
    const snapshot = items.map(item => ({ ...item }));
    this.items.set(sessionId, snapshot);
    this.listeners.get(sessionId)?.forEach(listener => listener(snapshot));
  }
  private ensureStreamListener(): void {
    if (this.streamCleanup) return;
    this.streamCleanup = window.electron.codingAgent.onPendingMessagesChanged(event => {
      this.publish(event.laneId, event.items);
    });
  }
}

export const createCodingQueueService = (workspaceRoot: string) => new CodingQueueService(workspaceRoot);
