import {
  CodingAgentDriverKind,
  CodingAssignmentStatus,
  CodingElicitationStatus,
  CodingEventKind,
  CodingLaneStatus,
  CodingMissionStatus,
  type CodingAgentLane,
} from '../../../shared/codingAgent';
import type { CoworkSessionInterruption } from '../../../shared/cowork/interruption';
import { CodingRoomServiceTurnExecution } from './turnExecution';

/** Projects built-in Pi session events (and questions) onto coding lanes. */
export abstract class CodingRoomServiceBuiltinAgentEvents extends CodingRoomServiceTurnExecution {
  recordBuiltinElicitation(
    sessionId: string,
    request: { requestId: string; question: string },
  ): void {
    const laneId = this.builtinSessionLaneMap.get(sessionId);
    const question = request.question.trim();
    if (!question) return;
    for (const workspaceRoot of this.knownRooms()) {
      const snapshot = this.bootstrap(workspaceRoot);
      // A lane started without a prompt has not cached its session mapping yet,
      // so fall back to the persisted local session id before giving up.
      const lane = snapshot.lanes.find(
        candidate => candidate.id === laneId || candidate.localSessionId === sessionId,
      );
      if (!lane) continue;
      if (this.registry.get(lane.profileId)?.driverKind !== CodingAgentDriverKind.Builtin) return;
      this.builtinSessionLaneMap.set(sessionId, lane.id);
      this.repository.createElicitation(lane.id, question, request.requestId);
      this.repository.appendEvent(lane.id, CodingEventKind.Elicitation, {
        requestId: request.requestId,
        question,
        status: CodingElicitationStatus.Pending,
      });
      this.repository.updateLaneStatus(lane.id, CodingLaneStatus.WaitingElicitation);
      this.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.WaitingElicitation);
      this.updateLaneAssignmentStatus(snapshot, lane.id, CodingAssignmentStatus.WaitingElicitation);
      if (this.requiresWriterLease(lane.sourceRoot, this.executionRoot(lane, workspaceRoot))) {
        this.repository.releaseWriterLease(snapshot.room.id, lane.sourceRoot, lane.id);
      }
      this.publish(workspaceRoot);
      return;
    }
  }

  /**
   * Whether this cowork session is registered to a builtin coding lane.
   * Lazy cache: it fills from `recordBuiltinEvent` scanning rooms on the
   * session's first `'message'` event — which the streaming-text interest
   * resolver can only be asked about after that event fired, so the mapping
   * exists by then. The IM side mirrors this order (session mapping is
   * registered before the scheduled-task tool snapshots its delivery).
   */
  isBuiltinLaneSession(sessionId: string): boolean {
    return this.builtinSessionLaneMap.has(sessionId);
  }

  recordBuiltinEvent(
    sessionId: string,
    kind: (typeof CodingEventKind)[keyof typeof CodingEventKind],
    payload: Record<string, unknown>,
  ): void {
    const laneId = this.builtinSessionLaneMap.get(sessionId);
    if (laneId) {
      // Fast path: load the lane and its room directly instead of rebuilding
      // full snapshots of every room per streamed event.
      const lane = this.repository.getLaneById(laneId);
      const room = lane ? this.repository.getRoomByLaneId(laneId) : null;
      if (lane && room) {
        this.applyBuiltinEvent(room.workspaceRoot, room.id, lane, kind, payload);
        return;
      }
    }
    // Negative cache: a session that mapped to no lane once will not map to
    // one later unless a new lane registers it — sessionLifecycle clears this
    // set whenever a builtin lane mapping is added — so stop rescanning every
    // room per streamed event. A positive mapping above always wins.
    if (this.nonLaneSessionIds.has(sessionId)) return;
    // Cache miss or stale mapping: scan rooms once to find the lane, then
    // cache the mapping.
    for (const workspaceRoot of this.knownRooms()) {
      const snapshot = this.bootstrap(workspaceRoot);
      const lane = snapshot.lanes.find(
        candidate => candidate.localSessionId === sessionId || candidate.id === laneId,
      );
      if (!lane) continue;
      this.builtinSessionLaneMap.set(sessionId, lane.id);
      this.applyBuiltinEvent(workspaceRoot, snapshot.room.id, lane, kind, payload);
      return;
    }
    this.nonLaneSessionIds.add(sessionId);
  }

  private applyBuiltinEvent(
    workspaceRoot: string,
    roomId: string,
    lane: CodingAgentLane,
    kind: (typeof CodingEventKind)[keyof typeof CodingEventKind],
    payload: Record<string, unknown>,
  ): void {
    const event = this.repository.appendOrMergeStreamEvent(lane.id, kind, payload);
    if (kind === CodingEventKind.Permission) {
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
    if (kind === CodingEventKind.TurnComplete) {
      this.finishTurn(roomId, workspaceRoot, lane, CodingLaneStatus.Completed);
      this.publish(workspaceRoot);
      return;
    }
    if (kind === CodingEventKind.TurnFailed) {
      this.finishTurn(roomId, workspaceRoot, lane, CodingLaneStatus.Failed);
      this.publish(workspaceRoot);
      return;
    }
    this.eventDeltaBatcher.enqueue(workspaceRoot, event);
  }

  recordBuiltinInterruption(interruption: CoworkSessionInterruption): void {
    for (const workspaceRoot of this.knownRooms()) {
      const snapshot = this.bootstrap(workspaceRoot);
      const lane = snapshot.lanes.find(
        candidate => candidate.localSessionId === interruption.sessionId,
      );
      if (!lane) continue;
      this.repository.appendEvent(lane.id, CodingEventKind.TurnCancelled, {
        reason: interruption.cause,
        interruption,
      });
      this.repository.updateLaneStatus(lane.id, CodingLaneStatus.Idle);
      this.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.NeedsReview);
      this.updateLaneAssignmentStatus(snapshot, lane.id, CodingAssignmentStatus.Planned);
      this.publish(workspaceRoot);
      return;
    }
  }
}
