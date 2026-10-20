import type { CodingAgentDriver } from '../drivers/codingAgentDriver';
import type { DriverSession } from './runtimeContract';

/**
 * Per-lane agent driver pool, extracted from the service inheritance chain
 * as a collaborator (work package I.3). Owns the four coordinated maps —
 * driver instances, profile bindings, live sessions and in-flight session
 * promises — whose entries are created and forgotten together per lane.
 * `forgetWhereProfile` deliberately leaves session promises alone, matching
 * the authentication-exit path it was extracted from.
 */
export class CodingDriverPool {
  private readonly drivers = new Map<string, CodingAgentDriver>();
  private readonly profileIds = new Map<string, string>();
  private readonly sessions = new Map<string, DriverSession>();
  private readonly sessionPromises = new Map<
    string,
    Promise<{ id: string; recoveryContext: string | null }>
  >();

  driverFor(laneId: string): CodingAgentDriver | undefined {
    return this.drivers.get(laneId);
  }

  register(laneId: string, driver: CodingAgentDriver, profileId: string): void {
    this.drivers.set(laneId, driver);
    this.profileIds.set(laneId, profileId);
  }

  sessionFor(laneId: string): DriverSession | undefined {
    return this.sessions.get(laneId);
  }

  setSession(laneId: string, session: DriverSession): void {
    this.sessions.set(laneId, session);
  }

  pendingSessionFor(
    laneId: string,
  ): Promise<{ id: string; recoveryContext: string | null }> | undefined {
    return this.sessionPromises.get(laneId);
  }

  setPendingSession(
    laneId: string,
    promise: Promise<{ id: string; recoveryContext: string | null }>,
  ): void {
    this.sessionPromises.set(laneId, promise);
  }

  clearPendingSessionIf(
    laneId: string,
    promise: Promise<{ id: string; recoveryContext: string | null }>,
  ): void {
    if (this.sessionPromises.get(laneId) === promise) {
      this.sessionPromises.delete(laneId);
    }
  }

  /** Drop every map entry for the lane. The driver's own disposal stays with the caller. */
  forget(laneId: string): void {
    this.drivers.delete(laneId);
    this.profileIds.delete(laneId);
    this.sessions.delete(laneId);
    this.sessionPromises.delete(laneId);
  }

  /**
   * Dispose and drop the drivers bound to a profile's lanes. Pending session
   * promises are left to settle on their own, matching the authentication-exit
   * path this was extracted from.
   */
  async disposeWhereProfile(profileId: string): Promise<void> {
    const laneIds: string[] = [];
    for (const [laneId, bound] of this.profileIds) {
      if (bound === profileId) laneIds.push(laneId);
    }
    for (const laneId of laneIds) {
      await this.drivers.get(laneId)?.dispose();
      this.drivers.delete(laneId);
      this.profileIds.delete(laneId);
      this.sessions.delete(laneId);
    }
  }

  allDrivers(): CodingAgentDriver[] {
    return [...this.drivers.values()];
  }

  clear(): void {
    this.drivers.clear();
    this.profileIds.clear();
    this.sessions.clear();
    this.sessionPromises.clear();
  }
}
