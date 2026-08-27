import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';

import {
  CodingAgentDriverKind,
  CodingAssignmentStatus,
  CodingWorkflowStage,
  CodingEventKind,
  CodingLaneStatus,
  CodingMissionStatus,
  CodingPermissionOutcome,
  CodingAgentProfileStatus,
  type CodingAgentLane,
  type AddCodingAgentProfileInput,
  type CodingLaneConfigOptionInput,
  type CodingLaneChangePreview,
  type CreateCodingCollaborationPresetInput,
  type CodingLaneViewStateInput,
  type CodingPermissionResponse,
  type CodingPromptInput,
  type CodingRoomSnapshot,
  type CreateCodingMissionInput,
} from '../../shared/codingAgent';
import { CodingAgentRegistry } from './codingAgentRegistry';
import { AuthTerminalService } from './authTerminalService';
import { CollaborationService } from './collaborationService';
import { CodingRoomRepository } from './codingRoomRepository';
import { t } from '../i18n';
import type { CodingAgentDriver } from './drivers/codingAgentDriver';
import { CodingDriverFactory } from './drivers/driverFactory';

export interface CodingRoomRuntime {
  startBuiltinSession(input: {
    sessionId: string;
    workspaceRoot: string;
    prompt: string;
  }): Promise<void>;
  cancelBuiltinSession(sessionId: string): Promise<void>;
  getBuiltinWorkbenchLink(sessionId: string): { taskId: string; runId: string } | null;
  beginExternalWorkbenchRun(input: { sessionId: string; goal: string; workspaceRoot: string }): {
    taskId: string;
    runId: string;
  };
  completeExternalWorkbenchRun(input: {
    sessionId: string;
    runId: string;
    workspaceRoot: string;
    finalAnswer: string;
  }): void;
  failExternalWorkbenchRun?(input: { sessionId: string; runId: string; error: string }): void;
  cancelExternalWorkbenchRun?(input: { sessionId: string; runId: string }): void;
  respondBuiltinPermission?(requestId: string, approved: boolean): void;
  createIsolatedWorkspace?(input: {
    workspaceRoot: string;
    laneId: string;
    baseline: string;
  }): Promise<string>;
  getWorkspaceBaseline?(workspaceRoot: string): Promise<string | null>;
  getWorkspaceDiff?(workspaceRoot: string): Promise<string | null>;
  getIsolatedWorkspaceDiff?(workspaceRoot: string): Promise<string>;
  applyIsolatedWorkspaceDiff?(input: {
    workspaceRoot: string;
    isolatedWorkspaceRoot: string;
  }): Promise<void>;
  applyWorkspacePatch?(input: { workspaceRoot: string; patch: string }): Promise<void>;
}

type DriverSession = { id: string; connectionGeneration: number | null };

const ACP_ENVIRONMENT_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
] as const;

export class CodingRoomService extends EventEmitter {
  private readonly drivers = new Map<string, CodingAgentDriver>();
  private readonly driverSessionIds = new Map<string, DriverSession>();
  private readonly driverProfileIds = new Map<string, string>();
  private readonly driverFactory: CodingDriverFactory;
  private readonly collaboration = new CollaborationService();
  private readonly authTerminals = new AuthTerminalService();
  private readonly cancelledLanes = new Set<string>();

  constructor(
    private readonly repository: CodingRoomRepository,
    readonly registry: CodingAgentRegistry,
    private readonly runtime: CodingRoomRuntime,
  ) {
    super();
    this.driverFactory = new CodingDriverFactory(
      {
        start: (sessionId, workspaceRoot, prompt) =>
          this.runtime.startBuiltinSession({ sessionId, workspaceRoot, prompt }),
        cancel: sessionId => this.runtime.cancelBuiltinSession(sessionId),
      },
      Object.fromEntries(ACP_ENVIRONMENT_KEYS.map(key => [key, process.env[key]])),
    );
    registry.on('changed', () => {
      for (const room of this.repository.listRooms()) this.publish(room.workspaceRoot);
    });
    this.authTerminals.on('data', event => this.emit('authTerminalData', event));
    this.authTerminals.on('exit', event => {
      void this.completeTerminalAuthentication(event);
    });
  }

  bootstrap(workspaceRoot: string): CodingRoomSnapshot {
    this.registry.refreshBuiltinReadiness();
    const room = this.repository.getOrCreateRoom(workspaceRoot);
    const missions = this.repository.listMissions(room.id);
    const lanes = this.repository.listLanes(missions.map(mission => mission.id));
    const assignments = this.repository.listAssignments(missions.map(mission => mission.id));
    return {
      room,
      profiles: this.registry.list(),
      missions,
      lanes,
      assignments,
      events: this.repository.listEvents(lanes.map(lane => lane.id)),
    };
  }

  /** Running drivers are process-local, so an app restart must never leave stale lanes running. */
  recoverInterruptedState(): number {
    const interrupted = this.repository.recoverInterruptedLanes();
    for (const lane of interrupted) {
      this.repository.appendEvent(lane.id, CodingEventKind.TurnCancelled, {
        reason: 'application_restart',
      });
    }
    return interrupted.length;
  }

