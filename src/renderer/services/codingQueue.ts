import type { CoworkPendingMessage } from '../../shared/cowork/pendingMessageQueue';

type Listener = (items: CoworkPendingMessage[]) => void;

class CodingQueueService {
  constructor(private readonly workspaceRoot: string) {}
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly items = new Map<string, CoworkPendingMessage[]>();

  subscribe(sessionId: string, listener: Listener): () => void {
    const set = this.listeners.get(sessionId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(sessionId, set);
    listener(this.items.get(sessionId) ?? []);
    return () => set.delete(listener);
  }
  async load(sessionId: string): Promise<CoworkPendingMessage[]> {
    const result = await window.electron.codingAgent.listPendingMessages(sessionId);
    const items = result.items ?? [];
    this.publish(sessionId, items);
    return items;
  }
  enqueue(sessionId: string, text: string) {
    return window.electron.codingAgent.enqueuePendingMessage({ laneId: sessionId, text }).then(result => {
      if (result.success) void this.load(sessionId);
      return result;
    });
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
    return this.steer(sessionId, itemId);
  }
  publish(sessionId: string, items: CoworkPendingMessage[]) {
    this.items.set(sessionId, items);
    this.listeners.get(sessionId)?.forEach(listener => listener(items));
  }
}

export const createCodingQueueService = (workspaceRoot: string) => new CodingQueueService(workspaceRoot);
