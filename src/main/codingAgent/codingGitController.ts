import path from 'path';

import {
  CodingLaneStatus,
  type CodingGitCommitInput,
  type CodingGitDiffInput,
  type CodingGitPathActionInput,
  type CodingGitStatus,
  type CodingGitTargetInput,
} from '../../shared/codingAgent';
import { CodingGitService } from './codingGitService';
import type { CodingRoomRepository } from './codingRoomRepository';

interface ResolvedGitTarget {
  targetRoot: string;
  sourceRoot: string;
  isIsolated: boolean;
  isBusy: boolean;
}

export class CodingGitController {
  private readonly git = new CodingGitService();

  constructor(private readonly repository: CodingRoomRepository) {}

  async getStatus(input: CodingGitTargetInput): Promise<CodingGitStatus> {
    const target = this.resolveTarget(input);
    return await this.git.getStatus(target.targetRoot, target);
  }

  async getDiff(input: CodingGitDiffInput): Promise<string> {
    const target = this.resolveTarget(input);
    return await this.git.getDiff({ ...input, targetRoot: target.targetRoot });
  }

  async stage(input: CodingGitPathActionInput): Promise<CodingGitStatus> {
    const target = this.resolveMutableTarget(input);
    await this.git.stage(target.targetRoot, input.paths);
    return await this.git.getStatus(target.targetRoot, target);
  }

  async unstage(input: CodingGitPathActionInput): Promise<CodingGitStatus> {
    const target = this.resolveMutableTarget(input);
    await this.git.unstage(target.targetRoot, input.paths);
    return await this.git.getStatus(target.targetRoot, target);
  }

  async commit(input: CodingGitCommitInput): Promise<CodingGitStatus> {
    const target = this.resolveMutableTarget(input);
    await this.git.commit(target.targetRoot, input.message);
    return await this.git.getStatus(target.targetRoot, target);
  }

  async push(input: CodingGitTargetInput): Promise<CodingGitStatus> {
    const target = this.resolveMutableTarget(input);
    await this.git.push(target.targetRoot);
    return await this.git.getStatus(target.targetRoot, target);
  }

  private resolveMutableTarget(input: CodingGitTargetInput): ResolvedGitTarget {
    const target = this.resolveTarget(input);
    if (target.isIsolated) {
      throw new Error('Isolated collaborator worktrees are read-only in the Git panel.');
    }
    if (target.isBusy) {
      throw new Error(
        'Wait for the active coding agent write operation before changing Git state.',
      );
    }
    return target;
  }

  private resolveTarget(input: CodingGitTargetInput): ResolvedGitTarget {
    const workspaceRoot = path.resolve(input.workspaceRoot);
    const room =
      this.repository.getRoomByRoot(workspaceRoot) ??
      this.repository
        .listRooms()
        .find(candidate => path.resolve(candidate.workspaceRoot) === workspaceRoot);
    if (!room) throw new Error('Coding workspace was not found.');

    if (input.laneId) {
      const missions = this.repository.listMissions(room.id);
      const lane = this.repository
        .listLanes(missions.map(mission => mission.id))
        .find(candidate => candidate.id === input.laneId);
      if (!lane) throw new Error('Coding session was not found in this workspace.');
      const sourceRoot = path.resolve(lane.sourceRoot || room.workspaceRoot);
      const targetRoot = path.resolve(lane.executionRoot || sourceRoot);
      return {
        targetRoot,
        sourceRoot,
        isIsolated: sourceRoot !== targetRoot,
        isBusy:
          lane.status === CodingLaneStatus.Running ||
          lane.status === CodingLaneStatus.WaitingApproval ||
          this.repository.getWriterLease(room.id, sourceRoot) !== null,
      };
    }

    const requestedSource = path.resolve(input.sourceRoot || room.workspaceRoot);
    const source = this.repository
      .listWorkspaceSources(room.id)
      .find(candidate => path.resolve(candidate.path) === requestedSource);
    if (!source) throw new Error('Git access is limited to folders in the coding workspace.');
    return {
      targetRoot: requestedSource,
      sourceRoot: requestedSource,
      isIsolated: false,
      isBusy: this.repository.getWriterLease(room.id, requestedSource) !== null,
    };
  }
}
