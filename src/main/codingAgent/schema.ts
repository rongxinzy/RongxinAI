import type Database from 'better-sqlite3';

export function initializeCodingAgentSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS coding_rooms (
      id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', workspace_root TEXT NOT NULL UNIQUE,
      default_profile_id TEXT NOT NULL DEFAULT 'builtin-zhiyuan-coding',
      active_mission_id TEXT, active_lane_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS coding_workspace_sources (
      id TEXT PRIMARY KEY, room_id TEXT NOT NULL, path TEXT NOT NULL, is_primary INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, UNIQUE(room_id, path)
    );
    CREATE INDEX IF NOT EXISTS idx_coding_workspace_sources_room ON coding_workspace_sources(room_id, is_primary DESC, created_at);
    CREATE TABLE IF NOT EXISTS coding_missions (
      id TEXT PRIMARY KEY, room_id TEXT NOT NULL, title TEXT NOT NULL, goal TEXT NOT NULL,
      git_baseline TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_coding_missions_room_updated ON coding_missions(room_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS coding_agent_profiles (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
      driver_kind TEXT NOT NULL, status TEXT NOT NULL, capabilities_json TEXT NOT NULL, auth_methods_json TEXT NOT NULL DEFAULT '[]',
      command TEXT, args_json TEXT NOT NULL, environment_json TEXT NOT NULL DEFAULT '{}', is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_coding_agent_profiles_command ON coding_agent_profiles(command);
    CREATE TABLE IF NOT EXISTS coding_agent_lanes (
      id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, profile_id TEXT NOT NULL, source_root TEXT NOT NULL DEFAULT '', execution_root TEXT NOT NULL DEFAULT '', config_options_json TEXT NOT NULL DEFAULT '[]', available_commands_json TEXT NOT NULL DEFAULT '[]', local_session_id TEXT NOT NULL,
      remote_session_id TEXT, status TEXT NOT NULL, draft TEXT NOT NULL DEFAULT '', scroll_position INTEGER NOT NULL DEFAULT 0,
      pending_recovery_prompt TEXT, pending_recovery_context TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS coding_assignments (
      id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, lane_id TEXT NOT NULL,
      title TEXT NOT NULL, instructions TEXT NOT NULL, workflow_stage TEXT, previous_assignment_id TEXT, status TEXT NOT NULL,
      workbench_task_id TEXT, workbench_run_id TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_coding_assignments_mission ON coding_assignments(mission_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_coding_assignments_lane ON coding_assignments(lane_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS coding_events (
      id TEXT PRIMARY KEY, lane_id TEXT NOT NULL, sequence INTEGER NOT NULL, kind TEXT NOT NULL,
      payload_json TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(lane_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS idx_coding_events_lane_sequence ON coding_events(lane_id, sequence);
    CREATE TABLE IF NOT EXISTS coding_workspace_leases (
      room_id TEXT PRIMARY KEY, lane_id TEXT, acquired_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS coding_source_writer_leases (
      room_id TEXT NOT NULL, source_root TEXT NOT NULL, lane_id TEXT, acquired_at INTEGER,
      PRIMARY KEY(room_id, source_root)
    );
    CREATE TABLE IF NOT EXISTS coding_handoffs (
      id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, source_lane_id TEXT NOT NULL,
      target_lane_id TEXT NOT NULL, content_json TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_coding_handoffs_mission ON coding_handoffs(mission_id, created_at);
  `);
  const roomColumns = db.prepare('PRAGMA table_info(coding_rooms)').all() as Array<{
    name: string;
  }>;
  if (!roomColumns.some(column => column.name === 'name')) {
    db.exec("ALTER TABLE coding_rooms ADD COLUMN name TEXT NOT NULL DEFAULT ''");
  }
  if (!roomColumns.some(column => column.name === 'default_profile_id')) {
    db.exec(
      "ALTER TABLE coding_rooms ADD COLUMN default_profile_id TEXT NOT NULL DEFAULT 'builtin-zhiyuan-coding'",
    );
  }
  const laneColumns = db.prepare('PRAGMA table_info(coding_agent_lanes)').all() as Array<{
    name: string;
  }>;
  if (!laneColumns.some(column => column.name === 'execution_root')) {
    db.exec("ALTER TABLE coding_agent_lanes ADD COLUMN execution_root TEXT NOT NULL DEFAULT ''");
  }
  if (!laneColumns.some(column => column.name === 'source_root')) {
    db.exec("ALTER TABLE coding_agent_lanes ADD COLUMN source_root TEXT NOT NULL DEFAULT ''");
  }
  if (!laneColumns.some(column => column.name === 'config_options_json')) {
    db.exec(
      "ALTER TABLE coding_agent_lanes ADD COLUMN config_options_json TEXT NOT NULL DEFAULT '[]'",
    );
  }
  if (!laneColumns.some(column => column.name === 'available_commands_json')) {
    db.exec(
      "ALTER TABLE coding_agent_lanes ADD COLUMN available_commands_json TEXT NOT NULL DEFAULT '[]'",
    );
  }
  if (!laneColumns.some(column => column.name === 'pending_recovery_prompt')) {
    db.exec('ALTER TABLE coding_agent_lanes ADD COLUMN pending_recovery_prompt TEXT');
  }
  if (!laneColumns.some(column => column.name === 'pending_recovery_context')) {
    db.exec('ALTER TABLE coding_agent_lanes ADD COLUMN pending_recovery_context TEXT');
  }
  const missionColumns = db.prepare('PRAGMA table_info(coding_missions)').all() as Array<{
    name: string;
  }>;
  if (!missionColumns.some(column => column.name === 'git_baseline')) {
    db.exec('ALTER TABLE coding_missions ADD COLUMN git_baseline TEXT');
  }
  const profileColumns = db.prepare('PRAGMA table_info(coding_agent_profiles)').all() as Array<{
    name: string;
  }>;
  if (!profileColumns.some(column => column.name === 'auth_methods_json')) {
    db.exec(
      "ALTER TABLE coding_agent_profiles ADD COLUMN auth_methods_json TEXT NOT NULL DEFAULT '[]'",
    );
  }
  if (!profileColumns.some(column => column.name === 'environment_json')) {
    db.exec(
      "ALTER TABLE coding_agent_profiles ADD COLUMN environment_json TEXT NOT NULL DEFAULT '{}'",
    );
  }
  const assignmentColumns = db.prepare('PRAGMA table_info(coding_assignments)').all() as Array<{
    name: string;
  }>;
  if (!assignmentColumns.some(column => column.name === 'workflow_stage')) {
    db.exec('ALTER TABLE coding_assignments ADD COLUMN workflow_stage TEXT');
  }
  if (!assignmentColumns.some(column => column.name === 'previous_assignment_id')) {
    db.exec('ALTER TABLE coding_assignments ADD COLUMN previous_assignment_id TEXT');
  }
  db.exec(`
    DELETE FROM coding_workspace_sources
      WHERE room_id IN (SELECT id FROM coding_rooms WHERE trim(workspace_root) = '');
    DELETE FROM coding_rooms WHERE trim(workspace_root) = '';
    UPDATE coding_rooms SET name = workspace_root WHERE name = '';
    INSERT OR IGNORE INTO coding_workspace_sources (id, room_id, path, is_primary, created_at)
      SELECT lower(hex(randomblob(16))), id, workspace_root, 1, created_at FROM coding_rooms;
    UPDATE coding_agent_lanes
      SET source_root = COALESCE(
        (SELECT coding_rooms.workspace_root FROM coding_missions
          JOIN coding_rooms ON coding_rooms.id = coding_missions.room_id
          WHERE coding_missions.id = coding_agent_lanes.mission_id),
        execution_root
      )
      WHERE source_root = '';
  `);
}
