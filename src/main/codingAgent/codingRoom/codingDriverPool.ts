import type { CodingAgentDriver } from '../drivers/codingAgentDriver';
import { CodingErrorMessage } from '../../../shared/codingAgent';
import type { DriverSession } from './runtimeContract';

/**
 * Owns lane and authentication drivers, including stops that outlive their request.
 */
export class CodingDriverPool {
  private readonly drivers = new Map<string, CodingAgentDriver>();
  private readonly profileIds = new Map<string, string>();
  private readonly stopping = new Map<CodingAgentDriver, Promise<void>>();
  private closing = false;
  private readonly sessions = new Map<string, DriverSession>();
  private readonly sessionPromises = new Map<
    string,
    Promise<{ id: string; recoveryContext: string | null }>
  >();

  driverFor(laneId: string): CodingAgentDriver | undefined {
    return this.drivers.get(laneId);
  }

  register(laneId: string, driver: CodingAgentDriver, profileId: string): void {
    this.assertOpen();
    this.drivers.set(laneId, driver);
    this.profileIds.set(laneId, profileId);
  }

  get isClosing(): boolean {
    return this.closing;
  }

  assertOpen(): void {
    if (this.closing) throw new Error(CodingErrorMessage.RoomShuttingDown);
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

  retire(laneId: string): Promise<void> {
    const driver = this.drivers.get(laneId);
    this.drivers.delete(laneId);
    this.profileIds.delete(laneId);
    this.sessions.delete(laneId);
    this.sessionPromises.delete(laneId);
    return driver ? this.stop(driver) : Promise.resolve();
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
      const driver = this.drivers.get(laneId);
      if (!driver) continue;
      await this.stop(driver);
      if (this.drivers.get(laneId) !== driver) continue;
      this.drivers.delete(laneId);
      this.profileIds.delete(laneId);
      this.sessions.delete(laneId);
    }
  }

  private stop(driver: CodingAgentDriver): Promise<void> {
    const pending = this.stopping.get(driver);
    if (pending) return pending;
    const stopping = Promise.resolve()
      .then(() => driver.dispose())
      .finally(() => this.stopping.delete(driver));
    this.stopping.set(driver, stopping);
    return stopping;
  }

  async disposeAll(): Promise<void> {
    this.closing = true;
    for (const driver of this.drivers.values()) this.stop(driver);
    this.drivers.clear();
    this.profileIds.clear();
    this.sessions.clear();
    this.sessionPromises.clear();
    const results = await Promise.allSettled(this.stopping.values());
    const failures = results.flatMap(result =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length) throw new AggregateError(failures, 'Failed to stop Coding Room drivers.');
  }
}
