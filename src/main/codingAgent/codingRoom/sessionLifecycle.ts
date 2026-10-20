import {
  persistCodingSessionRecord,
  prepareCodingSession,
  resolveSessionTarget,
} from '../codingSessionStartup';
import { t } from '../../i18n';
import {
  CodingAgentDriverKind,
  CodingAgentProfileStatus,
  CodingElicitationStatus,
  CodingErrorMessage,
  CodingEventKind,
  CodingWorkflowStage,
  type CodingAgentAvailableCommand,
  type CodingAgentConfigOption,
  type CodingPromptInput,
  type CodingRoomSnapshot,
  type CreateCodingMissionInput,
  type CreateCodingSessionInput,
  type StartCodingSessionInput,
} from '../../../shared/codingAgent';
import { CodingRoomServiceWorkspaceAdmin } from './workspaceAdmin';

/** Session, mission and lane creation plus startup recovery. */
export abstract class CodingRoomServiceSessionLifecycle extends CodingRoomServiceWorkspaceAdmin {
  /** Sends a prompt to a lane; implemented by the turn-execution layer. */
  abstract prompt(
    workspaceRoot: string,
    input: CodingPromptInput,
    queuedItemId?: string,
  ): Promise<CodingRoomSnapshot>;

  listProfiles() {
    this.registry.refreshBuiltinReadiness();
    return this.registry.list();
  }

  async createSession(input: CreateCodingSessionInput): Promise<CodingRoomSnapshot> {
    return await this.createSessionRecord(input, true);
  }

  private async createSessionRecord(
    input: CreateCodingSessionInput,
    notify: boolean,
  ): Promise<CodingRoomSnapshot> {
    const target = resolveSessionTarget(this.repository, this.registry, input);
    await persistCodingSessionRecord({
      repository: this.repository,
      target,
      title: input.title?.trim() || t('codingAgentDefaultMissionTitle'),
      getWorkspaceBaseline: sourceRoot => this.getWorkspaceBaseline(sourceRoot),
    });
    return notify
      ? this.publish(target.room.workspaceRoot)
      : this.bootstrap(target.room.workspaceRoot);
  }

  async startSession(input: StartCodingSessionInput): Promise<CodingRoomSnapshot> {
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error(CodingErrorMessage.PromptRequired);
    const selectedProfile = this.registry.get(input.profileId);
    if (
      selectedProfile &&
      selectedProfile.driverKind === CodingAgentDriverKind.Acp &&
      selectedProfile.status === CodingAgentProfileStatus.Detected
    ) {
      await this.registry.probe(selectedProfile.id, input.sourceRoot);
    }
    const prepared = await prepareCodingSession({
      request: input,
      prompt,
      repository: this.repository,
      registry: this.registry,
      driverFactory: this.driverFactory,
      validateBuiltinModel: this.runtime.validateBuiltinModel?.bind(this.runtime),
      getWorkspaceBaseline: sourceRoot => this.getWorkspaceBaseline(sourceRoot),
    });
    const { room, profile, lane, driver, driverSession } = prepared;
    this.turnTracker.stageLane(lane.id);
    // Register builtin session → lane mapping so recordBuiltinEvent can find
    // the lane without scanning every room.
    if (profile.driverKind === CodingAgentDriverKind.Builtin) {
      this.laneSessionIndex.register(lane.localSessionId, lane.id);
      // A newly registered lane may own sessions that previously missed the
      // mapping, so the negative cache must be reset, not patched.
      this.laneSessionIndex.clearNonLaneSessions();
    }
    try {
      this.registerDriver(lane, profile, driver);
      this.driverPool.setSession(lane.id, {
        id: driverSession.id,
        connectionGeneration: driver.getConnectionGeneration?.() ?? null,
      });
      const snapshot = await this.prompt(room.workspaceRoot, {
        laneId: lane.id,
        prompt,
        attachments: input.attachments,
      });
      this.turnTracker.unstageLane(lane.id);
      return snapshot;
    } catch (error) {
      this.turnTracker.unstageLane(lane.id);
      await this.rollbackCreatedSession(room.id, lane);
      this.publish(room.workspaceRoot);
      throw error;
    }
  }

