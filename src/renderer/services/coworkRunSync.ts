import { CoworkRunPolicy, type CoworkRunSnapshot } from '../../shared/cowork/runState';
import { store } from '../store';
import { acceptsRunSnapshot, receiveRunSnapshot } from '../store/slices/coworkRunSlice';

export class CoworkRunSync {
  private disposed = false;
  private readonly recovering = new Set<string>();
  private readonly polling = new Set<string>();
  private readonly recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly flushContent: () => void,
    private readonly recoverCanonicalSession: (sessionId: string) => Promise<void>,
  ) {}

  receive(snapshot: CoworkRunSnapshot): void {
    if (this.disposed) return;
    const previous = store.getState().coworkRun?.bySession[snapshot.sessionId];
    if (
      snapshot.startedAt < (store.getState().coworkRun?.awaitingSince[snapshot.sessionId] ?? 0) ||
      !acceptsRunSnapshot(previous, snapshot)
    )
      return;
    store.dispatch(receiveRunSnapshot(snapshot));
  }

  requestRecovery(sessionId: string): void {
    if (this.disposed || this.recovering.has(sessionId) || this.recoveryTimers.has(sessionId))
      return;
    this.recoveryTimers.set(
      sessionId,
      setTimeout(() => {
        this.recoveryTimers.delete(sessionId);
        void this.recover(sessionId);
      }, CoworkRunPolicy.EmitMs),
    );
  }

  async recover(sessionId: string): Promise<void> {
    const api = window.electron?.cowork;
    if (this.disposed || !api?.getRunSnapshot || this.recovering.has(sessionId)) return;
    this.recovering.add(sessionId);
    try {
      this.flushContent();
      const result = await api.getRunSnapshot(sessionId);
      if (this.disposed || !result.success) return;
      const expectedStart = store.getState().coworkRun?.awaitingSince[sessionId];
      if (expectedStart && (!result.snapshot || result.snapshot.startedAt < expectedStart)) return;
      // Pi UI recovery owns lifecycle watermarks and history merging for Work and Chat.
      await this.recoverCanonicalSession(sessionId);
      if (this.disposed) return;
      const replay = await api.getRunSnapshot(sessionId, true);
      if (!this.disposed && replay.success && replay.snapshot) this.receive(replay.snapshot);
    } catch (error) {
      console.warn('[CoworkRunSync] runtime recovery failed:', error);
    } finally {
      this.recovering.delete(sessionId);
    }
  }

  start(): () => void {
    const api = window.electron?.cowork;
    if (!api?.getRunSnapshot || !api.onStreamRunState) {
      // Even without a live API the sync must disarm pending recovery timers on
      // teardown, otherwise they fire after disposal.
      return () => {
        this.disposed = true;
        for (const pending of this.recoveryTimers.values()) clearTimeout(pending);
        this.recoveryTimers.clear();
      };
    }
    const remove = api.onStreamRunState(snapshot => {
      const previous = store.getState().coworkRun?.bySession[snapshot.sessionId];
      this.receive(snapshot);
      if (
        !snapshot.running ||
        !previous ||
        (previous.runId === snapshot.runId && snapshot.sequence > previous.sequence + 1)
      ) {
        this.requestRecovery(snapshot.sessionId);
      }
    });
    const poll = async (id: string) => {
      if (this.polling.has(id) || this.disposed) return;
      this.polling.add(id);
      try {
        const result = await api.getRunSnapshot(id);
        if (!this.disposed && result.success && result.snapshot) {
          const previous = store.getState().coworkRun?.bySession[id];
          if (!previous || result.snapshot.sequence > previous.sequence) this.requestRecovery(id);
          this.receive(result.snapshot);
        } else if (!this.disposed && result.success && !result.running) {
          this.requestRecovery(id);
        }
      } catch (error) {
        console.debug('[CoworkRunSync] runtime confirmation failed:', error);
      } finally {
        this.polling.delete(id);
      }
    };
    const timer = window.setInterval(() => {
      for (const id of store.getState().cowork.streamingSessionIds.slice(0, 32)) void poll(id);
    }, CoworkRunPolicy.PollMs);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const state = store.getState().cowork;
      for (const id of new Set([
        state.currentSessionId,
        ...state.streamingSessionIds.slice(0, 32),
      ])) {
        if (id && !id.startsWith('temp-')) this.requestRecovery(id);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    onVisible();
    return () => {
      this.disposed = true;
      remove();
      window.clearInterval(timer);
      for (const pending of this.recoveryTimers.values()) clearTimeout(pending);
      this.recoveryTimers.clear();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }
}
