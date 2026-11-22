import type Database from 'better-sqlite3';
import {
  CodingAgentProfileId,
  type CodingAgentAvailableCommand,
  type CodingAgentConfigOption,
  type CodingAgentLane,
  type CodingLaneStatus,
} from '../../shared/codingAgent';

export function prepareBuiltinLaneLookup(db: Database.Database) {
  return db.prepare<[string], Record<string, unknown>>(`
    SELECT l.*, r.id AS room_id, r.workspace_root
    FROM coding_agent_lanes l
    JOIN coding_missions m ON m.id = l.mission_id
    JOIN coding_rooms r ON r.id = m.room_id
    WHERE l.local_session_id = ? AND l.profile_id = '${CodingAgentProfileId.Builtin}'
  `);
}

export const rowLane = (row: Record<string, unknown>): CodingAgentLane => ({
  id: String(row.id),
  missionId: String(row.mission_id),
  profileId: String(row.profile_id),
  modelOverride: (row.model_override as string | null) ?? null,
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