  async createMission(input: CreateCodingMissionInput): Promise<CodingRoomSnapshot> {
    this.registry.refreshBuiltinReadiness();
    const profile = this.registry.get(input.profileId);
    if (!profile) throw new Error('Coding agent profile was not found.');
    if (profile.status !== CodingAgentProfileStatus.Ready) {
      throw new Error('The selected coding agent is not ready to run.');
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

  selectLane(workspaceRoot: string, laneId: string): CodingRoomSnapshot {
    const snapshot = this.bootstrap(workspaceRoot);
    const lane = this.requireLane(snapshot.lanes, laneId);
    this.repository.setActive(snapshot.room.id, lane.missionId, lane.id);
    return this.publish(workspaceRoot);
  }

  async prompt(workspaceRoot: string, input: CodingPromptInput): Promise<CodingRoomSnapshot> {
    const snapshot = this.bootstrap(workspaceRoot);
    const lane = this.requireLane(snapshot.lanes, input.laneId);
    if (
      lane.status === CodingLaneStatus.Running ||
      lane.status === CodingLaneStatus.WaitingApproval
    ) {
      throw new Error('This coding agent lane already has an active turn.');
    }
    const profile = this.registry.get(lane.profileId);
    if (!profile) throw new Error('Coding agent profile was not found.');
    if (profile.status !== CodingAgentProfileStatus.Ready) {
      throw new Error('The selected coding agent is not ready to run.');
    }
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error('Prompt is required.');

    const executionRoot = this.executionRoot(lane, workspaceRoot);
    if (this.requiresWriterLease(snapshot.room.workspaceRoot, executionRoot)) {
      this.repository.acquireWriterLease(snapshot.room.id, lane.id);
    }
    this.repository.appendEvent(lane.id, CodingEventKind.Message, {
      role: 'user',
      content: prompt,
    });
    this.repository.updateLaneStatus(lane.id, CodingLaneStatus.Running);
    this.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.Running);
    this.updateLaneAssignmentStatus(snapshot, lane.id, CodingAssignmentStatus.Running);

    try {
      const driver = this.getDriver(lane);
      const session = await this.ensureDriverSession(driver, lane, executionRoot);
      if (session.recoveryContext) {
        if (this.requiresWriterLease(snapshot.room.workspaceRoot, executionRoot)) {
          this.repository.releaseWriterLease(snapshot.room.id, lane.id);
        }
        this.repository.updateLaneStatus(lane.id, CodingLaneStatus.Idle);
        this.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.NeedsReview);
        this.updateLaneAssignmentStatus(snapshot, lane.id, CodingAssignmentStatus.Planned);
        this.repository.updateLaneRecovery(lane.id, prompt, session.recoveryContext);
        return this.publish(workspaceRoot);
      }
      if (profile.driverKind !== CodingAgentDriverKind.Builtin) {
        const workbench = this.runtime.beginExternalWorkbenchRun({
          sessionId: lane.localSessionId,
          goal: prompt,
          workspaceRoot: executionRoot,
        });
        this.linkLaneAssignment(snapshot, lane.id, workbench.taskId, workbench.runId);
      }
      void this.runTurn(
        workspaceRoot,
        executionRoot,
        snapshot.room.id,
        lane,
        profile.driverKind,
        driver,
        session.id,
        prompt,
      );
    } catch (error) {
      if (this.requiresWriterLease(snapshot.room.workspaceRoot, executionRoot)) {
        this.repository.releaseWriterLease(snapshot.room.id, lane.id);
      }
      const failureStatus = this.failureStatus(lane, error);
      this.repository.updateLaneStatus(lane.id, failureStatus);
      this.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.Failed);
      this.updateLaneAssignmentStatus(snapshot, lane.id, CodingAssignmentStatus.Failed);
      this.repository.appendEvent(lane.id, CodingEventKind.TurnFailed, {
        error: this.errorMessage(error),
      });
      throw error;
    }
    return this.publish(workspaceRoot);
  }

  async confirmSessionRecovery(
    workspaceRoot: string,
    laneId: string,
    includeRecoveryContext: boolean,
  ): Promise<CodingRoomSnapshot> {
    const snapshot = this.bootstrap(workspaceRoot);
    const lane = this.requireLane(snapshot.lanes, laneId);
    const profile = this.registry.get(lane.profileId);
    if (!profile || profile.status !== CodingAgentProfileStatus.Ready) {
      throw new Error('The selected coding agent is not ready to run.');
    }
    if (!lane.pendingRecoveryPrompt || !lane.pendingRecoveryContext) {
      throw new Error('The coding session does not require recovery confirmation.');
    }
    const executionRoot = this.executionRoot(lane, workspaceRoot);
    if (this.requiresWriterLease(snapshot.room.workspaceRoot, executionRoot)) {
      this.repository.acquireWriterLease(snapshot.room.id, lane.id);
    }
    try {
      const driver = this.getDriver(lane);
      const session = await this.ensureDriverSession(driver, lane, executionRoot);
      if (session.recoveryContext) {
        if (this.requiresWriterLease(snapshot.room.workspaceRoot, executionRoot)) {
          this.repository.releaseWriterLease(snapshot.room.id, lane.id);
        }
        this.repository.updateLaneRecovery(
          lane.id,
          lane.pendingRecoveryPrompt,
          session.recoveryContext,
        );
        return this.publish(workspaceRoot);
      }
      this.repository.updateLaneRecovery(lane.id, null, null);
      this.repository.updateLaneStatus(lane.id, CodingLaneStatus.Running);
      this.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.Running);
      this.updateLaneAssignmentStatus(snapshot, lane.id, CodingAssignmentStatus.Running);
      if (profile.driverKind !== CodingAgentDriverKind.Builtin) {
        const workbench = this.runtime.beginExternalWorkbenchRun({
          sessionId: lane.localSessionId,
          goal: lane.pendingRecoveryPrompt,
          workspaceRoot: executionRoot,
        });
        this.linkLaneAssignment(snapshot, lane.id, workbench.taskId, workbench.runId);
      }
      void this.runTurn(
        workspaceRoot,
        executionRoot,
        snapshot.room.id,
        lane,
        profile.driverKind,
        driver,
        session.id,
        includeRecoveryContext
          ? `${lane.pendingRecoveryContext}\n\n${lane.pendingRecoveryPrompt}`
          : lane.pendingRecoveryPrompt,
      );
    } catch (error) {
      if (this.requiresWriterLease(snapshot.room.workspaceRoot, executionRoot)) {
        this.repository.releaseWriterLease(snapshot.room.id, lane.id);
      }
      throw error;
    }
    return this.publish(workspaceRoot);
  }

  async cancel(workspaceRoot: string, laneId: string): Promise<CodingRoomSnapshot> {
    const snapshot = this.bootstrap(workspaceRoot);
    const lane = this.requireLane(snapshot.lanes, laneId);
    const driver = this.getDriver(lane);
    const session = await this.ensureDriverSession(
      driver,
      lane,
      this.executionRoot(lane, workspaceRoot),
    );
    this.cancelledLanes.add(lane.id);
    await driver.cancel(session.id);
    const assignment = this.repository.getLatestAssignmentForLane(lane.id);
    if (assignment?.workbenchRunId) {
      this.runtime.cancelExternalWorkbenchRun?.({
        sessionId: lane.localSessionId,
        runId: assignment.workbenchRunId,
      });
    }
    if (
      this.requiresWriterLease(snapshot.room.workspaceRoot, this.executionRoot(lane, workspaceRoot))
    ) {
      this.repository.releaseWriterLease(snapshot.room.id, lane.id);
    }
    this.repository.updateLaneStatus(lane.id, CodingLaneStatus.Idle);
    this.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.Cancelled);
    this.updateLaneAssignmentStatus(snapshot, lane.id, CodingAssignmentStatus.Cancelled);
    this.repository.appendEvent(lane.id, CodingEventKind.TurnCancelled, {});
    return this.publish(workspaceRoot);
  }

  async previewHandoff(
    workspaceRoot: string,
    sourceLaneId: string,
    targetLaneId: string,
  ): Promise<Record<string, unknown>> {
    const snapshot = this.bootstrap(workspaceRoot);
    const source = this.requireLane(snapshot.lanes, sourceLaneId);
    const target = this.requireLane(snapshot.lanes, targetLaneId);
    if (source.missionId !== target.missionId) {
      throw new Error('Handoffs require lanes in the same coding mission.');
    }
    return this.collaboration.buildHandoff({
      snapshot,
      sourceLane: source,
      targetLane: target,
      baseline: this.requireMissionBaseline(
        snapshot.missions.find(mission => mission.id === source.missionId),
      ),
      diff: await this.getWorkspaceDiff(this.executionRoot(source, workspaceRoot)),
    });
  }

  async handoff(
    workspaceRoot: string,
    sourceLaneId: string,
    targetLaneId: string,
  ): Promise<CodingRoomSnapshot> {
    const snapshot = this.bootstrap(workspaceRoot);
    const source = this.requireLane(snapshot.lanes, sourceLaneId);
    const target = this.requireLane(snapshot.lanes, targetLaneId);
    if (source.missionId !== target.missionId) {
      throw new Error('Handoffs require lanes in the same coding mission.');
    }
    const content = await this.previewHandoff(workspaceRoot, sourceLaneId, targetLaneId);
    const handoffId = this.repository.createHandoff(
      source.missionId,
      sourceLaneId,
      targetLaneId,
      content,
    );
    this.repository.appendEvent(targetLaneId, CodingEventKind.Message, {
      role: 'handoff',
      handoffId,
      content,
    });
    this.repository.setActive(snapshot.room.id, target.missionId, target.id);
    // A handoff is an executable delivery, not only an activity-log record.  ACP
    // receives it through the same text content block used for ordinary prompts.
    return await this.prompt(workspaceRoot, {
      laneId: target.id,
      prompt: this.handoffPrompt(content),
    });
  }

  async addLane(
    workspaceRoot: string,
    missionId: string,
    profileId: string,
  ): Promise<CodingRoomSnapshot> {
    this.registry.refreshBuiltinReadiness();
    const snapshot = this.bootstrap(workspaceRoot);
    if (!snapshot.missions.some(mission => mission.id === missionId)) {
      throw new Error('Coding mission was not found.');
    }
    const profile = this.registry.get(profileId);
    if (!profile) throw new Error('Coding agent profile was not found.');
    if (profile.status !== CodingAgentProfileStatus.Ready) {
      throw new Error('The selected coding agent is not ready to run.');
    }
    if (!this.runtime.createIsolatedWorkspace) {
      throw new Error('The coding runtime cannot create an isolated workspace.');
    }
    const mission = snapshot.missions.find(candidate => candidate.id === missionId);
    const laneId = randomUUID();
    const executionRoot = await this.runtime.createIsolatedWorkspace({
      workspaceRoot,
      laneId,
      baseline: this.requireMissionBaseline(mission),
    });
    const lane = this.repository.createLane(missionId, profileId, executionRoot, laneId);
    this.repository.createAssignment({
      missionId,
      laneId: lane.id,
      title: mission?.title ?? 'Coding assignment',
      instructions: mission?.goal ?? '',
    });
    return this.publish(workspaceRoot);
  }

  async createImplementationReviewVerificationPreset(
    input: CreateCodingCollaborationPresetInput,
  ): Promise<CodingRoomSnapshot> {
    const snapshot = this.bootstrap(input.workspaceRoot);
    const mission = snapshot.missions.find(candidate => candidate.id === input.missionId);
    if (!mission) throw new Error('Coding mission was not found.');
    if (!this.runtime.createIsolatedWorkspace) {
      throw new Error('The coding runtime cannot create an isolated workspace.');
    }
    const implementation = snapshot.assignments.find(
      assignment =>
        assignment.missionId === mission.id &&
        assignment.workflowStage === CodingWorkflowStage.Implementation,
    );
    if (!implementation) throw new Error('The coding mission has no implementation assignment.');
    const stages = [
      {
        profileId: input.reviewerProfileId,
        workflowStage: CodingWorkflowStage.Review,
        title: `Review: ${mission.title}`,
        instructions:
          'Review the implementation in an isolated worktree. Do not apply changes to the primary workspace.',
      },
      {
        profileId: input.verifierProfileId,
        workflowStage: CodingWorkflowStage.Verification,
        title: `Verify: ${mission.title}`,
        instructions: 'Verify the implementation in an isolated worktree and report test results.',
      },
    ];
    let previousAssignmentId = implementation.id;
    for (const stage of stages) {
      const profile = this.registry.get(stage.profileId);
      if (!profile) throw new Error('Coding agent profile was not found.');
      if (profile.status !== CodingAgentProfileStatus.Ready) {
        throw new Error('The selected coding agent is not ready to run.');
      }
      const laneId = randomUUID();
      const executionRoot = await this.runtime.createIsolatedWorkspace({
        workspaceRoot: input.workspaceRoot,
        laneId,
        baseline: this.requireMissionBaseline(mission),
      });
      const lane = this.repository.createLane(mission.id, profile.id, executionRoot, laneId);
      const assignment = this.repository.createAssignment({
        missionId: mission.id,
        laneId: lane.id,
        title: stage.title,
        instructions: stage.instructions,
        workflowStage: stage.workflowStage,
        previousAssignmentId,
      });
      previousAssignmentId = assignment.id;
      this.repository.appendEvent(lane.id, CodingEventKind.Message, {
        role: 'system',
        content: stage.instructions,
      });
    }
    return this.publish(input.workspaceRoot);
  }

  saveLaneView(workspaceRoot: string, input: CodingLaneViewStateInput): CodingRoomSnapshot {
    const snapshot = this.bootstrap(workspaceRoot);
    this.requireLane(snapshot.lanes, input.laneId);
    this.repository.updateLaneViewState(
      input.laneId,
      input.draft,
      Math.max(0, Math.floor(input.scrollPosition)),
    );
    return this.publish(workspaceRoot);
  }

  async setLaneConfigOption(
    workspaceRoot: string,
    input: CodingLaneConfigOptionInput,
  ): Promise<CodingRoomSnapshot> {
    const snapshot = this.bootstrap(workspaceRoot);
    const lane = this.requireLane(snapshot.lanes, input.laneId);
    const option = lane.configOptions.find(candidate => candidate.id === input.configId);
    if (!option) throw new Error('The coding agent configuration option was not found.');
    if (option.type === 'select') {
      if (
        typeof input.value !== 'string' ||
        !option.options?.some(candidate => candidate.value === input.value)
      ) {
        throw new Error('The selected coding agent configuration value is invalid.');
      }
    } else if (typeof input.value !== 'boolean') {
      throw new Error('The selected coding agent configuration value is invalid.');
    }
    const driver = this.getDriver(lane);
    const session = await this.ensureDriverSession(
      driver,
      lane,
      this.executionRoot(lane, workspaceRoot),
    );
    const configOptions = await driver.setConfigOption(session.id, input.configId, input.value);
    this.repository.updateLaneConfigOptions(lane.id, configOptions);
    return this.publish(workspaceRoot);
  }

  async previewLaneChanges(
    workspaceRoot: string,
    laneId: string,
  ): Promise<CodingLaneChangePreview> {
    const snapshot = this.bootstrap(workspaceRoot);
    const lane = this.requireLane(snapshot.lanes, laneId);
    const executionRoot = this.executionRoot(lane, workspaceRoot);
    if (this.requiresWriterLease(snapshot.room.workspaceRoot, executionRoot)) {
      throw new Error('Only isolated collaborator worktrees can be previewed for application.');
    }
    if (!this.runtime.getIsolatedWorkspaceDiff) {
      throw new Error('The coding runtime cannot inspect isolated workspace changes.');
    }
    return { laneId: lane.id, diff: await this.runtime.getIsolatedWorkspaceDiff(executionRoot) };
  }

  async applyLaneChanges(workspaceRoot: string, laneId: string): Promise<CodingRoomSnapshot> {
    const snapshot = this.bootstrap(workspaceRoot);
    const lane = this.requireLane(snapshot.lanes, laneId);
    const executionRoot = this.executionRoot(lane, workspaceRoot);
    if (this.requiresWriterLease(snapshot.room.workspaceRoot, executionRoot)) {
      throw new Error('Only isolated collaborator worktrees can be applied.');
    }
    if (this.repository.getWriterLease(snapshot.room.id)) {
      throw new Error('Wait for the active workspace writer before applying collaborator changes.');
    }
    if (!this.runtime.applyIsolatedWorkspaceDiff) {
      throw new Error('The coding runtime cannot apply isolated workspace changes.');
    }
    await this.runtime.applyIsolatedWorkspaceDiff({
      workspaceRoot,
      isolatedWorkspaceRoot: executionRoot,
    });
    this.repository.appendEvent(lane.id, CodingEventKind.FileChange, {
      role: 'system',
      action: 'applied_to_workspace',
      workspaceRoot,
    });
    return this.publish(workspaceRoot);
  }

  async probeAgent(workspaceRoot: string, profileId: string): Promise<CodingRoomSnapshot> {
    await this.registry.probe(profileId, workspaceRoot);
    return this.publish(workspaceRoot);
  }

  addProfile(workspaceRoot: string, input: AddCodingAgentProfileInput): CodingRoomSnapshot {
    this.registry.addUntrustedProfile(input);
    return this.publish(workspaceRoot);
  }

  trustProfile(workspaceRoot: string, profileId: string): CodingRoomSnapshot {
    this.registry.trust(profileId);
    return this.publish(workspaceRoot);
  }

  async authenticateProfile(
    workspaceRoot: string,
    profileId: string,
    methodId: string,
  ): Promise<CodingRoomSnapshot> {
    const profile = this.registry.get(profileId);
    if (!profile || profile.isBuiltin || profile.status !== CodingAgentProfileStatus.NeedsAuth) {
      throw new Error('The coding agent profile is not waiting for authentication.');
    }
    const method = profile.authMethods.find(candidate => candidate.id === methodId);
    if (!method) throw new Error('The coding agent authentication method was not found.');
    if (method.type === 'terminal') {
      throw new Error('This coding agent requires interactive terminal authentication.');
    }
    const driver = this.driverFactory.create(profile);
    try {
      await driver.authenticate({ methodId, workspaceRoot });
      this.registry.markReady(profileId);
    } finally {
      await driver.dispose();
    }
    return this.publish(workspaceRoot);
  }

  startTerminalAuthentication(
    workspaceRoot: string,
    profileId: string,
    methodId: string,
  ): { id: string; profileId: string; methodId: string } {
    const profile = this.registry.get(profileId);
    if (!profile || profile.isBuiltin || profile.status !== CodingAgentProfileStatus.NeedsAuth) {
      throw new Error('The coding agent profile is not waiting for authentication.');
    }
    const method = profile.authMethods.find(candidate => candidate.id === methodId);
    if (!method || method.type !== 'terminal' || !profile.command) {
      throw new Error('The coding agent terminal authentication method is not available.');
    }
    return this.authTerminals.start({
      profileId,
      methodId,
      executable: profile.command,
      baseArgs: profile.args,
      authArgs: method.args ?? [],
      cwd: workspaceRoot,
      environment: this.allowedEnvironment(),
      authEnvironment: method.environment,
    });
  }

  writeAuthTerminal(id: string, data: string): void {
    this.authTerminals.write(id, data);
  }

  resizeAuthTerminal(id: string, columns: number, rows: number): void {
    this.authTerminals.resize(id, columns, rows);
  }

  cancelAuthTerminal(id: string): void {
    this.authTerminals.cancel(id);
  }

  async respondToPermission(
    workspaceRoot: string,
    response: CodingPermissionResponse,
  ): Promise<CodingRoomSnapshot> {
    const snapshot = this.bootstrap(workspaceRoot);
    const event = snapshot.events.find(
      candidate =>
        candidate.kind === CodingEventKind.Permission &&
        candidate.payload.requestId === response.requestId,
    );
    if (!event) throw new Error('The coding permission request was not found.');
    const lane = this.requireLane(snapshot.lanes, event.laneId);
    if (this.registry.get(lane.profileId)?.driverKind === CodingAgentDriverKind.Builtin) {
      if (!this.runtime.respondBuiltinPermission) {
        throw new Error('The built-in coding runtime cannot respond to permissions.');
      }
      this.runtime.respondBuiltinPermission(
        response.requestId,
        response.outcome === CodingPermissionOutcome.Selected,
      );
      this.repository.updateLaneStatus(lane.id, CodingLaneStatus.Running);
      this.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.Running);
      this.updateLaneAssignmentStatus(snapshot, lane.id, CodingAssignmentStatus.Running);
      this.repository.appendEvent(lane.id, CodingEventKind.ToolCall, {
        permissionRequestId: response.requestId,
        permissionOutcome: response.outcome,
      });
      return this.publish(workspaceRoot);
    }
    await this.getDriver(lane).respondToPermission(response);
    this.repository.updateLaneStatus(lane.id, CodingLaneStatus.Running);
    this.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.Running);
    this.updateLaneAssignmentStatus(snapshot, lane.id, CodingAssignmentStatus.Running);
    this.repository.appendEvent(lane.id, CodingEventKind.ToolCall, {
      permissionRequestId: response.requestId,
      permissionOutcome: response.outcome,
      optionId: response.optionId,
    });
    return this.publish(workspaceRoot);
  }

  recordBuiltinEvent(
    sessionId: string,
    kind: (typeof CodingEventKind)[keyof typeof CodingEventKind],
    payload: Record<string, unknown>,
  ): void {
    for (const workspaceRoot of this.knownRooms()) {
      const snapshot = this.bootstrap(workspaceRoot);
      const lane = snapshot.lanes.find(candidate => candidate.localSessionId === sessionId);
      if (!lane) continue;
      this.repository.appendOrMergeStreamEvent(lane.id, kind, payload);
      if (kind === CodingEventKind.Permission) {
        this.repository.updateLaneStatus(lane.id, CodingLaneStatus.WaitingApproval);
        this.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.WaitingApproval);
        this.updateLaneAssignmentStatus(snapshot, lane.id, CodingAssignmentStatus.WaitingApproval);
      }
      if (kind === CodingEventKind.TurnComplete)
        this.finishTurn(
          snapshot.room.id,
          snapshot.room.workspaceRoot,
          lane,
          CodingLaneStatus.Completed,
        );
      if (kind === CodingEventKind.TurnFailed)
        this.finishTurn(
          snapshot.room.id,
          snapshot.room.workspaceRoot,
          lane,
          CodingLaneStatus.Failed,
        );
      this.publish(workspaceRoot);
      return;
    }
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.drivers.values()].map(driver => driver.dispose()));
    this.drivers.clear();
    this.driverProfileIds.clear();
    this.driverSessionIds.clear();
    this.authTerminals.dispose();
  }

  private getDriver(lane: CodingAgentLane): CodingAgentDriver {
    const existing = this.drivers.get(lane.id);
    if (existing) return existing;
    const profile = this.registry.get(lane.profileId);
    if (!profile) throw new Error('Coding agent profile was not found.');
    const driver = this.driverFactory.create(profile);
    this.drivers.set(lane.id, driver);
    this.driverProfileIds.set(lane.id, profile.id);
    return driver;
  }

  private async ensureDriverSession(
    driver: CodingAgentDriver,
    lane: CodingAgentLane,
    workspaceRoot: string,
  ): Promise<{ id: string; recoveryContext: string | null }> {
    const activeSession = this.driverSessionIds.get(lane.id);
    if (
      activeSession &&
      (activeSession.connectionGeneration === null ||
        (driver.isConnectionRunning?.() &&
          driver.getConnectionGeneration?.() === activeSession.connectionGeneration))
    ) {
      return { id: activeSession.id, recoveryContext: null };
    }
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
        });
      }
    } else {
      session = await driver.createSession({ workspaceRoot, localSessionId: lane.localSessionId });
    }
    this.driverSessionIds.set(lane.id, {
      id: session.id,
      connectionGeneration: driver.getConnectionGeneration?.() ?? null,
    });
    if (session.remoteSessionId !== lane.remoteSessionId) {
      this.repository.updateLaneRemoteSession(lane.id, session.remoteSessionId);
    }
    this.repository.updateLaneConfigOptions(lane.id, session.configOptions);
    return { id: session.id, recoveryContext };
  }

  private async runTurn(
    roomWorkspaceRoot: string,
    executionRoot: string,
    roomId: string,
    lane: CodingAgentLane,
    driverKind: (typeof CodingAgentDriverKind)[keyof typeof CodingAgentDriverKind],
    driver: CodingAgentDriver,
    sessionId: string,
    prompt: string,
  ): Promise<void> {
    try {
      for await (const event of driver.prompt({
        sessionId,
        workspaceRoot: executionRoot,
        prompt,
      })) {
        this.repository.appendOrMergeStreamEvent(lane.id, event.kind, event.payload);
        this.repository.updateLaneConfigOptions(lane.id, driver.getSessionConfigOptions(sessionId));
        if (event.kind === CodingEventKind.Permission) {
          this.repository.updateLaneStatus(lane.id, CodingLaneStatus.WaitingApproval);
          this.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.WaitingApproval);
          const assignment = this.repository.getLatestAssignmentForLane(lane.id);
          if (assignment) {
            this.repository.updateAssignmentStatus(
              assignment.id,
              CodingAssignmentStatus.WaitingApproval,
            );
          }
        }
        this.publish(roomWorkspaceRoot);
      }
      if (this.cancelledLanes.delete(lane.id)) return;
      if (driverKind === CodingAgentDriverKind.Builtin) {
        const workbench = this.runtime.getBuiltinWorkbenchLink(lane.localSessionId);
        const assignment = this.repository.getLatestAssignmentForLane(lane.id);
        if (workbench && assignment) {
          this.repository.linkAssignmentWorkbench(assignment.id, workbench.taskId, workbench.runId);
        }
      }
      if (driverKind !== CodingAgentDriverKind.Builtin) {
        const answer = this.eventsToAnswer(lane.id);
        const assignment = this.repository.getLatestAssignmentForLane(lane.id);
        if (assignment?.workbenchRunId) {
          this.runtime.completeExternalWorkbenchRun({
            sessionId: lane.localSessionId,
            runId: assignment.workbenchRunId,
            workspaceRoot: executionRoot,
            finalAnswer: answer,
          });
        }
        this.repository.appendEvent(lane.id, CodingEventKind.TurnComplete, {});
        this.finishTurn(roomId, roomWorkspaceRoot, lane, CodingLaneStatus.Completed);
      }
      this.publish(roomWorkspaceRoot);
    } catch (error) {
      if (this.cancelledLanes.delete(lane.id)) return;
      const assignment = this.repository.getLatestAssignmentForLane(lane.id);
      if (assignment?.workbenchRunId) {
        this.runtime.failExternalWorkbenchRun?.({
          sessionId: lane.localSessionId,
          runId: assignment.workbenchRunId,
          error: this.errorMessage(error),
        });
      }
      this.repository.appendEvent(lane.id, CodingEventKind.TurnFailed, {
        error: this.errorMessage(error),
      });
      this.finishTurn(roomId, roomWorkspaceRoot, lane, this.failureStatus(lane, error));
      this.publish(roomWorkspaceRoot);
    }
  }

  private finishTurn(
    roomId: string,
    roomWorkspaceRoot: string,
    lane: CodingAgentLane,
    laneStatus: CodingLaneStatus,
  ): void {
    this.repository.updateLaneStatus(lane.id, laneStatus);
    this.repository.updateMissionStatus(
      lane.missionId,
      laneStatus === CodingLaneStatus.Completed
        ? CodingMissionStatus.NeedsReview
        : CodingMissionStatus.Failed,
    );
    const assignment = this.repository.getLatestAssignmentForLane(lane.id);
    if (assignment) {
      this.repository.updateAssignmentStatus(
        assignment.id,
        laneStatus === CodingLaneStatus.Completed
          ? CodingAssignmentStatus.NeedsReview
          : CodingAssignmentStatus.Failed,
      );
    }
    if (this.requiresWriterLease(roomWorkspaceRoot, this.executionRoot(lane, roomWorkspaceRoot))) {
      this.repository.releaseWriterLease(roomId, lane.id);
    }
    if (laneStatus === CodingLaneStatus.Completed) {
      void this.startNextCollaborationStage(roomWorkspaceRoot, lane.id);
    }
  }

  private updateLaneAssignmentStatus(
    snapshot: CodingRoomSnapshot,
    laneId: string,
    status: CodingAssignmentStatus,
  ): void {
    const assignment = snapshot.assignments.find(candidate => candidate.laneId === laneId);
    if (assignment) this.repository.updateAssignmentStatus(assignment.id, status);
  }

  private linkLaneAssignment(
    snapshot: CodingRoomSnapshot,
    laneId: string,
    workbenchTaskId: string,
    workbenchRunId: string,
  ): void {
    const assignment = snapshot.assignments.find(candidate => candidate.laneId === laneId);
    if (assignment)
      this.repository.linkAssignmentWorkbench(assignment.id, workbenchTaskId, workbenchRunId);
  }

  private eventsToAnswer(laneId: string): string {
    return this.repository
      .listEvents([laneId])
      .map(event => event.payload.content)
      .filter((content): content is string => typeof content === 'string')
      .join('\n');
  }

  private handoffPrompt(content: Record<string, unknown>): string {
    return `You are receiving a coding handoff. Continue from this handoff package:\n${JSON.stringify(
      content,
      null,
      2,
    )}`;
  }

  private async startNextCollaborationStage(
    workspaceRoot: string,
    completedLaneId: string,
  ): Promise<void> {
    const snapshot = this.bootstrap(workspaceRoot);
    const completedAssignment = snapshot.assignments.find(
      assignment => assignment.laneId === completedLaneId,
    );
    if (!completedAssignment) return;
    const nextAssignment = snapshot.assignments.find(
      assignment =>
        assignment.status === CodingAssignmentStatus.Planned &&
        assignment.previousAssignmentId === completedAssignment.id,
    );
    if (!nextAssignment) return;
    const source = this.requireLane(snapshot.lanes, completedLaneId);
    const target = this.requireLane(snapshot.lanes, nextAssignment.laneId);
    if (source.missionId !== target.missionId) return;
    const implementation = snapshot.assignments.find(
      assignment =>
        assignment.missionId === source.missionId &&
        assignment.workflowStage === CodingWorkflowStage.Implementation,
    );
    const implementationLane = implementation
      ? snapshot.lanes.find(lane => lane.id === implementation.laneId)
      : null;
    const handoff = this.collaboration.buildHandoff({
      snapshot,
      sourceLane: source,
      targetLane: target,
      baseline: this.requireMissionBaseline(
        snapshot.missions.find(mission => mission.id === source.missionId),
      ),
      diff: await this.getWorkspaceDiff(this.executionRoot(source, workspaceRoot)),
    });
    if (implementationLane && implementationLane.id !== source.id) {
      handoff.implementationDiff = await this.getWorkspaceDiff(
        this.executionRoot(implementationLane, workspaceRoot),
      );
    }
    const implementationDiff =
      typeof handoff.implementationDiff === 'string' ? handoff.implementationDiff : null;
    if (implementationDiff?.trim()) {
      if (!this.runtime.applyWorkspacePatch) {
        throw new Error('The coding runtime cannot materialize a collaborator patch.');
      }
      await this.runtime.applyWorkspacePatch({
        workspaceRoot: this.executionRoot(target, workspaceRoot),
        patch: implementationDiff,
      });
    }
    const handoffId = this.repository.createHandoff(source.missionId, source.id, target.id, handoff);
    this.repository.appendEvent(target.id, CodingEventKind.Message, {
      role: 'handoff',
      handoffId,
      content: handoff,
    });
    await this.prompt(workspaceRoot, { laneId: target.id, prompt: this.handoffPrompt(handoff) });
  }

  private buildRecoveryContext(laneId: string): string {
    const context = this.eventsToAnswer(laneId).trim();
    return context
      ? `Continue this coding task from the following handoff summary:\n${context}`
      : 'Continue this coding task in a new session. The prior session is unavailable.';
  }

  private failureStatus(lane: CodingAgentLane, error: unknown): CodingLaneStatus {
    const profile = this.registry.get(lane.profileId);
    if (
      profile?.driverKind !== CodingAgentDriverKind.Builtin &&
      /auth_required|authentication(?:\s+is)?\s+required|login required/i.test(
        this.errorMessage(error),
      )
    ) {
      this.registry.markNeedsAuth(profile.id);
      return CodingLaneStatus.NeedsAuth;
    }
    return CodingLaneStatus.Failed;
  }

  private publish(workspaceRoot: string): CodingRoomSnapshot {
    const snapshot = this.bootstrap(workspaceRoot);
    this.emit('changed', snapshot);
    return snapshot;
  }

  private requireLane(lanes: CodingAgentLane[], laneId: string): CodingAgentLane {
    const lane = lanes.find(candidate => candidate.id === laneId);
    if (!lane) throw new Error('Coding agent lane was not found.');
    return lane;
  }

  private knownRooms(): string[] {
    return this.repository.listRooms().map(room => room.workspaceRoot);
  }

  private executionRoot(lane: CodingAgentLane, roomWorkspaceRoot: string): string {
    return lane.executionRoot || roomWorkspaceRoot;
  }

  private async getWorkspaceBaseline(workspaceRoot: string): Promise<string | null> {
    if (!this.runtime.getWorkspaceBaseline) return null;
    try {
      return await this.runtime.getWorkspaceBaseline(workspaceRoot);
    } catch (error) {
      console.debug('[CodingRoom] Unable to read the workspace Git baseline:', error);
      return null;
    }
  }

  private async getWorkspaceDiff(workspaceRoot: string): Promise<string | null> {
    if (!this.runtime.getWorkspaceDiff) return null;
    try {
      return await this.runtime.getWorkspaceDiff(workspaceRoot);
    } catch (error) {
      console.debug('[CodingRoom] Unable to read the workspace Git diff:', error);
      return null;
    }
  }

  private requireMissionBaseline(mission: { gitBaseline: string | null } | undefined): string {
    if (!mission?.gitBaseline) {
      throw new Error('Parallel collaborators require a Git workspace with a frozen baseline.');
    }
    return mission.gitBaseline;
  }

  private allowedEnvironment(): Record<string, string | undefined> {
    return Object.fromEntries(ACP_ENVIRONMENT_KEYS.map(key => [key, process.env[key]]));
  }

  private async completeTerminalAuthentication(event: {
    id: string;
    profileId: string;
    methodId: string;
    exitCode: number;
    signal?: number;
  }): Promise<void> {
    for (const [laneId, profileId] of this.driverProfileIds) {
      if (profileId !== event.profileId) continue;
      await this.drivers.get(laneId)?.dispose();
      this.drivers.delete(laneId);
      this.driverProfileIds.delete(laneId);
      this.driverSessionIds.delete(laneId);
    }
    if (event.exitCode === 0) {
      const profile = this.registry.get(event.profileId);
      if (!profile) {
        console.warn('[CodingRoom] Authentication completed for an unavailable coding agent profile.');
      } else {
        const driver = this.driverFactory.create(profile);
        try {
          await driver.getAuthState();
          this.registry.markReady(event.profileId);
        } catch (error) {
          console.warn('[CodingRoom] ACP reinitialization after terminal authentication failed:', error);
          this.registry.markNeedsAuth(event.profileId);
        } finally {
          await driver.dispose();
        }
      }
    } else {
      this.registry.markNeedsAuth(event.profileId);
    }
    this.emit('authTerminalExit', event);
  }

  private requiresWriterLease(roomWorkspaceRoot: string, executionRoot: string): boolean {
    return roomWorkspaceRoot === executionRoot;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
