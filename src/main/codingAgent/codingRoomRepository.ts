import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';

import {
  CodingAssignmentStatus,
  CodingEventKind,
  CodingStreamUpdateMode,
  CodingLaneStatus,
  CodingMissionStatus,
  type CodingAgentLane,
  type CodingAgentConfigOption,
  type CodingAssignment,
  type CodingEvent,
  type CodingMission,
  type CodingRoom,
} from '../../shared/codingAgent';

const rowRoom = (row: Record<string, unknown>): CodingRoom => ({
  id: String(row.id),
  workspaceRoot: String(row.workspace_root),
  activeMissionId: row.active_mission_id as string | null,
  activeLaneId: row.active_lane_id as string | null,
});
const rowMission = (row: Record<string, unknown>): CodingMission => ({
  id: String(row.id),
  roomId: String(row.room_id),
  title: String(row.title),
  goal: String(row.goal),
  gitBaseline: (row.git_baseline as string | null) ?? null,
  status: row.status as CodingMissionStatus,
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
});
const rowLane = (row: Record<string, unknown>): CodingAgentLane => ({
  id: String(row.id),
  missionId: String(row.mission_id),
  profileId: String(row.profile_id),
  executionRoot: String(row.execution_root ?? ''),
  configOptions: JSON.parse(String(row.config_options_json ?? '[]')) as CodingAgentConfigOption[],
  localSessionId: String(row.local_session_id),
  remoteSessionId: row.remote_session_id as string | null,
  status: row.status as CodingLaneStatus,
  draft: String(row.draft),
  scrollPosition: Number(row.scroll_position),
  pendingRecoveryPrompt: (row.pending_recovery_prompt as string | null) ?? null,
  pendingRecoveryContext: (row.pending_recovery_context as string | null) ?? null,
});
const rowAssignment = (row: Record<string, unknown>): CodingAssignment => ({
  id: String(row.id),
  missionId: String(row.mission_id),
  laneId: String(row.lane_id),
  title: String(row.title),
  instructions: String(row.instructions),
  status: row.status as CodingAssignmentStatus,
  workbenchTaskId: row.workbench_task_id as string | null,
  workbenchRunId: row.workbench_run_id as string | null,
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
});

