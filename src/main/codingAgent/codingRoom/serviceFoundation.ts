import { EventEmitter } from 'events';
import path from 'path';
import { getCodingAgentEnvironment } from '../agentEnvironment';
import { BuiltinCodingConfigId } from '../drivers/builtinCodingDriver';
import { CodingDriverFactory } from '../drivers/driverFactory';
import { CodingAgentRegistry } from '../codingAgentRegistry';
import { AuthTerminalService } from '../authTerminalService';
import { CollaborationService } from '../collaborationService';
import { CodingGitController } from '../codingGitController';
import { CodingRoomRepository } from '../codingRoomRepository';
import { CodingEventWindowReader } from '../codingEventWindowReader';
import { CodingEventDeltaBatcher } from '../codingEventDeltaBatcher';

import { WorkbenchApprovalMode } from '../../../shared/workbenchTask';
import {
  CodingAssignmentStatus,
  CodingErrorMessage,
  CodingEventKind,
  CodingEventWindowPageSize,
  type CodingAgentLane,
  type CodingAgentProfile,
  type CodingEventPage,
  type CodingRoomSnapshot,
} from '../../../shared/codingAgent';
import { CodingPendingMessageQueue } from './codingPendingMessageQueue';
import { CodingLaneSessionIndex } from './codingLaneSessionIndex';
import { CodingDriverPool } from './codingDriverPool';
import { CodingTurnTracker } from './codingTurnTracker';
import type { CodingRoomRuntime } from './runtimeContract';
import { t } from '../../i18n';
import type { CodingAgentDriver } from '../drivers/codingAgentDriver';

/**
 * Shared state and cross-cutting helpers every coding-room layer builds on:
 * repository/registry/runtime wiring, snapshots, publishing and lane lookups.
 */
/**
 * Config options and slash commands are persisted as JSON, so the cheapest
 * faithful comparison is the one the repository itself round-trips through.
 */
const projectsEqual = (left: readonly unknown[], right: readonly unknown[]): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

export abstract class CodingRoomServiceFoundation extends EventEmitter {
  protected readonly driverPool = new CodingDriverPool();
  protected readonly driverFactory: CodingDriverFactory;
  protected readonly collaboration = new CollaborationService();
  protected readonly authTerminals = new AuthTerminalService();
  protected readonly git: CodingGitController;
  private readonly eventWindowReader: CodingEventWindowReader;
  protected readonly eventDeltaBatcher: CodingEventDeltaBatcher;

  protected readonly pendingMessageQueue = new CodingPendingMessageQueue();
  protected readonly turnTracker = new CodingTurnTracker();
  protected readonly laneSessionIndex = new CodingLaneSessionIndex();

