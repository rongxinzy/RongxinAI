import type { PiUiEvent } from '../../shared/cowork/piUiEvent';
import { CoworkSessionStatus } from '../../shared/cowork/constants';
import {
  piUiLifecycleStatus,
  type PiUiRuntimeSnapshot,
} from '../../shared/cowork/piUiRuntimeSnapshot';
import type { CoworkSession } from '../types/cowork';

interface RecoveryDependencies {
  readRuntime: (sessionId?: string) => Promise<PiUiRuntimeSnapshot[]>;
  readSession: (sessionId: string) => Promise<CoworkSession | null>;
  prepare: (session: CoworkSession) => Promise<void>;
  applyStatus: (snapshot: PiUiRuntimeSnapshot) => void;
  applySession: (session: CoworkSession, preserveLiveContent: boolean) => void;
  flush: () => void;
}

/** Restores state without navigation. Lifecycle watermarks prevent old IPC
 * responses (or queued lifecycle events) from reviving a finished turn. */
export class PiUiRecovery {
  private readonly revisions = new Map<string, number>();
  private readonly lifecycleSequences = new Map<string, number>();
  private readonly statuses = new Map<string, PiUiRuntimeSnapshot['status']>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly requested = new Set<string>();
  private disposed = false;

  constructor(private readonly dependencies: RecoveryDependencies) {}

  observe(event: PiUiEvent): boolean {
    if (!event.sessionId) return true;
    this.revisions.set(event.sessionId, event.sequence);
    const status = piUiLifecycleStatus(event);
    if (status === null) return true;
    if (event.sequence <= (this.lifecycleSequences.get(event.sessionId) ?? -1)) return false;
    this.lifecycleSequences.set(event.sessionId, event.sequence);
    this.statuses.set(event.sessionId, status);
    return true;
  }

  async bootstrap(): Promise<void> {
    const snapshots = await this.dependencies.readRuntime();
    if (this.disposed) return;
    for (const snapshot of snapshots) this.applyStatus(snapshot);
    // Hydrate active sessions even if no more events arrive (e.g. a long tool).
    await Promise.all(
      snapshots
        .filter(snapshot => snapshot.status === CoworkSessionStatus.Running)
        .map(snapshot => this.recover(snapshot.sessionId)),
    );
  }

  recover(sessionId: string): Promise<void> {
    this.requested.add(sessionId);
    const existing = this.pending.get(sessionId);
    if (existing) return existing;
    const pending = this.drain(sessionId).finally(() => this.pending.delete(sessionId));
    this.pending.set(sessionId, pending);
    return pending;
  }

  dispose(): void {
    this.disposed = true;
    this.requested.clear();
  }

  private async drain(sessionId: string): Promise<void> {
    while (!this.disposed && this.requested.delete(sessionId)) await this.read(sessionId);
  }

  private applyStatus(snapshot: PiUiRuntimeSnapshot): boolean {
    if (
      this.disposed ||
      snapshot.sequence < (this.lifecycleSequences.get(snapshot.sessionId) ?? -1)
    ) {
      return false;
    }
    this.lifecycleSequences.set(snapshot.sessionId, snapshot.sequence);
    this.statuses.set(snapshot.sessionId, snapshot.status);
    this.dependencies.applyStatus(snapshot);
    return true;
  }

  private async read(sessionId: string): Promise<void> {
    const revision = this.revisions.get(sessionId);
    const session = await this.dependencies.readSession(sessionId);
    const [snapshot] = await this.dependencies.readRuntime(sessionId);
    if (!snapshot || this.disposed) return;
    if (session) await this.dependencies.prepare(session);
    if (this.disposed) return;
    this.dependencies.flush();
    const preserveLiveContent = revision !== this.revisions.get(sessionId);
    // A later lifecycle event may have arrived during either IPC or preparation.
    // Use its status, while merging newer live text over the older DB page.
    const status =
      snapshot.sequence < (this.lifecycleSequences.get(sessionId) ?? -1)
        ? (this.statuses.get(sessionId) ?? snapshot.status)
        : snapshot.status;
    if (session) this.dependencies.applySession({ ...session, status }, preserveLiveContent);
    this.applyStatus(snapshot);
  }
}