  /** Running drivers are process-local, so an app restart must never leave stale lanes running. */
  recoverInterruptedState(): number {
    // A pending question is owned by the process that asked it, so anything
    // still pending belongs to a previous run: cancel it first, otherwise the
    // lane stays in WaitingElicitation and refuses prompts and deletion.
    const elicitationReason = t('codingAgentElicitationCancelledByRestart');
    const cancelledElicitations = this.repository.cancelPendingElicitations(elicitationReason);
    const interrupted = this.repository.recoverInterruptedLanes();
    for (const lane of interrupted) {
      this.repository.appendEvent(lane.id, CodingEventKind.TurnCancelled, {
        reason: 'application_restart',
      });
    }
    for (const elicitation of cancelledElicitations) {
      this.repository.appendEvent(elicitation.laneId, CodingEventKind.Elicitation, {
        requestId: elicitation.id,
        question: elicitation.question,
        cancelReason: elicitationReason,
        status: CodingElicitationStatus.Cancelled,
      });
    }
    return interrupted.length;
  }

  async createMission(input: CreateCodingMissionInput): Promise<CodingRoomSnapshot> {
    this.registry.refreshBuiltinReadiness();
    const profile = this.registry.get(input.profileId);
    if (!profile) throw new Error(CodingErrorMessage.ProfileNotFound);
    if (profile.status !== CodingAgentProfileStatus.Ready) {
      throw new Error(CodingErrorMessage.ProfileNotReady);
    }
    const room = this.repository.getOrCreateRoom(input.workspaceRoot);
    const mission = this.repository.createMission(
      room.id,
      input.title?.trim() || t('codingAgentDefaultMissionTitle'),
      await this.getWorkspaceBaseline(input.workspaceRoot),
    );
    const lane = this.repository.createLane(mission.id, profile.id, input.workspaceRoot);
    this.repository.createAssignment({
      missionId: mission.id,
      laneId: lane.id,
      title: mission.title,
      instructions: mission.goal,
      workflowStage: CodingWorkflowStage.Implementation,
    });
    this.repository.setActive(room.id, mission.id, lane.id);
    return this.publish(input.workspaceRoot);
  }

  async prepareLane(workspaceRoot: string, laneId: string): Promise<CodingRoomSnapshot> {
    const snapshot = this.bootstrap(workspaceRoot);
    const lane = this.requireLane(snapshot.lanes, laneId);
    const profile = this.registry.get(lane.profileId);
    if (
      lane.remoteSessionId ||
      !profile ||
      profile.status !== CodingAgentProfileStatus.Ready ||
      (profile.driverKind !== CodingAgentDriverKind.Acp &&
        profile.driverKind !== CodingAgentDriverKind.Builtin)
    ) {
      return snapshot;
    }
    const driver = this.getDriver(lane);
    await this.ensureDriverSession(driver, lane, this.executionRoot(lane, workspaceRoot));
    return this.publish(workspaceRoot);
  }

  /** Default config options a new session of this profile would start with. */
  getProfileConfigOptions(profileId: string): CodingAgentConfigOption[] {
    const profile = this.registry.get(profileId);
    if (!profile || profile.driverKind !== CodingAgentDriverKind.Builtin) return [];
    const driver = this.driverFactory.create(profile);
    return driver.getDefaultConfigOptions?.() ?? [];
  }

  /**
   * Commands a new session of this profile would start with. A draft has no
   * driver session yet, and the composer would otherwise show no slash commands
   * until the first turn creates one.
   */
  getProfileAvailableCommands(profileId: string): CodingAgentAvailableCommand[] {
    const profile = this.registry.get(profileId);
    if (!profile || profile.driverKind !== CodingAgentDriverKind.Builtin) return [];
    const driver = this.driverFactory.create(profile);
    return driver.getDefaultAvailableCommands?.() ?? [];
  }

  selectLane(workspaceRoot: string, laneId: string): CodingRoomSnapshot {
    const snapshot = this.bootstrap(workspaceRoot);
    const lane = this.requireLane(snapshot.lanes, laneId);
    this.repository.setActive(snapshot.room.id, lane.missionId, lane.id);
    return this.publish(workspaceRoot);
  }
}
