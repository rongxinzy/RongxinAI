import { EventEmitter } from 'events';
import path from 'path';
import { getCodingAgentEnvironment } from '../agentEnvironment';
import type { CodingAgentDriver } from '../drivers/codingAgentDriver';
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
  CodingEventWindowPageSize,
  type CodingAgentLane,
  type CodingEventPage,
  type CodingRoomSnapshot,
} from '../../../shared/codingAgent';
import { CodingPendingMessageQueue } from './codingPendingMessageQueue';
import type { CodingRoomRuntime, DriverSession } from './runtimeContract';

/**
 * Shared state and cross-cutting helpers every coding-room layer builds on:
 * repository/registry/runtime wiring, snapshots, publishing and lane lookups.
 */
export abstract class CodingRoomServiceFoundation extends EventEmitter {
  protected readonly drivers = new Map<string, CodingAgentDriver>();
  protected readonly driverSessionIds = new Map<string, DriverSession>();
  protected readonly driverSessionPromises = new Map<
    string,
    Promise<{ id: string; recoveryContext: string | null }>
  >();
  protected readonly driverProfileIds = new Map<string, string>();
  protected readonly driverFactory: CodingDriverFactory;
  protected readonly collaboration = new CollaborationService();
  protected readonly authTerminals = new AuthTerminalService();
  protected readonly git: CodingGitController;
  private readonly eventWindowReader: CodingEventWindowReader;
  protected readonly eventDeltaBatcher: CodingEventDeltaBatcher;
  protected readonly laneTurnGenerations = new Map<string, number>();
  protected readonly cancelledTurnGenerations = new Map<string, number>();
  protected readonly pendingMessageQueue = new CodingPendingMessageQueue();
  protected readonly stagedLaneIds = new Set<string>();
  protected readonly inFlightTurns = new Set<Promise<void>>();
  /** Maps builtin sessionId → laneId to avoid scanning all rooms per event. */
  protected readonly builtinSessionLaneMap = new Map<string, string>();
  /** Sessions known to map to no builtin lane; guards recordBuiltinEvent room scans. */
  protected readonly nonLaneSessionIds = new Set<string>();

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
}
