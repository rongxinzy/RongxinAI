/**
 * Turn bookkeeping for coding lanes, extracted from the service inheritance
 * chain as a collaborator (work package I.3). Owns three kinds of state:
 * per-lane turn generations (a cancel marks the current generation
 * superseded), the staged-lane set (lanes mid-bootstrap that should not get
 * per-event publishes), and the in-flight turn promises the service awaits
 * before closing the repository.
 */
export class CodingTurnTracker {
  private readonly laneTurnGenerations = new Map<string, number>();
  private readonly cancelledTurnGenerations = new Map<string, number>();
  private readonly stagedLaneIds = new Set<string>();
  private readonly inFlightTurns = new Set<Promise<void>>();

  stageLane(laneId: string): void {
    this.stagedLaneIds.add(laneId);
  }

  unstageLane(laneId: string): void {
    this.stagedLaneIds.delete(laneId);
  }

  isLaneStaged(laneId: string): boolean {
    return this.stagedLaneIds.has(laneId);
  }

  /** Mark the lane's current turn generation cancelled; the next turn supersedes it. */
  cancelCurrentTurn(laneId: string): void {
    const active = this.laneTurnGenerations.get(laneId);
    if (active !== undefined) {
      this.cancelledTurnGenerations.set(laneId, active);
    }
  }

  beginLaneTurn(laneId: string): number {
    const turnGeneration = (this.laneTurnGenerations.get(laneId) ?? 0) + 1;
    this.laneTurnGenerations.set(laneId, turnGeneration);
    return turnGeneration;
  }

  /** Whether this generation was cancelled and not yet consumed. */
  consumeCancelledTurn(laneId: string, turnGeneration: number): boolean {
    if (this.cancelledTurnGenerations.get(laneId) !== turnGeneration) {
      return false;
    }
    this.cancelledTurnGenerations.delete(laneId);
    return true;
  }

  trackTurn(turn: Promise<void>): void {
    const tracked = turn
      .catch(error => {
        // runTurn records turn failures itself; a rejection here means the
        // failure handler itself threw, e.g. the repository was closed first.
        console.error('[CodingRoom] turn failure handling did not complete:', error);
      })
      .finally(() => {
        this.inFlightTurns.delete(tracked);
      });
    this.inFlightTurns.add(tracked);
  }

  async settleInFlightTurns(): Promise<void> {
    await Promise.all([...this.inFlightTurns]);
  }
}
