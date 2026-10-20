import { t } from '../../i18n';
import type { CodingAgentDriver } from '../drivers/codingAgentDriver';
import {
  CodingEventKind,
  CodingErrorMessage,
  type CodingAgentLane,
  type CodingAgentProfile,
} from '../../../shared/codingAgent';
import { CodingRoomServiceFoundation } from './serviceFoundation';

/**
 * Config options and slash commands are persisted as JSON, so the cheapest
 * faithful comparison is the one the repository itself round-trips through.
 */
const projectsEqual = (left: readonly unknown[], right: readonly unknown[]): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

/** Owns the per-lane agent drivers and their live sessions. */
export abstract class CodingRoomServiceDriverLifecycle extends CodingRoomServiceFoundation {
  protected getDriver(lane: CodingAgentLane): CodingAgentDriver {
    const existing = this.driverPool.driverFor(lane.id);
    if (existing) return existing;
    const profile = this.registry.get(lane.profileId);
    if (!profile) throw new Error(CodingErrorMessage.ProfileNotFound);
    const driver = this.driverFactory.create(profile);
    this.registerDriver(lane, profile, driver);
    return driver;
  }

  protected registerDriver(
    lane: CodingAgentLane,
    profile: CodingAgentProfile,
    driver: CodingAgentDriver,
  ): void {
    driver.onAvailableCommandsChanged((_sessionId, commands) => {
      this.repository.updateLaneAvailableCommands(lane.id, commands);
      if (!this.stagedLaneIds.has(lane.id)) this.publishLane(lane.id);
    });
    driver.onSessionTitleChanged((_sessionId, title) => {
      this.repository.updateMissionTitle(lane.missionId, title);
      if (!this.stagedLaneIds.has(lane.id)) this.publishLane(lane.id);
    });
    this.driverPool.register(lane.id, driver, profile.id);
  }

  /**
   * Re-projects what a bound driver advertises for its session. An empty
   * snapshot never clears the lane: ACP agents publish removals through
   * `onAvailableCommandsChanged`, and a freshly created driver has no session
   * state to report yet.
   */
  protected syncLaneDriverSnapshot(
    lane: CodingAgentLane,
    driver: CodingAgentDriver,
    sessionId: string,
  ): void {
    const commands = driver.getSessionAvailableCommands(sessionId);
    if (commands.length > 0 && !projectsEqual(commands, lane.availableCommands)) {
      this.repository.updateLaneAvailableCommands(lane.id, commands);
      lane.availableCommands = commands;
    }
    const configOptions = driver.getSessionConfigOptions(sessionId);
    if (configOptions.length > 0 && !projectsEqual(configOptions, lane.configOptions)) {
      this.repository.updateLaneConfigOptions(lane.id, configOptions);
      lane.configOptions = configOptions;
    }
  }

  protected async rollbackCreatedSession(roomId: string, lane: CodingAgentLane): Promise<void> {
    const driver = this.driverPool.driverFor(lane.id);
    const session = this.driverPool.sessionFor(lane.id);
    if (driver && session) {
      try {
        await driver.disposeSession(session.id);
      } catch {
        // The failed creation is already being rolled back locally.
      }
    }
    if (driver) {
      try {
        await driver.dispose();
      } catch {
        // The failed creation is already being rolled back locally.
      }
    }
    this.driverPool.forget(lane.id);
    this.laneSessionIndex.forget(lane.localSessionId);
    this.repository.deleteMission(roomId, lane.missionId);
  }

  protected async ensureDriverSession(
    driver: CodingAgentDriver,
    lane: CodingAgentLane,
    workspaceRoot: string,
  ): Promise<{ id: string; recoveryContext: string | null }> {
    const activeSession = this.driverPool.sessionFor(lane.id);
    if (
      activeSession &&
      (activeSession.connectionGeneration === null ||
        (driver.isConnectionRunning?.() &&
          driver.getConnectionGeneration?.() === activeSession.connectionGeneration))
    ) {
      // A bound session can outlive its lane row (legacy rows, restored lanes),
      // and the built-in driver streams no events to re-project them, so refresh
      // the advertised commands and config options every time the lane opens.
      this.syncLaneDriverSnapshot(lane, driver, activeSession.id);
      return { id: activeSession.id, recoveryContext: null };
    }
    const pendingSession = this.driverPool.pendingSessionFor(lane.id);
    if (pendingSession) return await pendingSession;
    const sessionPromise = this.openDriverSession(driver, lane, workspaceRoot);
    this.driverPool.setPendingSession(lane.id, sessionPromise);
    try {
      return await sessionPromise;
    } finally {
      this.driverPool.clearPendingSessionIf(lane.id, sessionPromise);
    }
  }

  private async openDriverSession(
    driver: CodingAgentDriver,
    lane: CodingAgentLane,
    workspaceRoot: string,
  ): Promise<{ id: string; recoveryContext: string | null }> {
    let recoveryContext: string | null = null;
    let session;
    if (lane.remoteSessionId) {
      try {
        session = await driver.loadSession({
          remoteSessionId: lane.remoteSessionId,
          workspaceRoot,
        });
      } catch (error) {
        recoveryContext = this.buildRecoveryContext(lane.id);
        this.repository.appendEvent(lane.id, CodingEventKind.Message, {
          role: 'system',
          content: t('codingAgentSessionRecovery'),
          error: this.errorMessage(error),
        });
        session = await driver.createSession({
          workspaceRoot,
          localSessionId: lane.localSessionId,
          existingConfigOptions: lane.configOptions,
        });
      }
    } else {
      session = await driver.createSession({
        workspaceRoot,
        localSessionId: lane.localSessionId,
        existingConfigOptions: lane.configOptions,
      });
    }
    this.driverPool.setSession(lane.id, {
      id: session.id,
      connectionGeneration: driver.getConnectionGeneration?.() ?? null,
    });
    if (session.remoteSessionId !== lane.remoteSessionId) {
      this.repository.updateLaneRemoteSession(lane.id, session.remoteSessionId);
    }
    this.repository.updateLaneConfigOptions(lane.id, session.configOptions);
    this.repository.updateLaneAvailableCommands(lane.id, session.availableCommands);
    return { id: session.id, recoveryContext };
  }

  protected eventsToAnswer(laneId: string): string {
    return this.repository
      .listEvents([laneId])
      .map(event => event.payload.content)
      .filter((content): content is string => typeof content === 'string')
      .join('\n');
  }

  private buildRecoveryContext(laneId: string): string {
    const context = this.eventsToAnswer(laneId).trim();
    return context
      ? `Continue this coding task from the following handoff summary:\n${context}`
      : 'Continue this coding task in a new session. The prior session is unavailable.';
  }
}
