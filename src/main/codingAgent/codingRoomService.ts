import { randomUUID } from 'crypto';
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
  type AddCodingAgentProfileInput,
  type CodingGitCommitAndPushInput,
  type CodingGitCommitAndPushResult,
  type CodingGitCommitInput,
  type CodingGitDiffInput,
  type CodingGitPathActionInput,
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
import { CodingRoomServiceTurnExecution } from './codingRoom/turnExecution';

/** @knipignore Kept importable from the historical codingRoomService path. */
export type { CodingRoomRuntime } from './codingRoom/runtimeContract';

/**
 * Facade over the coding-room layers: git integration, workspace file
 * browsing, agent profile management and permission/elicitation responses.
 */
export class CodingRoomService extends CodingRoomServiceTurnExecution {
  async getGitStatus(input: CodingGitTargetInput): Promise<CodingGitStatus> {
    return await this.git.getStatus(input);
  }

  async getGitDiff(input: CodingGitDiffInput): Promise<string> {
    return await this.git.getDiff(input);
  }

  async stageGitPaths(input: CodingGitPathActionInput): Promise<CodingGitStatus> {
    return await this.git.stage(input);
  }

  async unstageGitPaths(input: CodingGitPathActionInput): Promise<CodingGitStatus> {
    return await this.git.unstage(input);
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
    return this.publish(workspaceRoot);
  }

  async probeAgent(workspaceRoot: string, profileId: string): Promise<CodingRoomSnapshot | null> {
    // Connectivity only needs a directory to start the agent in; it does not
    // depend on which workspace is open.
    await this.registry.probe(profileId, workspaceRoot.trim() || process.cwd());
    return this.publishProfilesOrSnapshot(workspaceRoot);
  }

  async discoverAgents(workspaceRoot: string): Promise<CodingRoomSnapshot | null> {
    await this.registry.discoverExternalAgents();
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
    const profile = this.registry.get(profileId);
    if (!profile || profile.isBuiltin || profile.status !== CodingAgentProfileStatus.NeedsAuth) {
      throw new Error(CodingErrorMessage.ProfileNotAwaitingAuth);
    }
    const method = profile.authMethods.find(candidate => candidate.id === methodId);
    if (!method) throw new Error(CodingErrorMessage.AuthMethodNotFound);
    if (method.type === 'terminal') {
      throw new Error(CodingErrorMessage.AgentTerminalAuthRequired);
    }
    const driver = this.driverFactory.create(profile);
    try {
      await driver.authenticate({ methodId, workspaceRoot });
    } finally {
      await driver.dispose();
    }
    await this.registry.probe(profileId, workspaceRoot);
    return this.publish(workspaceRoot);
  }

  startTerminalAuthentication(
    workspaceRoot: string,
    profileId: string,
    methodId: string,
  ): { id: string; profileId: string; methodId: string } {
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
    if (!event) throw new Error(CodingErrorMessage.PermissionRequestNotFound);
    const lane = this.requireLane(snapshot.lanes, event.laneId);
    console.debug(`[CodingRoom] received permission response for lane ${lane.id}`);
    if (this.registry.get(lane.profileId)?.driverKind === CodingAgentDriverKind.Builtin) {
      if (!this.runtime.respondBuiltinPermission) {
        throw new Error(CodingErrorMessage.BuiltinPermissionUnsupported);
      }
      this.runtime.respondBuiltinPermission(
        response.requestId,
        response.outcome === CodingPermissionOutcome.Selected,
      );
      if (response.outcome === CodingPermissionOutcome.Selected) {
        this.repository.updateLaneStatus(lane.id, CodingLaneStatus.Running);
        this.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.Running);
        this.updateLaneAssignmentStatus(snapshot, lane.id, CodingAssignmentStatus.Running);
      }
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
    const lane = this.requireLane(snapshot.lanes, elicitation.laneId);
    if (this.registry.get(lane.profileId)?.driverKind !== CodingAgentDriverKind.Builtin) {
      throw new Error(t('codingAgentElicitationBuiltinOnly'));
    }
    const executionRoot = this.executionRoot(lane, workspaceRoot);
    const requiresWriterLease = this.requiresWriterLease(lane.sourceRoot, executionRoot);
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
          thinkingLevel: this.getThinkingLevel(lane),
          permissionMode: this.getApprovalMode(lane),
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
    this.updateLaneAssignmentStatus(snapshot, lane.id, CodingAssignmentStatus.Running);
    return this.publish(workspaceRoot);
  }

  async cancelElicitation(workspaceRoot: string, requestId: string): Promise<CodingRoomSnapshot> {
    const snapshot = this.bootstrap(workspaceRoot);
    const elicitation = snapshot.elicitations.find(item => item.id === requestId);
    if (!elicitation || elicitation.status !== CodingElicitationStatus.Pending) {
      throw new Error(t('codingAgentElicitationNoLongerPending'));
    }
    const lane = this.requireLane(snapshot.lanes, elicitation.laneId);
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
    return this.publish(workspaceRoot);
  }

  private isDisposed = false;

  async dispose(): Promise<void> {
    this.isDisposed = true;
    this.eventDeltaBatcher.dispose();
    this.repository.flushPendingStreamWrites();
    await Promise.all(this.driverPool.allDrivers().map(driver => driver.dispose()));
    this.driverPool.clear();
    this.authTerminals.dispose();
    this.laneSessionIndex.clear();
    // Disposing the drivers terminates their streams, which settles in-flight
    // turns. Wait for those turns so their completion/failure handlers finish
    // writing to the repository before callers close the database.
    await this.turnTracker.settleInFlightTurns();
  }

  protected async completeTerminalAuthentication(event: {
    id: string;
    profileId: string;
    methodId: string;
    workspaceRoot: string;
    exitCode: number;
    signal?: number;
  }): Promise<void> {
    await this.driverPool.disposeWhereProfile(event.profileId);
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
          console.warn(
            '[CodingRoom] Model reply verification after terminal authentication failed:',
            error,
          );
        }
      }
    } else {
      this.registry.markNeedsAuth(event.profileId);
    }
    this.emit('authTerminalExit', event);
  }
}
