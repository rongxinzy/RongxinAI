import { CoworkRunPolicy, type CoworkRunSnapshot } from '../../shared/cowork/runState';
import { store } from '../store';
import { acceptsRunSnapshot, receiveRunSnapshot } from '../store/slices/coworkRunSlice';

/**
 * Renderer-side run-state sync.
 *
 * Push delivery (RunState) only updates the snapshot map — it never triggers
 * recovery. Lifecycle truth flows through the sequenced UiEvent stream; a lost
 * terminal event shows up as a UiEvent sequence gap (handled by the pipeline's
 * resync + PiUiRecovery), so RunState-driven re-fetches would only duplicate
 * that path. The two recovery entry points that remain:
 *
 * - `requestRecovery`/`recover`: canonical session reload (PiUiRecovery) for
 *   content gaps and late attach.
 * - focus/visibility `verify`: one cheap getRunSnapshot per session; a session
 *   that still looks streaming while the runtime says otherwise (missed
 *   terminal) escalates to recovery. An idle session verified idle touches
 *   nothing — no session reload, no content replay.
 */
export class CoworkRunSync {
  private disposed = false;
  private readonly recovering = new Set<string>();
  private readonly verifying = new Set<string>();
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
      if (!this.disposed && result.snapshot) this.receive(result.snapshot);
    } catch (error) {
      console.warn('[CoworkRunSync] runtime recovery failed:', error);
    } finally {
      this.recovering.delete(sessionId);
    }
  }

  private async verify(sessionId: string): Promise<void> {
    const api = window.electron?.cowork;
    if (this.disposed || !api?.getRunSnapshot || this.verifying.has(sessionId)) return;
    this.verifying.add(sessionId);
    try {
      const result = await api.getRunSnapshot(sessionId);
      if (this.disposed || !result.success) return;
      if (result.snapshot) this.receive(result.snapshot);
      const stillStreaming = store.getState().cowork.streamingSessionIds.includes(sessionId);
      if (stillStreaming && result.snapshot && !result.snapshot.running) {
        this.requestRecovery(sessionId);
      }
    } catch (error) {
      console.debug('[CoworkRunSync] runtime verification failed:', error);
    } finally {
      this.verifying.delete(sessionId);
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
    const remove = api.onStreamRunState(snapshot => this.receive(snapshot));
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const state = store.getState().cowork;
      for (const id of new Set([
        state.currentSessionId,
        ...state.streamingSessionIds.slice(0, 32),
      ])) {
        if (id && !id.startsWith('temp-')) void this.verify(id);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    onVisible();
    return () => {
      this.disposed = true;
      remove();
      for (const pending of this.recoveryTimers.values()) clearTimeout(pending);
      this.recoveryTimers.clear();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }
}