export class CodingRoomRepository {
  constructor(private readonly db: Database.Database) {}
  listRooms(): CodingRoom[] {
    return (this.db.prepare('SELECT * FROM coding_rooms').all() as Record<string, unknown>[]).map(
      rowRoom,
    );
  }
  getOrCreateRoom(workspaceRoot: string): CodingRoom {
    const found = this.db
      .prepare('SELECT * FROM coding_rooms WHERE workspace_root = ?')
      .get(workspaceRoot) as Record<string, unknown> | undefined;
    if (found) return rowRoom(found);
    const now = Date.now();
    const room: CodingRoom = {
      id: randomUUID(),
      workspaceRoot,
      activeMissionId: null,
      activeLaneId: null,
    };
    this.db
      .prepare(
        'INSERT INTO coding_rooms (id, workspace_root, active_mission_id, active_lane_id, created_at, updated_at) VALUES (?, ?, NULL, NULL, ?, ?)',
      )
      .run(room.id, room.workspaceRoot, now, now);
    return room;
  }
  listMissions(roomId: string): CodingMission[] {
    return (
      this.db
        .prepare('SELECT * FROM coding_missions WHERE room_id = ? ORDER BY updated_at DESC')
        .all(roomId) as Record<string, unknown>[]
    ).map(rowMission);
  }
  listLanes(missionIds: string[]): CodingAgentLane[] {
    if (!missionIds.length) return [];
    const marks = missionIds.map(() => '?').join(',');
    return (
      this.db
        .prepare(`SELECT * FROM coding_agent_lanes WHERE mission_id IN (${marks})`)
        .all(...missionIds) as Record<string, unknown>[]
    ).map(rowLane);
  }
  listAssignments(missionIds: string[]): CodingAssignment[] {
    if (!missionIds.length) return [];
    const marks = missionIds.map(() => '?').join(',');
    return (
      this.db
        .prepare(
          `SELECT * FROM coding_assignments WHERE mission_id IN (${marks}) ORDER BY created_at`,
        )
        .all(...missionIds) as Record<string, unknown>[]
    ).map(rowAssignment);
  }
  getLatestAssignmentForLane(laneId: string): CodingAssignment | null {
    const row = this.db
      .prepare(
        'SELECT * FROM coding_assignments WHERE lane_id = ? ORDER BY created_at DESC LIMIT 1',
      )
      .get(laneId) as Record<string, unknown> | undefined;
    return row ? rowAssignment(row) : null;
  }
  listEvents(laneIds: string[]): CodingEvent[] {
    if (!laneIds.length) return [];
    const marks = laneIds.map(() => '?').join(',');
    return (
      this.db
        .prepare(
          `SELECT * FROM coding_events WHERE lane_id IN (${marks}) ORDER BY lane_id, sequence`,
        )
        .all(...laneIds) as Record<string, unknown>[]
    ).map(row => ({
      id: String(row.id),
      laneId: String(row.lane_id),
      sequence: Number(row.sequence),
      kind: row.kind as CodingEvent['kind'],
      payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
      createdAt: Number(row.created_at),
    }));
  }
  createMission(roomId: string, title: string, gitBaseline: string | null = null): CodingMission {
    const now = Date.now();
    const mission = {
      id: randomUUID(),
      roomId,
      title,
      goal: title,
      gitBaseline,
      status: CodingMissionStatus.Draft,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        'INSERT INTO coding_missions (id, room_id, title, goal, git_baseline, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(mission.id, roomId, title, title, gitBaseline, mission.status, now, now);
    return mission;
  }
  createLane(
    missionId: string,
    profileId: string,
    executionRoot: string,
    id = randomUUID(),
  ): CodingAgentLane {
    const now = Date.now();
    const lane: CodingAgentLane = {
      id,
      missionId,
      profileId,
      executionRoot,
      configOptions: [],
      localSessionId: randomUUID(),
      remoteSessionId: null,
      status: CodingLaneStatus.Idle,
      draft: '',
      scrollPosition: 0,
      pendingRecoveryPrompt: null,
      pendingRecoveryContext: null,
    };
    this.db
      .prepare(
        'INSERT INTO coding_agent_lanes (id, mission_id, profile_id, execution_root, config_options_json, local_session_id, remote_session_id, status, draft, scroll_position, pending_recovery_prompt, pending_recovery_context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, NULL, ?, ?)',
      )
      .run(
        lane.id,
        missionId,
        profileId,
        lane.executionRoot,
        JSON.stringify(lane.configOptions),
        lane.localSessionId,
        lane.status,
        '',
        0,
        now,
        now,
      );
    return lane;
  }
  updateLaneConfigOptions(laneId: string, configOptions: CodingAgentConfigOption[]): void {
    this.db
      .prepare('UPDATE coding_agent_lanes SET config_options_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(configOptions), Date.now(), laneId);
  }
  createAssignment(input: {
    missionId: string;
    laneId: string;
    title: string;
    instructions: string;
  }): CodingAssignment {
    const now = Date.now();
    const assignment: CodingAssignment = {
      id: randomUUID(),
      ...input,
      status: CodingAssignmentStatus.Planned,
      workbenchTaskId: null,
      workbenchRunId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        'INSERT INTO coding_assignments (id, mission_id, lane_id, title, instructions, status, workbench_task_id, workbench_run_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)',
      )
      .run(
        assignment.id,
        assignment.missionId,
        assignment.laneId,
        assignment.title,
        assignment.instructions,
        assignment.status,
        now,
        now,
      );
    return assignment;
  }
  updateAssignmentStatus(assignmentId: string, status: CodingAssignmentStatus): void {
    this.db
      .prepare('UPDATE coding_assignments SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, Date.now(), assignmentId);
  }
  linkAssignmentWorkbench(
    assignmentId: string,
    workbenchTaskId: string,
    workbenchRunId: string,
  ): void {
    this.db
      .prepare(
        'UPDATE coding_assignments SET workbench_task_id = ?, workbench_run_id = ?, updated_at = ? WHERE id = ?',
      )
      .run(workbenchTaskId, workbenchRunId, Date.now(), assignmentId);
  }
  setActive(roomId: string, missionId: string, laneId: string): void {
    const now = Date.now();
    this.db
      .prepare(
        'UPDATE coding_rooms SET active_mission_id = ?, active_lane_id = ?, updated_at = ? WHERE id = ?',
      )
      .run(missionId, laneId, now, roomId);
  }
  appendEvent(
    laneId: string,
    kind: CodingEvent['kind'],
    payload: Record<string, unknown>,
  ): CodingEvent {
    const sequence =
      Number(
        (
          this.db
            .prepare(
              'SELECT COALESCE(MAX(sequence), 0) AS max_sequence FROM coding_events WHERE lane_id = ?',
            )
            .get(laneId) as { max_sequence: number }
        ).max_sequence,
      ) + 1;
    const event = { id: randomUUID(), laneId, sequence, kind, payload, createdAt: Date.now() };
    this.db
      .prepare('INSERT INTO coding_events VALUES (?, ?, ?, ?, ?, ?)')
      .run(event.id, laneId, sequence, kind, JSON.stringify(payload), event.createdAt);
    return event;
  }
  appendOrMergeStreamEvent(
    laneId: string,
    kind: CodingEvent['kind'],
    payload: Record<string, unknown>,
  ): CodingEvent {
    const messageId = typeof payload.messageId === 'string' ? payload.messageId : null;
    if (kind !== CodingEventKind.MessageDelta || !messageId) {
      return this.appendEvent(laneId, kind, payload);
    }
    const previous = this.db
      .prepare(
        "SELECT * FROM coding_events WHERE lane_id = ? AND kind = ? AND json_extract(payload_json, '$.messageId') = ? ORDER BY sequence DESC LIMIT 1",
      )
      .get(laneId, kind, messageId) as Record<string, unknown> | undefined;
    if (!previous) return this.appendEvent(laneId, kind, payload);
    const previousPayload = JSON.parse(String(previous.payload_json)) as Record<string, unknown>;
    const content =
      payload.streamUpdateMode === CodingStreamUpdateMode.Replace
        ? payload.content
        : `${typeof previousPayload.content === 'string' ? previousPayload.content : ''}${typeof payload.content === 'string' ? payload.content : ''}`;
    const event = {
      id: String(previous.id),
      laneId,
      sequence: Number(previous.sequence),
      kind,
      payload: { ...previousPayload, ...payload, content },
      createdAt: Number(previous.created_at),
    } satisfies CodingEvent;
    this.db
      .prepare('UPDATE coding_events SET payload_json = ? WHERE id = ?')
      .run(JSON.stringify(event.payload), event.id);
    return event;
  }
  updateLaneStatus(laneId: string, status: CodingLaneStatus): void {
    this.db
      .prepare('UPDATE coding_agent_lanes SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, Date.now(), laneId);
  }
  updateLaneRemoteSession(laneId: string, remoteSessionId: string | null): void {
    this.db
      .prepare('UPDATE coding_agent_lanes SET remote_session_id = ?, updated_at = ? WHERE id = ?')
      .run(remoteSessionId, Date.now(), laneId);
  }
  updateLaneViewState(laneId: string, draft: string, scrollPosition: number): void {
    this.db
      .prepare(
        'UPDATE coding_agent_lanes SET draft = ?, scroll_position = ?, updated_at = ? WHERE id = ?',
      )
      .run(draft, scrollPosition, Date.now(), laneId);
  }
  updateLaneRecovery(
    laneId: string,
    pendingRecoveryPrompt: string | null,
    pendingRecoveryContext: string | null,
  ): void {
    this.db
      .prepare(
        'UPDATE coding_agent_lanes SET pending_recovery_prompt = ?, pending_recovery_context = ?, updated_at = ? WHERE id = ?',
      )
      .run(pendingRecoveryPrompt, pendingRecoveryContext, Date.now(), laneId);
  }
  updateMissionStatus(missionId: string, status: CodingMissionStatus): void {
    this.db
      .prepare('UPDATE coding_missions SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, Date.now(), missionId);
  }
  acquireWriterLease(roomId: string, laneId: string): void {
    const now = Date.now();
    const lease = this.db
      .prepare('SELECT lane_id FROM coding_workspace_leases WHERE room_id = ?')
      .get(roomId) as { lane_id: string | null } | undefined;
    if (lease?.lane_id && lease.lane_id !== laneId)
      throw new Error('Another agent lane holds the workspace writer lease.');
    this.db
      .prepare(
        'INSERT INTO coding_workspace_leases (room_id, lane_id, acquired_at) VALUES (?, ?, ?) ON CONFLICT(room_id) DO UPDATE SET lane_id = excluded.lane_id, acquired_at = excluded.acquired_at',
      )
      .run(roomId, laneId, now);
  }
  releaseWriterLease(roomId: string, laneId: string): void {
    this.db
      .prepare(
        'UPDATE coding_workspace_leases SET lane_id = NULL, acquired_at = NULL WHERE room_id = ? AND lane_id = ?',
      )
      .run(roomId, laneId);
  }
  getWriterLease(roomId: string): string | null {
    const row = this.db
      .prepare('SELECT lane_id FROM coding_workspace_leases WHERE room_id = ?')
      .get(roomId) as { lane_id: string | null } | undefined;
    return row?.lane_id ?? null;
  }
  recoverInterruptedLanes(): CodingAgentLane[] {
    const interrupted = (
      this.db
        .prepare(
          'SELECT * FROM coding_agent_lanes WHERE status IN (?, ?)',
        )
        .all(CodingLaneStatus.Running, CodingLaneStatus.WaitingApproval) as Record<string, unknown>[]
    ).map(rowLane);
    if (!interrupted.length) return [];
    const laneIds = interrupted.map(lane => lane.id);
    const missionIds = [...new Set(interrupted.map(lane => lane.missionId))];
    const laneMarks = laneIds.map(() => '?').join(',');
    const missionMarks = missionIds.map(() => '?').join(',');
    const now = Date.now();
    const recover = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE coding_agent_lanes SET status = ?, updated_at = ? WHERE id IN (${laneMarks})`,
        )
        .run(CodingLaneStatus.Idle, now, ...laneIds);
      this.db
        .prepare(
          `UPDATE coding_assignments SET status = ?, updated_at = ? WHERE lane_id IN (${laneMarks}) AND status IN (?, ?)`,
        )
        .run(
          CodingAssignmentStatus.Planned,
          now,
          ...laneIds,
          CodingAssignmentStatus.Running,
          CodingAssignmentStatus.WaitingApproval,
        );
      this.db
        .prepare(
          `UPDATE coding_missions SET status = ?, updated_at = ? WHERE id IN (${missionMarks}) AND status IN (?, ?)`,
        )
        .run(
          CodingMissionStatus.NeedsReview,
          now,
          ...missionIds,
          CodingMissionStatus.Running,
          CodingMissionStatus.WaitingApproval,
        );
      this.db.prepare('UPDATE coding_workspace_leases SET lane_id = NULL, acquired_at = NULL').run();
    });
    recover();
    return interrupted;
  }
  createHandoff(
    missionId: string,
    sourceLaneId: string,
    targetLaneId: string,
    content: Record<string, unknown>,
  ): string {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO coding_handoffs VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, missionId, sourceLaneId, targetLaneId, JSON.stringify(content), Date.now());
    return id;
  }
}
