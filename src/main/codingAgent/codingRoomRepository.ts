import { randomUUID } from 'crypto';
import path from 'path';
import type Database from 'better-sqlite3';

import {
  CodingAssignmentStatus,
  CodingEventKind,
  CodingAgentProfileId,
  CodingStreamUpdateMode,
  CodingLaneStatus,
  CodingMissionStatus,
  type CodingAgentAvailableCommand,
  type CodingWorkflowStage,
  type CodingAgentLane,
  type CodingAgentConfigOption,
  type CodingAssignment,
  type CodingEvent,
  type CodingMission,
  type CodingRoom,
  type CodingWorkspaceSource,
} from '../../shared/codingAgent';

const rowRoom = (row: Record<string, unknown>): CodingRoom => {
  const workspaceRoot = String(row.workspace_root);
  const storedName = String(row.name ?? '');
  return {
    id: String(row.id),
    name: !storedName || storedName === workspaceRoot ? path.basename(workspaceRoot) : storedName,
    workspaceRoot,
    defaultProfileId: String(row.default_profile_id || CodingAgentProfileId.Builtin),
    activeMissionId: row.active_mission_id as string | null,
    activeLaneId: row.active_lane_id as string | null,
  };
};
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
  sourceRoot: String(row.source_root || row.execution_root || ''),
  executionRoot: String(row.execution_root ?? ''),
  configOptions: JSON.parse(String(row.config_options_json ?? '[]')) as CodingAgentConfigOption[],
  availableCommands: JSON.parse(
    String(row.available_commands_json ?? '[]'),
  ) as CodingAgentAvailableCommand[],
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
  workflowStage: (row.workflow_stage as CodingWorkflowStage | null) ?? null,
  previousAssignmentId: (row.previous_assignment_id as string | null) ?? null,
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
});
const rowWorkspaceSource = (row: Record<string, unknown>): CodingWorkspaceSource => ({
  id: String(row.id),
  workspaceId: String(row.room_id),
  path: String(row.path),
  isPrimary: Boolean(row.is_primary),
});