  constructor(
    protected readonly repository: CodingRoomRepository,
    readonly registry: CodingAgentRegistry,
    protected readonly runtime: CodingRoomRuntime,
    acpEnvironment: Record<string, string | undefined> = {},
  ) {
    super();
    this.git = new CodingGitController(repository);
    this.eventWindowReader = new CodingEventWindowReader(repository.getDatabase());
    this.eventDeltaBatcher = new CodingEventDeltaBatcher(delta => this.emit('eventDelta', delta));
    const patchBuiltinSession = this.runtime.patchBuiltinSession?.bind(this.runtime);
    const listCommandChoices = this.runtime.listCommandChoices?.bind(this.runtime);
    const commandCatalogGeneration = this.runtime.commandCatalogGeneration?.bind(this.runtime);
    this.driverFactory = new CodingDriverFactory(
      {
        start: (sessionId, workspaceRoot, prompt, options) =>
          this.runtime.startBuiltinSession({
            sessionId,
            workspaceRoot,
            prompt,
            ...(options?.modelOverride ? { modelOverride: options.modelOverride } : {}),
            ...(options?.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
            ...(options?.permissionMode ? { permissionMode: options.permissionMode } : {}),
            ...(options?.goalMode ? { goalMode: true } : {}),
            ...(options?.planMode ? { planMode: true } : {}),
            ...(options?.skillIds ? { skillIds: options.skillIds } : {}),
            ...(options?.expertIds ? { expertIds: options.expertIds } : {}),
          }),
        cancel: sessionId => this.runtime.cancelBuiltinSession(sessionId),
        patchSession: patchBuiltinSession,
        setApprovalMode: this.runtime.setBuiltinApprovalMode?.bind(this.runtime),
        listCommandChoices,
        commandCatalogGeneration,
      },
      acpEnvironment,
    );
    registry.on('changed', () => {
      for (const room of this.repository.listRooms()) this.publish(room.workspaceRoot);
    });
    this.authTerminals.on('data', event => this.emit('authTerminalData', event));
    this.authTerminals.on('exit', event => {
      void this.completeTerminalAuthentication(event);
    });
  }

  /** Finishes a terminal-based authentication flow; owned by the facade layer. */
  protected abstract completeTerminalAuthentication(event: {
    id: string;
    profileId: string;
    methodId: string;
    workspaceRoot: string;
    exitCode: number;
    signal?: number;
  }): Promise<void>;

  bootstrap(
    workspaceRoot: string,
    options: { eventLimitPerLane?: number } = {},
  ): CodingRoomSnapshot {
    this.registry.refreshBuiltinReadiness();
    const room = this.repository.getOrCreateRoom(workspaceRoot);
    const missions = this.repository.listMissions(room.id);
    const lanes = this.repository.listLanes(missions.map(mission => mission.id));
    const assignments = this.repository.listAssignments(missions.map(mission => mission.id));
    const eventWindow =
      options.eventLimitPerLane === undefined
        ? { events: this.repository.listEvents(lanes.map(lane => lane.id)), windows: [] }
        : this.eventWindowReader.listRecent(
            lanes.map(lane => lane.id),
            options.eventLimitPerLane,
          );
    return {
      room,
      profiles: this.registry.list(),
      missions,
      lanes,
      assignments,
      events: eventWindow.events,
      ...(eventWindow.windows.length > 0 ? { eventWindows: eventWindow.windows } : {}),
      elicitations: this.repository.listElicitations(lanes.map(lane => lane.id)),
    };
  }

  loadEventPage(
    workspaceRoot: string,
    laneId: string,
    beforeSequence: number | null,
  ): CodingEventPage {
    const room = this.repository.getRoomByRoot(workspaceRoot);
    const laneRoom = this.repository.getRoomByLaneId(laneId);
    if (!room || !laneRoom || laneRoom.id !== room.id) {
      throw new Error('The coding event lane does not belong to this workspace.');
    }
    return this.eventWindowReader.loadPage(laneId, beforeSequence, CodingEventWindowPageSize);
  }

  protected getThinkingLevel(lane: CodingAgentLane): string | undefined {
    const value = lane.configOptions.find(
      option => option.id === BuiltinCodingConfigId.ThinkingLevel,
    )?.currentValue;
    return typeof value === 'string' ? value : undefined;
  }

  protected getApprovalMode(lane: CodingAgentLane): WorkbenchApprovalMode {
    const value = lane.configOptions.find(
      option => option.id === BuiltinCodingConfigId.PermissionMode,
    )?.currentValue;
    return value === WorkbenchApprovalMode.Auto || value === WorkbenchApprovalMode.AllowAll
      ? value
      : WorkbenchApprovalMode.Ask;
  }

  protected updateLaneAssignmentStatus(
    snapshot: CodingRoomSnapshot,
    laneId: string,
    status: CodingAssignmentStatus,
  ): void {
    const assignment = snapshot.assignments.find(candidate => candidate.laneId === laneId);
    if (assignment) this.repository.updateAssignmentStatus(assignment.id, status);
  }

  protected publish(workspaceRoot: string): CodingRoomSnapshot {
    this.eventDeltaBatcher.flush(workspaceRoot);
    const snapshot = this.bootstrap(workspaceRoot, {
      eventLimitPerLane: CodingEventWindowPageSize,
    });
    this.emit('changed', snapshot);
    return snapshot;
  }

  protected publishLane(laneId: string): void {
    for (const workspaceRoot of this.knownRooms()) {
      const snapshot = this.bootstrap(workspaceRoot, {
        eventLimitPerLane: CodingEventWindowPageSize,
      });
      if (!snapshot.lanes.some(lane => lane.id === laneId)) continue;
      this.emit('changed', snapshot);
      return;
    }
  }

  protected requireLane(lanes: CodingAgentLane[], laneId: string): CodingAgentLane {
    const lane = lanes.find(candidate => candidate.id === laneId);
    if (!lane) throw new Error(CodingErrorMessage.LaneNotFound);
    return lane;
  }

  protected knownRooms(): string[] {
    return this.repository.listRooms().map(room => room.workspaceRoot);
  }

  protected executionRoot(lane: CodingAgentLane, roomWorkspaceRoot: string): string {
    return lane.executionRoot || roomWorkspaceRoot;
  }

  protected async getWorkspaceBaseline(workspaceRoot: string): Promise<string | null> {
    if (!this.runtime.getWorkspaceBaseline) return null;
    try {
      return await this.runtime.getWorkspaceBaseline(workspaceRoot);
    } catch (error) {
      console.debug('[CodingRoom] Unable to read the workspace Git baseline:', error);
      return null;
    }
  }

  protected async getWorkspaceDiff(workspaceRoot: string): Promise<string | null> {
    if (!this.runtime.getWorkspaceDiff) return null;
    try {
      return await this.runtime.getWorkspaceDiff(workspaceRoot);
    } catch (error) {
      console.debug('[CodingRoom] Unable to read the workspace Git diff:', error);
      return null;
    }
  }

  protected requireMissionBaseline(mission: { gitBaseline: string | null } | undefined): string {
    if (!mission?.gitBaseline) {
      throw new Error(CodingErrorMessage.CollaboratorBaselineRequired);
    }
    return mission.gitBaseline;
  }

  protected allowedEnvironment(): Record<string, string | undefined> {
    return getCodingAgentEnvironment();
  }

  protected requiresWriterLease(sourceRoot: string, executionRoot: string): boolean {
    return path.resolve(sourceRoot) === path.resolve(executionRoot);
  }

  protected errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  // ── Driver lifecycle (merged from driverLifecycle.ts) ─────────────────────
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
      if (!this.turnTracker.isLaneStaged(lane.id)) this.publishLane(lane.id);
    });
    driver.onSessionTitleChanged((_sessionId, title) => {
      this.repository.updateMissionTitle(lane.missionId, title);
      if (!this.turnTracker.isLaneStaged(lane.id)) this.publishLane(lane.id);
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
