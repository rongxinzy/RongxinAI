/**
 * Session-to-lane index for builtin (Pi) lanes, extracted from the service
 * inheritance chain as a collaborator (work package I.3). Owns the positive
 * mapping and the negative cache; the ordering contract documented on
 * isLaneSession (the mapping registers on the session's first event, before
 * the streaming-text interest resolver can ask) is preserved by the callers.
 */
export class CodingLaneSessionIndex {
  private readonly laneBySession = new Map<string, string>();
  private readonly nonLaneSessions = new Set<string>();

  laneIdFor(sessionId: string): string | undefined {
    return this.laneBySession.get(sessionId);
  }

  register(sessionId: string, laneId: string): void {
    this.laneBySession.set(sessionId, laneId);
  }

  /**
   * Drop the whole negative cache. Registration paths call this when a new
   * builtin lane mapping is added (the previous behavior: any session could
   * map to a lane from then on).
   */
  clearNonLaneSessions(): void {
    this.nonLaneSessions.clear();
  }

  forget(sessionId: string): void {
    this.laneBySession.delete(sessionId);
  }

  markNonLane(sessionId: string): void {
    if (!this.laneBySession.has(sessionId)) this.nonLaneSessions.add(sessionId);
  }

  isLaneSession(sessionId: string): boolean {
    return this.laneBySession.has(sessionId);
  }

  /** Whether an event for this session is worth normalizing at all. */
  shouldTrackSession(sessionId: string): boolean {
    return !this.nonLaneSessions.has(sessionId);
  }

  clear(): void {
    this.laneBySession.clear();
    this.nonLaneSessions.clear();
  }
}
