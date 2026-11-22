import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { readFile, readdir, rename, stat, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { t } from '../i18n';
import { WorkspaceBroker } from './workspaceBroker';
import { inspectWorkspaceContentAsync } from '../workbenchTask/artifactWorkerPool';
import {
  CodingAgentDriverKind,
  CodingAgentProfileStatus,
  CodingAssignmentStatus,
  CodingElicitationStatus,
  CodingErrorMessage,
  CodingEventKind,
  CodingLaneStatus,
  CodingMissionStatus,
  CodingPermissionOutcome,
  CodingWorkspaceFileKind,
  type CodingAgentAvailableCommand,
  type CodingAgentConfigOption,
  type CodingLaneChangePreview,
  type CodingLaneConfigOptionInput,
  type CodingLaneViewStateInput,
  type CodingWorkspaceSummary,
  type CreateCodingWorkspaceInput,
  type StartCodingSessionInput,
  type UpdateCodingWorkspaceInput,
  type AddCodingAgentProfileInput,
  type CodingGitCommitAndPushInput,
  type CodingGitCommitAndPushResult,
  type CodingGitCommitInput,
  type CodingGitDiffInput,
  type CodingGitStatus,
  type CodingGitTargetInput,
  type CodingElicitationResponse,
  type CodingPermissionResponse,
  type CodingRoomSnapshot,
  type CodingWorkspaceFileContent,
  type CodingWorkspaceFileEntry,
  type CodingWorkspaceFileInput,
  type CodingWorkspaceFileWriteInput,
} from '../../shared/codingAgent';
import { AuthTerminalService, type AuthTerminalExitedEvent } from './authTerminalService';
import type { CodingAgentRegistry } from './codingAgentRegistry';
import { CodingGitController } from './codingGitController';
import type { CodingRoomRepository } from './codingRoomRepository';
import { CodingRoomState } from './codingRoom/roomState';
import type { CodingRoomRuntime } from './codingRoom/runtimeContract';
import { CodingRoomTurnExecution } from './codingRoom/turnExecution';
import { CodingRoomWorkspaces } from './codingRoom/workspaces';
import { prepareCodingSession } from './codingSessionStartup';

/** @knipignore Kept importable from the historical codingRoomService path. */
export type { CodingRoomRuntime } from './codingRoom/runtimeContract';

/** Owns the Coding Room API and publishes events for its collaborators. */
export class CodingRoomService extends EventEmitter {
  private readonly authTerminals = new AuthTerminalService();
  private readonly room: CodingRoomState;
  private readonly turns: CodingRoomTurnExecution;
  private readonly git: CodingGitController;
  private readonly workspaces: CodingRoomWorkspaces;

  constructor(
    private readonly repository: CodingRoomRepository,
    readonly registry: CodingAgentRegistry,
    private readonly runtime: CodingRoomRuntime,
    acpEnvironment: Record<string, string | undefined> = {},
  ) {
    super();
    this.room = new CodingRoomState(
      repository,
      registry,
      runtime,
      this.emit.bind(this),
      acpEnvironment,
    );
    this.turns = new CodingRoomTurnExecution(this.room);
    this.git = new CodingGitController(repository);
    this.workspaces = new CodingRoomWorkspaces(
      repository,
      registry,
      this.room.driverPool,
      workspaceRoot => this.room.publish(workspaceRoot),
    );
    this.authTerminals.on('data', event => this.emit('authTerminalData', event));
    this.authTerminals.on('exit', event => {
      void this.completeTerminalAuthentication(event).catch(error => {
        console.warn(
          `[CodingRoom] Terminal authentication completion failed for ${event.profileId}:`,
          error,
        );
      });
    });
  }

  readonly bootstrap = (...args: Parameters<CodingRoomState['bootstrap']>) =>
    this.room.bootstrap(...args);

  readonly loadEventPage = (...args: Parameters<CodingRoomState['loadEventPage']>) =>
    this.room.loadEventPage(...args);

  readonly listPendingMessages = (
    ...args: Parameters<CodingRoomTurnExecution['listPendingMessages']>
  ) => this.turns.listPendingMessages(...args);

  readonly enqueuePendingMessage = (
    ...args: Parameters<CodingRoomTurnExecution['enqueuePendingMessage']>
  ) => this.turns.enqueuePendingMessage(...args);

  readonly updatePendingMessage = (
    ...args: Parameters<CodingRoomTurnExecution['updatePendingMessage']>
  ) => this.turns.updatePendingMessage(...args);

  readonly deletePendingMessage = (
    ...args: Parameters<CodingRoomTurnExecution['deletePendingMessage']>
  ) => this.turns.deletePendingMessage(...args);

  readonly steerPendingMessage = (
    ...args: Parameters<CodingRoomTurnExecution['steerPendingMessage']>
  ) => this.turns.steerPendingMessage(...args);

  readonly followUpPendingMessage = (
    ...args: Parameters<CodingRoomTurnExecution['followUpPendingMessage']>
  ) => this.turns.followUpPendingMessage(...args);

  readonly prompt = (...args: Parameters<CodingRoomTurnExecution['prompt']>) =>
    this.turns.prompt(...args);

  readonly confirmSessionRecovery = (
    ...args: Parameters<CodingRoomTurnExecution['confirmSessionRecovery']>
  ) => this.turns.confirmSessionRecovery(...args);

  readonly cancel = (...args: Parameters<CodingRoomTurnExecution['cancel']>) =>
    this.turns.cancel(...args);

  readonly recordBuiltinElicitation = (
    ...args: Parameters<CodingRoomTurnExecution['recordBuiltinElicitation']>
  ) => this.turns.recordBuiltinElicitation(...args);

  readonly isBuiltinLaneSession = (sessionId: string) =>
    this.repository.hasBuiltinLaneSession(sessionId);

  readonly recordBuiltinEvent = (
    ...args: Parameters<CodingRoomTurnExecution['recordBuiltinEvent']>
  ) => this.turns.recordBuiltinEvent(...args);

  readonly recordBuiltinInterruption = (
    ...args: Parameters<CodingRoomTurnExecution['recordBuiltinInterruption']>
  ) => this.turns.recordBuiltinInterruption(...args);

  listWorkspaces(): CodingWorkspaceSummary[] {
    return this.workspaces.listWorkspaces();
  }

  createWorkspace(input: CreateCodingWorkspaceInput): Promise<CodingWorkspaceSummary[]> {
    return this.workspaces.createWorkspace(input);
  }

  updateWorkspace(input: UpdateCodingWorkspaceInput): Promise<CodingWorkspaceSummary[]> {
    return this.workspaces.updateWorkspace(input);
  }

  deleteWorkspace(workspaceId: string): CodingWorkspaceSummary[] {
    return this.workspaces.deleteWorkspace(workspaceId);
  }

  deleteSession(workspaceRoot: string, laneId: string): CodingWorkspaceSummary[] {
    return this.workspaces.deleteSession(workspaceRoot, laneId);
  }

  handoff(
    workspaceRoot: string,
    sourceLaneId: string,
    targetLaneId: string,
  ): Promise<CodingRoomSnapshot> {
    return this.turns.collaboration.handoff(workspaceRoot, sourceLaneId, targetLaneId);
  }

  saveLaneView(workspaceRoot: string, input: CodingLaneViewStateInput): CodingRoomSnapshot {
    const snapshot = this.bootstrap(workspaceRoot);
    this.room.requireLane(snapshot.lanes, input.laneId);
    this.repository.updateLaneViewState(
      input.laneId,
      input.draft,
      Math.max(0, Math.floor(input.scrollPosition)),
    );
    return this.room.publish(workspaceRoot);
  }

  async setLaneConfigOption(
    workspaceRoot: string,
    input: CodingLaneConfigOptionInput,
  ): Promise<CodingRoomSnapshot> {
    const snapshot = this.bootstrap(workspaceRoot);
    const lane = this.room.requireLane(snapshot.lanes, input.laneId);
    const option = lane.configOptions.find(candidate => candidate.id === input.configId);
    if (!option) throw new Error(CodingErrorMessage.ConfigOptionNotFound);
    if (option.type === 'select') {
      if (
        typeof input.value !== 'string' ||
        !option.options?.some(candidate => candidate.value === input.value)
      ) {
        throw new Error(CodingErrorMessage.ConfigValueInvalid);
      }
    } else if (typeof input.value !== 'boolean') {
      throw new Error(CodingErrorMessage.ConfigValueInvalid);
    }
    const driver = this.room.getDriver(lane);
    const session = await this.room.ensureDriverSession(
      driver,
      lane,
      this.room.executionRoot(lane, workspaceRoot),
    );
    const configOptions = await driver.setConfigOption(session.id, input.configId, input.value);
    this.repository.updateLaneConfigOptions(lane.id, configOptions);
    return this.room.publish(workspaceRoot);
  }

  /** Switch the model of a built-in lane; applies live when the session is running. */
  async setLaneModelOverride(
    workspaceRoot: string,
    laneId: string,
    modelOverride: string | null,
  ): Promise<CodingRoomSnapshot> {
    const snapshot = this.bootstrap(workspaceRoot);
    const lane = this.room.requireLane(snapshot.lanes, laneId);
    const profile = this.registry.get(lane.profileId);
    if (profile?.driverKind !== CodingAgentDriverKind.Builtin) {
      throw new Error(CodingErrorMessage.ModelSwitchBuiltinOnly);
    }
    const normalized = modelOverride?.trim() || null;
    if (normalized) {
      await this.runtime.patchBuiltinSession?.(lane.localSessionId, { model: normalized });
    }
    this.repository.updateLaneModelOverride(lane.id, normalized);
    return this.room.publish(workspaceRoot);
  }

  async previewLaneChanges(
    workspaceRoot: string,
    laneId: string,
  ): Promise<CodingLaneChangePreview> {
    const snapshot = this.bootstrap(workspaceRoot);
    const lane = this.room.requireLane(snapshot.lanes, laneId);
    const executionRoot = this.room.executionRoot(lane, workspaceRoot);
    if (this.room.requiresWriterLease(lane.sourceRoot, executionRoot)) {
      throw new Error(CodingErrorMessage.CollaboratorPreviewIsolatedOnly);
    }
    if (!this.runtime.getIsolatedWorkspaceDiff) {
      throw new Error(CodingErrorMessage.RuntimeIsolatedDiffUnsupported);
    }
    return { laneId: lane.id, diff: await this.runtime.getIsolatedWorkspaceDiff(executionRoot) };
  }

  async applyLaneChanges(workspaceRoot: string, laneId: string): Promise<CodingRoomSnapshot> {
    const snapshot = this.bootstrap(workspaceRoot);
    const lane = this.room.requireLane(snapshot.lanes, laneId);
    const executionRoot = this.room.executionRoot(lane, workspaceRoot);
    if (this.room.requiresWriterLease(lane.sourceRoot, executionRoot)) {
      throw new Error(CodingErrorMessage.CollaboratorApplyIsolatedOnly);
    }
    if (this.repository.getWriterLease(snapshot.room.id, lane.sourceRoot)) {
      throw new Error(CodingErrorMessage.WorkspaceWriterBusy);
    }
    if (!this.runtime.applyIsolatedWorkspaceDiff) {
      throw new Error(CodingErrorMessage.RuntimeIsolatedApplyUnsupported);
    }
    await this.runtime.applyIsolatedWorkspaceDiff({
      workspaceRoot: lane.sourceRoot,
      isolatedWorkspaceRoot: executionRoot,
    });
    this.repository.appendEvent(lane.id, CodingEventKind.FileChange, {
      role: 'system',
      action: 'applied_to_workspace',
      workspaceRoot: lane.sourceRoot,
    });
    return this.room.publish(workspaceRoot);
  }

  listProfiles() {
    this.registry.refreshBuiltinReadiness();
    return this.registry.list();
  }

  async startSession(input: StartCodingSessionInput): Promise<CodingRoomSnapshot> {
    this.room.driverPool.assertOpen();
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error(CodingErrorMessage.PromptRequired);
    const prepared = await prepareCodingSession({
      request: input,
      prompt,
      repository: this.repository,
      registry: this.registry,
      driverFactory: this.room.driverFactory,
      driverPool: this.room.driverPool,
      validateBuiltinModel: this.runtime.validateBuiltinModel?.bind(this.runtime),
      getWorkspaceBaseline: sourceRoot => this.room.getWorkspaceBaseline(sourceRoot),
    });
    this.room.driverPool.assertOpen();
    const { room, profile, lane, driver, driverSession } = prepared;
    this.room.turnTracker.stageLane(lane.id);
    try {
      this.room.registerDriver(lane, profile, driver);
      this.room.driverPool.setSession(lane.id, {
        id: driverSession.id,
        connectionGeneration: driver.getConnectionGeneration?.() ?? null,
      });
      const snapshot = await this.prompt(room.workspaceRoot, {
        laneId: lane.id,
        prompt,
        attachments: input.attachments,
      });
      this.room.turnTracker.unstageLane(lane.id);
      return snapshot;
    } catch (error) {
      this.room.turnTracker.unstageLane(lane.id);
      await this.room.rollbackCreatedSession(room.id, lane);
      this.room.publish(room.workspaceRoot);
      throw error;
    }
  }

  async prepareLane(workspaceRoot: string, laneId: string): Promise<CodingRoomSnapshot> {
    const snapshot = this.bootstrap(workspaceRoot);
    const lane = this.room.requireLane(snapshot.lanes, laneId);
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
    const driver = this.room.getDriver(lane);
    await this.room.ensureDriverSession(driver, lane, this.room.executionRoot(lane, workspaceRoot));
    return this.room.publish(workspaceRoot);
  }

  /** Default config options a new session of this profile would start with. */
  getProfileConfigOptions(profileId: string): CodingAgentConfigOption[] {
    const profile = this.registry.get(profileId);
    if (!profile || profile.driverKind !== CodingAgentDriverKind.Builtin) return [];
    const driver = this.room.driverFactory.create(profile);
    return driver.getDefaultConfigOptions?.() ?? [];
  }

  /**
   * Commands a new session of this profile would start with. A draft has no
   * driver session yet, and the composer would otherwise show no slash commands
   * until the first turn creates one.
   */
  async getProfileAvailableCommands(profileId: string): Promise<CodingAgentAvailableCommand[]> {
    const profile = this.registry.get(profileId);
    if (!profile || profile.driverKind !== CodingAgentDriverKind.Builtin) return [];
    const driver = this.room.driverFactory.create(profile);
    return driver.getDefaultAvailableCommands?.() ?? [];
  }

  selectLane(workspaceRoot: string, laneId: string): CodingRoomSnapshot {
    const snapshot = this.bootstrap(workspaceRoot);
    const lane = this.room.requireLane(snapshot.lanes, laneId);
    this.repository.setActive(snapshot.room.id, lane.missionId, lane.id);
    return this.room.publish(workspaceRoot);
  }

  async getGitStatus(input: CodingGitTargetInput): Promise<CodingGitStatus> {
    return await this.git.getStatus(input);
  }

  async getGitDiff(input: CodingGitDiffInput): Promise<string> {
    return await this.git.getDiff(input);
  }

  async commitGitChanges(input: CodingGitCommitInput): Promise<CodingGitStatus> {
    return await this.git.commit(input);
  }

  async commitAndPushGitChanges(
    input: CodingGitCommitAndPushInput,
  ): Promise<CodingGitCommitAndPushResult> {
    return await this.git.commitAndPush(input);
  }

  async pushGitBranch(input: CodingGitTargetInput): Promise<CodingGitStatus> {
    return await this.git.push(input);
  }

  async switchGitBranch(
    input: import('../../shared/codingAgent').CodingGitBranchInput,
  ): Promise<CodingGitStatus> {
    return await this.git.switchBranch(input);
  }

  async createGitBranch(
    input: import('../../shared/codingAgent').CodingGitBranchInput,
  ): Promise<CodingGitStatus> {
    return await this.git.createBranch(input);
  }

  async createGitPullRequest(
    input: import('../../shared/codingAgent').CodingGitPullRequestInput,
  ): Promise<string> {
    return await this.git.createPullRequest(input);
  }

  async listWorkspaceFiles(input: CodingWorkspaceFileInput): Promise<CodingWorkspaceFileEntry[]> {
    const { sourceRoot, broker } = this.resolveWorkspaceBrowser(input);
    const relativePath = this.requireWorkspaceRelativePath(input.path);
    const directoryPath = await broker.resolveTarget(relativePath);
    const directory = await stat(directoryPath);
    if (!directory.isDirectory()) throw new Error(CodingErrorMessage.WorkspacePathNotDirectory);

    const entries = await readdir(directoryPath, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory() || entry.isFile())
      .sort((left, right) => {
        const kindOrder = Number(right.isDirectory()) - Number(left.isDirectory());
        return kindOrder || left.name.localeCompare(right.name, undefined, { numeric: true });
      })
      .slice(0, 300)
      .map(entry => ({
        name: entry.name,
        path: path.relative(sourceRoot, path.join(directoryPath, entry.name)),
        kind: entry.isDirectory()
          ? CodingWorkspaceFileKind.Directory
          : CodingWorkspaceFileKind.File,
      }));
  }

  async readWorkspaceFile(input: CodingWorkspaceFileInput): Promise<CodingWorkspaceFileContent> {
    const { sourceRoot, broker } = this.resolveWorkspaceBrowser(input);
    const relativePath = this.requireWorkspaceRelativePath(input.path);
    if (!relativePath) throw new Error(CodingErrorMessage.FilePreviewNotSelected);
    const filePath = await broker.resolveTarget(relativePath);
    const file = await stat(filePath);
    if (!file.isFile()) throw new Error(CodingErrorMessage.WorkspacePathNotFile);
    if (file.size > 512 * 1024) throw new Error(CodingErrorMessage.FilePreviewTooLarge);

    const content = await readFile(filePath);
    const inspected = await inspectWorkspaceContentAsync(content);
    if (inspected.binary) throw new Error(CodingErrorMessage.FilePreviewBinary);
    return {
      path: path.relative(sourceRoot, filePath),
      content: inspected.text,
      sha256: inspected.sha256,
    };
  }

  async writeWorkspaceFile(
    input: CodingWorkspaceFileWriteInput,
  ): Promise<CodingWorkspaceFileContent> {
    if (typeof input.content !== 'string') throw new Error(CodingErrorMessage.FileEditTextRequired);
    const content = Buffer.from(input.content, 'utf8');
    if (content.length > 512 * 1024) throw new Error(CodingErrorMessage.FileEditTooLarge);
    const { sourceRoot, broker, roomId } = this.resolveWorkspaceBrowser(input);
    const relativePath = this.requireWorkspaceRelativePath(input.path);
    if (!relativePath) throw new Error(CodingErrorMessage.FileEditNotSelected);
    if (this.repository.getWriterLease(roomId, sourceRoot)) {
      throw new Error(CodingErrorMessage.FileEditWriterBusy);
    }
    const filePath = await broker.resolveTarget(relativePath);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error(CodingErrorMessage.WorkspacePathNotFile);
    const current = await readFile(filePath);
    const currentInspection = await inspectWorkspaceContentAsync(current);
    if (currentInspection.sha256 !== input.expectedSha256) {
      throw new Error(CodingErrorMessage.FileEditChanged);
    }
    if (currentInspection.binary) throw new Error(CodingErrorMessage.FileEditBinary);
    const nextInspection = await inspectWorkspaceContentAsync(content);
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, content, { mode: fileStat.mode });
      await rename(temporaryPath, filePath);
    } finally {
      await unlink(temporaryPath).catch((): void => undefined);
    }
    return {
      path: path.relative(sourceRoot, filePath),
      content: input.content,
      sha256: nextInspection.sha256,
    };
  }

  private resolveWorkspaceBrowser(input: CodingWorkspaceFileInput): {
    roomId: string;
    sourceRoot: string;
    broker: WorkspaceBroker;
  } {
    const workspaceRoot = path.resolve(input.workspaceRoot);
    const room =
      this.repository.getRoomByRoot(workspaceRoot) ??
      this.repository
        .listRooms()
        .find(candidate => path.resolve(candidate.workspaceRoot) === workspaceRoot);
    if (!room) throw new Error(CodingErrorMessage.WorkspaceNotFound);

    const sourceRoot = path.resolve(input.sourceRoot || room.workspaceRoot);
    const source = this.repository
      .listWorkspaceSources(room.id)
      .find(candidate => path.resolve(candidate.path) === sourceRoot);
    if (!source) throw new Error(CodingErrorMessage.FileAccessNotInWorkspace);
    return { roomId: room.id, sourceRoot, broker: new WorkspaceBroker(sourceRoot) };
  }

  private requireWorkspaceRelativePath(value: string | undefined): string {
    const relativePath = value?.trim() ?? '';
    if (path.isAbsolute(relativePath) || relativePath.split(path.sep).includes('..')) {
      throw new Error(CodingErrorMessage.WorkspaceRelativePath);
    }
    return relativePath;
  }

  /**
   * Agent profiles are global configuration, so the manager has to keep working
   * before any workspace exists. Only a real workspace gets a refreshed room
   * snapshot back; otherwise the caller refreshes profiles with `listProfiles`.
   */
  private publishProfilesOrSnapshot(workspaceRoot: string): CodingRoomSnapshot | null {
    if (!workspaceRoot.trim()) {
      this.registry.refreshBuiltinReadiness();
      return null;
    }
    return this.room.publish(workspaceRoot);
  }

  async probeAgent(workspaceRoot: string, profileId: string): Promise<CodingRoomSnapshot | null> {
    // Connectivity only needs a directory to start the agent in; it does not
    // depend on which workspace is open.
    await this.registry.probe(profileId, workspaceRoot.trim() || process.cwd());
    this.room.driverPool.assertOpen();
    return this.publishProfilesOrSnapshot(workspaceRoot);
  }

  async discoverAgents(workspaceRoot: string): Promise<CodingRoomSnapshot | null> {
    await this.registry.discoverExternalAgents();
    this.room.driverPool.assertOpen();
    return this.publishProfilesOrSnapshot(workspaceRoot);
  }

  addProfile(workspaceRoot: string, input: AddCodingAgentProfileInput): CodingRoomSnapshot | null {
    this.registry.addUntrustedProfile(input);
    return this.publishProfilesOrSnapshot(workspaceRoot);
  }

  trustProfile(workspaceRoot: string, profileId: string): CodingRoomSnapshot | null {
    this.registry.trust(profileId);
    return this.publishProfilesOrSnapshot(workspaceRoot);
  }

  async authenticateProfile(
    workspaceRoot: string,
    profileId: string,
    methodId: string,
  ): Promise<CodingRoomSnapshot> {
    const { driverPool } = this.room;
    driverPool.assertOpen();
    const profile = this.registry.get(profileId);
    if (!profile || profile.isBuiltin || profile.status !== CodingAgentProfileStatus.NeedsAuth) {
      throw new Error(CodingErrorMessage.ProfileNotAwaitingAuth);
    }
    const method = profile.authMethods.find(candidate => candidate.id === methodId);
    if (!method) throw new Error(CodingErrorMessage.AuthMethodNotFound);
    if (method.type === 'terminal') {
      throw new Error(CodingErrorMessage.AgentTerminalAuthRequired);
    }
    const driver = this.room.driverFactory.create(profile);
    const requestId = randomUUID();
    driverPool.register(requestId, driver, profile.id);
    try {
      await driver.authenticate({ methodId, workspaceRoot });
    } finally {
      await driverPool.retire(requestId);
    }
    driverPool.assertOpen();
    await this.registry.probe(profileId, workspaceRoot);
    driverPool.assertOpen();
    return this.room.publish(workspaceRoot);
  }

  startTerminalAuthentication(
    workspaceRoot: string,
    profileId: string,
    methodId: string,
  ): { id: string; profileId: string; methodId: string } {
    this.room.driverPool.assertOpen();
    const profile = this.registry.get(profileId);
    if (!profile || profile.isBuiltin || profile.status !== CodingAgentProfileStatus.NeedsAuth) {
      throw new Error(CodingErrorMessage.ProfileNotAwaitingAuth);
    }
    const method = profile.authMethods.find(candidate => candidate.id === methodId);
    if (!method || method.type !== 'terminal' || !profile.command) {
      throw new Error(CodingErrorMessage.TerminalAuthUnavailable);
    }
    return this.authTerminals.start({
      profileId,
      methodId,
      executable: profile.command,
      baseArgs: profile.args,
      authArgs: method.args ?? [],
      cwd: workspaceRoot,
      environment: this.room.allowedEnvironment(),
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
    if (!event) throw new Error(CodingErrorMessage.PermissionRequestNotFound);
    const lane = this.room.requireLane(snapshot.lanes, event.laneId);
    console.debug(`[CodingRoom] received permission response for lane ${lane.id}`);
    if (this.registry.get(lane.profileId)?.driverKind === CodingAgentDriverKind.Builtin) {
      if (!this.runtime.respondBuiltinPermission) {
        throw new Error(CodingErrorMessage.BuiltinPermissionUnsupported);
      }
      this.runtime.respondBuiltinPermission(
        response.requestId,
        response.outcome === CodingPermissionOutcome.Selected,
      );
      this.repository.updateLaneStatus(lane.id, CodingLaneStatus.Running);
      this.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.Running);
      this.room.updateLaneAssignmentStatus(snapshot, lane.id, CodingAssignmentStatus.Running);
      this.repository.appendEvent(lane.id, CodingEventKind.ToolCall, {
        permissionRequestId: response.requestId,
        permissionOutcome: response.outcome,
      });
      return this.room.publish(workspaceRoot);
    }
    await this.room.getDriver(lane).respondToPermission(response);
    this.repository.updateLaneStatus(lane.id, CodingLaneStatus.Running);
    this.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.Running);
    this.room.updateLaneAssignmentStatus(snapshot, lane.id, CodingAssignmentStatus.Running);
    this.repository.appendEvent(lane.id, CodingEventKind.ToolCall, {
      permissionRequestId: response.requestId,
      permissionOutcome: response.outcome,
      optionId: response.optionId,
    });
    return this.room.publish(workspaceRoot);
  }

  async respondElicitation(
    workspaceRoot: string,
    response: CodingElicitationResponse,
  ): Promise<CodingRoomSnapshot> {
    const answer = response.answer.trim();
    if (!answer) throw new Error(t('codingAgentElicitationResponseRequired'));
    const snapshot = this.bootstrap(workspaceRoot);
    const elicitation = snapshot.elicitations.find(item => item.id === response.requestId);
    if (!elicitation || elicitation.status !== CodingElicitationStatus.Pending) {
      throw new Error(t('codingAgentElicitationNoLongerPending'));
    }
    const lane = this.room.requireLane(snapshot.lanes, elicitation.laneId);
    if (this.registry.get(lane.profileId)?.driverKind !== CodingAgentDriverKind.Builtin) {
      throw new Error(t('codingAgentElicitationBuiltinOnly'));
    }
    const executionRoot = this.room.executionRoot(lane, workspaceRoot);
    const requiresWriterLease = this.room.requiresWriterLease(lane.sourceRoot, executionRoot);
    if (requiresWriterLease) {
      this.repository.acquireWriterLease(snapshot.room.id, lane.sourceRoot, lane.id);
    }
    try {
      const delivered = this.runtime.respondBuiltinElicitation?.(elicitation.id, answer) === true;
      if (!delivered) {
        // The live session is gone: resume the lane with the answer as context.
        await this.runtime.startBuiltinSession({
          sessionId: lane.localSessionId,
          workspaceRoot: executionRoot,
          prompt: `${t('codingAgentElicitationAnsweredPrompt')} ${answer}`,
          modelOverride: lane.modelOverride,
          thinkingLevel: this.room.getThinkingLevel(lane),
          permissionMode: this.room.getApprovalMode(lane),
        });
      }
    } catch (error) {
      if (requiresWriterLease) {
        this.repository.releaseWriterLease(snapshot.room.id, lane.sourceRoot, lane.id);
      }
      throw error;
    }
    this.repository.answerElicitation(elicitation.id, answer);
    this.repository.appendEvent(lane.id, CodingEventKind.Elicitation, {
      requestId: elicitation.id,
      question: elicitation.question,
      answer,
      status: CodingElicitationStatus.Answered,
    });
    this.repository.updateLaneStatus(lane.id, CodingLaneStatus.Running);
    this.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.Running);
    this.room.updateLaneAssignmentStatus(snapshot, lane.id, CodingAssignmentStatus.Running);
    return this.room.publish(workspaceRoot);
  }

  async cancelElicitation(workspaceRoot: string, requestId: string): Promise<CodingRoomSnapshot> {
    const snapshot = this.bootstrap(workspaceRoot);
    const elicitation = snapshot.elicitations.find(item => item.id === requestId);
    if (!elicitation || elicitation.status !== CodingElicitationStatus.Pending) {
      throw new Error(t('codingAgentElicitationNoLongerPending'));
    }
    const lane = this.room.requireLane(snapshot.lanes, elicitation.laneId);
    if (this.registry.get(lane.profileId)?.driverKind !== CodingAgentDriverKind.Builtin) {
      throw new Error(t('codingAgentElicitationBuiltinOnly'));
    }
    const reason = t('codingAgentElicitationCancelledByUser');
    this.repository.cancelElicitation(requestId, reason);
    this.runtime.cancelBuiltinElicitation?.(requestId, reason);
    this.repository.appendEvent(lane.id, CodingEventKind.Elicitation, {
      requestId,
      question: elicitation.question,
      cancelReason: reason,
      status: CodingElicitationStatus.Cancelled,
    });
    await this.cancel(workspaceRoot, lane.id);
    return this.room.publish(workspaceRoot);
  }

  shutdown() {
    const probesStopped = this.registry.shutdown();
    return { probesStopped, drained: this.drainTurns() };
  }

  async dispose(): Promise<void> {
    const { probesStopped, drained } = this.shutdown();
    try {
      await drained;
    } finally {
      await probesStopped;
    }
  }

  private async drainTurns(): Promise<void> {
    const drivers = this.room.driverPool.disposeAll();
    try {
      this.authTerminals.dispose();
      this.room.eventDeltaBatcher.dispose();
      this.repository.flushPendingStreamWrites();
      await drivers;
    } finally {
      await Promise.allSettled([drivers]);
      // Wait for in-flight turns to finish writing before callers close SQLite.
      await this.room.turnTracker.settleInFlightTurns();
    }
  }

  private async completeTerminalAuthentication(event: AuthTerminalExitedEvent): Promise<void> {
    const { driverPool } = this.room;
    await driverPool.disposeWhereProfile(event.profileId);
    if (driverPool.isClosing) return;
    if (event.exitCode === 0) {
      const profile = this.registry.get(event.profileId);
      if (!profile) {
        console.warn(
          '[CodingRoom] Authentication completed for an unavailable coding agent profile.',
        );
      } else {
        try {
          await this.registry.probe(event.profileId, event.workspaceRoot);
        } catch (error) {
          if (driverPool.isClosing) return;
          console.warn(
            '[CodingRoom] Model reply verification after terminal authentication failed:',
            error,
          );
        }
      }
    } else {
      this.registry.markNeedsAuth(event.profileId);
    }
    if (!driverPool.isClosing) this.emit('authTerminalExit', event);
  }
}