export class CodingRoomRepository {
  constructor(private readonly db: Database.Database) {}
  listRooms(): CodingRoom[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM coding_rooms WHERE trim(workspace_root) <> '' ORDER BY updated_at DESC",
        )
        .all() as Record<string, unknown>[]
    ).map(rowRoom);
  }
  getRoomById(roomId: string): CodingRoom | null {
    const row = this.db.prepare('SELECT * FROM coding_rooms WHERE id = ?').get(roomId) as
      | Record<string, unknown>
      | undefined;
    return row ? rowRoom(row) : null;
  }
  getRoomByRoot(workspaceRoot: string): CodingRoom | null {
    const row = this.db
      .prepare('SELECT * FROM coding_rooms WHERE workspace_root = ?')
      .get(workspaceRoot) as Record<string, unknown> | undefined;
    return row ? rowRoom(row) : null;
  }
  getOrCreateRoom(workspaceRoot: string): CodingRoom {
    if (!workspaceRoot.trim()) throw new Error('Coding workspace root is required.');
    const found = this.getRoomByRoot(workspaceRoot);
    if (found) return found;
    const now = Date.now();
    const room: CodingRoom = {
      id: randomUUID(),
      name: path.basename(workspaceRoot),
      workspaceRoot,
      defaultProfileId: CodingAgentProfileId.Builtin,
      activeMissionId: null,
      activeLaneId: null,
    };
    const create = this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO coding_rooms (id, name, workspace_root, default_profile_id, active_mission_id, active_lane_id, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)',
        )
        .run(room.id, room.name, room.workspaceRoot, room.defaultProfileId, now, now);
      this.db
        .prepare(
          'INSERT INTO coding_workspace_sources (id, room_id, path, is_primary, created_at) VALUES (?, ?, ?, 1, ?)',
        )
        .run(randomUUID(), room.id, room.workspaceRoot, now);
    });
    create();
    return room;
  }
  createWorkspace(name: string, sourceFolders: string[], defaultProfileId: string): CodingRoom {
    const primaryRoot = sourceFolders[0];
    if (!primaryRoot) throw new Error('A coding workspace requires at least one source folder.');
    if (this.getRoomByRoot(primaryRoot)) {
      throw new Error('A coding workspace already uses this primary source folder.');
    }
    const now = Date.now();
    const room: CodingRoom = {
      id: randomUUID(),
      name,
      workspaceRoot: primaryRoot,
      defaultProfileId,
      activeMissionId: null,
      activeLaneId: null,
    };
    const create = this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO coding_rooms (id, name, workspace_root, default_profile_id, active_mission_id, active_lane_id, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)',
        )
        .run(room.id, room.name, room.workspaceRoot, room.defaultProfileId, now, now);
      const insertSource = this.db.prepare(
        'INSERT INTO coding_workspace_sources (id, room_id, path, is_primary, created_at) VALUES (?, ?, ?, ?, ?)',
      );
      sourceFolders.forEach((source, index) =>
        insertSource.run(randomUUID(), room.id, source, index === 0 ? 1 : 0, now + index),
      );
    });
    create();
    return room;
  }
  listWorkspaceSources(roomId: string): CodingWorkspaceSource[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM coding_workspace_sources WHERE room_id = ? ORDER BY is_primary DESC, created_at',
        )
        .all(roomId) as Record<string, unknown>[]
    ).map(rowWorkspaceSource);
  }
  findWorkspaceIdBySource(sourcePath: string): string | null {
    const row = this.db
      .prepare('SELECT room_id FROM coding_workspace_sources WHERE path = ? LIMIT 1')
      .get(sourcePath) as { room_id: string } | undefined;
    return row?.room_id ?? null;
  }
  updateWorkspace(
    roomId: string,
    name: string,
    sourceFolders: string[],
    defaultProfileId: string,
  ): CodingRoom {
    const primaryRoot = sourceFolders[0];
    if (!primaryRoot) throw new Error('A coding workspace requires at least one source folder.');
    const now = Date.now();
    const update = this.db.transaction(() => {
      this.db
        .prepare(
          'UPDATE coding_rooms SET name = ?, workspace_root = ?, default_profile_id = ?, updated_at = ? WHERE id = ?',
        )
        .run(name, primaryRoot, defaultProfileId, now, roomId);
      this.db.prepare('DELETE FROM coding_workspace_sources WHERE room_id = ?').run(roomId);
      const insertSource = this.db.prepare(
        'INSERT INTO coding_workspace_sources (id, room_id, path, is_primary, created_at) VALUES (?, ?, ?, ?, ?)',
      );
      sourceFolders.forEach((source, index) =>
        insertSource.run(randomUUID(), roomId, source, index === 0 ? 1 : 0, now + index),
      );
    });
    update();
    const room = this.getRoomById(roomId);
    if (!room) throw new Error('Coding workspace was not found.');
    return room;
  }
  deleteWorkspace(roomId: string): void {
    const missionIds = this.listMissions(roomId).map(mission => mission.id);
    const laneIds = this.listLanes(missionIds).map(lane => lane.id);
    const remove = this.db.transaction(() => {
      if (laneIds.length) {
        const laneMarks = laneIds.map(() => '?').join(',');
        this.db
          .prepare(`DELETE FROM coding_events WHERE lane_id IN (${laneMarks})`)
          .run(...laneIds);
        this.db
          .prepare(`DELETE FROM coding_assignments WHERE lane_id IN (${laneMarks})`)
          .run(...laneIds);
      }
      if (missionIds.length) {
        const missionMarks = missionIds.map(() => '?').join(',');
        this.db
          .prepare(`DELETE FROM coding_handoffs WHERE mission_id IN (${missionMarks})`)
          .run(...missionIds);
        this.db
          .prepare(`DELETE FROM coding_agent_lanes WHERE mission_id IN (${missionMarks})`)
          .run(...missionIds);
        this.db
          .prepare(`DELETE FROM coding_missions WHERE id IN (${missionMarks})`)
          .run(...missionIds);
      }
      this.db.prepare('DELETE FROM coding_source_writer_leases WHERE room_id = ?').run(roomId);
      this.db.prepare('DELETE FROM coding_workspace_leases WHERE room_id = ?').run(roomId);
      this.db.prepare('DELETE FROM coding_workspace_sources WHERE room_id = ?').run(roomId);
      this.db.prepare('DELETE FROM coding_rooms WHERE id = ?').run(roomId);
    });
    remove();
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
  updateMissionTitle(missionId: string, title: string): void {
    const normalized = title.trim();
    if (!normalized) return;
    this.db
      .prepare('UPDATE coding_missions SET title = ?, goal = ?, updated_at = ? WHERE id = ?')
      .run(normalized, normalized, Date.now(), missionId);
  }
  deleteMission(roomId: string, missionId: string): void {
    const laneIds = this.listLanes([missionId]).map(lane => lane.id);
    const remove = this.db.transaction(() => {
      if (laneIds.length) {
        const marks = laneIds.map(() => '?').join(',');
        this.db.prepare(`DELETE FROM coding_events WHERE lane_id IN (${marks})`).run(...laneIds);
        this.db
          .prepare(`DELETE FROM coding_assignments WHERE lane_id IN (${marks})`)
          .run(...laneIds);
      }
      this.db.prepare('DELETE FROM coding_handoffs WHERE mission_id = ?').run(missionId);
      this.db.prepare('DELETE FROM coding_agent_lanes WHERE mission_id = ?').run(missionId);
      this.db.prepare('DELETE FROM coding_missions WHERE id = ?').run(missionId);
      this.db
        .prepare(
          'UPDATE coding_rooms SET active_mission_id = NULL, active_lane_id = NULL, updated_at = ? WHERE id = ? AND active_mission_id = ?',
        )
        .run(Date.now(), roomId, missionId);
    });
    remove();
  }
  deleteLane(roomId: string, laneId: string): void {
    const remove = this.db.transaction(() => {
      this.db.prepare('DELETE FROM coding_events WHERE lane_id = ?').run(laneId);
      this.db.prepare('DELETE FROM coding_assignments WHERE lane_id = ?').run(laneId);
      this.db
        .prepare('DELETE FROM coding_handoffs WHERE source_lane_id = ? OR target_lane_id = ?')
        .run(laneId, laneId);
      this.db.prepare('DELETE FROM coding_agent_lanes WHERE id = ?').run(laneId);
      this.db
        .prepare(
          'UPDATE coding_rooms SET active_lane_id = NULL, updated_at = ? WHERE id = ? AND active_lane_id = ?',
        )
        .run(Date.now(), roomId, laneId);
    });
    remove();
  }
  createLane(
    missionId: string,
    profileId: string,
    sourceRoot: string,
    executionRoot = sourceRoot,
    id: string = randomUUID(),
    localSessionId: string = randomUUID(),
  ): CodingAgentLane {
    const now = Date.now();
    const lane: CodingAgentLane = {
      id,
      missionId,
      profileId,
      sourceRoot,
      executionRoot,
      configOptions: [],
      availableCommands: [],
      localSessionId,
      remoteSessionId: null,
      status: CodingLaneStatus.Idle,
      draft: '',
      scrollPosition: 0,
      pendingRecoveryPrompt: null,
      pendingRecoveryContext: null,
    };
    this.db
      .prepare(
        'INSERT INTO coding_agent_lanes (id, mission_id, profile_id, source_root, execution_root, config_options_json, available_commands_json, local_session_id, remote_session_id, status, draft, scroll_position, pending_recovery_prompt, pending_recovery_context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, NULL, ?, ?)',
      )
      .run(
        lane.id,
        missionId,
        profileId,
        lane.sourceRoot,
        lane.executionRoot,
        JSON.stringify(lane.configOptions),
        JSON.stringify(lane.availableCommands),
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
  updateLaneAvailableCommands(
    laneId: string,
    availableCommands: CodingAgentAvailableCommand[],
  ): void {
    this.db
      .prepare(
        'UPDATE coding_agent_lanes SET available_commands_json = ?, updated_at = ? WHERE id = ?',
      )
      .run(JSON.stringify(availableCommands), Date.now(), laneId);
  }
  createAssignment(input: {
    missionId: string;
    laneId: string;
    title: string;
    instructions: string;
    workflowStage?: CodingWorkflowStage | null;
    previousAssignmentId?: string | null;
  }): CodingAssignment {
    const now = Date.now();
    const assignment: CodingAssignment = {
      id: randomUUID(),
      ...input,
      workflowStage: input.workflowStage ?? null,
      previousAssignmentId: input.previousAssignmentId ?? null,
      status: CodingAssignmentStatus.Planned,
      workbenchTaskId: null,
      workbenchRunId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        'INSERT INTO coding_assignments (id, mission_id, lane_id, title, instructions, workflow_stage, previous_assignment_id, status, workbench_task_id, workbench_run_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)',
      )
      .run(
        assignment.id,
        assignment.missionId,
        assignment.laneId,
        assignment.title,
        assignment.instructions,
        assignment.workflowStage,
        assignment.previousAssignmentId,
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
  acquireWriterLease(roomId: string, sourceRoot: string, laneId: string): void {
    const now = Date.now();
    const lease = this.db
      .prepare(
        'SELECT lane_id FROM coding_source_writer_leases WHERE room_id = ? AND source_root = ?',
      )
      .get(roomId, sourceRoot) as { lane_id: string | null } | undefined;
    if (lease?.lane_id && lease.lane_id !== laneId)
      throw new Error('Another agent lane holds the workspace writer lease.');
    this.db
      .prepare(
        'INSERT INTO coding_source_writer_leases (room_id, source_root, lane_id, acquired_at) VALUES (?, ?, ?, ?) ON CONFLICT(room_id, source_root) DO UPDATE SET lane_id = excluded.lane_id, acquired_at = excluded.acquired_at',
      )
      .run(roomId, sourceRoot, laneId, now);
  }
  releaseWriterLease(roomId: string, sourceRoot: string, laneId: string): void {
    this.db
      .prepare(
        'UPDATE coding_source_writer_leases SET lane_id = NULL, acquired_at = NULL WHERE room_id = ? AND source_root = ? AND lane_id = ?',
      )
      .run(roomId, sourceRoot, laneId);
  }
  getWriterLease(roomId: string, sourceRoot: string): string | null {
    const row = this.db
      .prepare(
        'SELECT lane_id FROM coding_source_writer_leases WHERE room_id = ? AND source_root = ?',
      )
      .get(roomId, sourceRoot) as { lane_id: string | null } | undefined;
    return row?.lane_id ?? null;
  }
  recoverInterruptedLanes(): CodingAgentLane[] {
    const interrupted = (
      this.db
        .prepare('SELECT * FROM coding_agent_lanes WHERE status IN (?, ?)')
        .all(CodingLaneStatus.Running, CodingLaneStatus.WaitingApproval) as Record<
        string,
        unknown
      >[]
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
      this.db
        .prepare('UPDATE coding_workspace_leases SET lane_id = NULL, acquired_at = NULL')
        .run();
      this.db
        .prepare('UPDATE coding_source_writer_leases SET lane_id = NULL, acquired_at = NULL')
        .run();
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
