import type Database from 'better-sqlite3';

import {
  type CodingAgentCapabilities,
  type CodingAgentAuthMethod,
  type CodingAgentProfile,
  type CodingAgentProfileStatus,
  type CodingAgentDriverKind,
} from '../../shared/codingAgent';

type ProfileRow = {
  id: string;
  name: string;
  description: string;
  driver_kind: CodingAgentDriverKind;
  status: CodingAgentProfileStatus;
  capabilities_json: string;
  auth_methods_json: string;
  command: string | null;
  args_json: string;
  environment_json: string;
  is_builtin: number;
};

const parseJson = <T>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const mapProfile = (row: ProfileRow): CodingAgentProfile => ({
  id: row.id,
  name: row.name,
  description: row.description,
  driverKind: row.driver_kind,
  status: row.status,
  capabilities: parseJson<CodingAgentCapabilities>(row.capabilities_json, {
    supportsLoadSession: false,
    supportsResumeSession: false,
    supportsPlans: false,
    supportsPermissions: false,
    supportsFilesystem: false,
    supportsTerminal: false,
    supportsConfigOptions: false,
    supportsUsage: false,
    supportsElicitation: false,
  }),
  authMethods: parseJson<CodingAgentAuthMethod[]>(row.auth_methods_json, []),
  command: row.command,
  args: parseJson<string[]>(row.args_json, []),
  environment: parseJson<Record<string, string>>(row.environment_json, {}),
  isBuiltin: Boolean(row.is_builtin),
});

export class CodingAgentProfileRepository {
  constructor(private readonly db: Database.Database) {}

  listExternal(): CodingAgentProfile[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM coding_agent_profiles WHERE is_builtin = 0 ORDER BY updated_at DESC',
        )
        .all() as ProfileRow[]
    ).map(mapProfile);
  }

  save(profile: CodingAgentProfile): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO coding_agent_profiles
         (id, name, description, driver_kind, status, capabilities_json, auth_methods_json, command, args_json, environment_json, is_builtin, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, description = excluded.description, driver_kind = excluded.driver_kind,
           status = excluded.status, capabilities_json = excluded.capabilities_json, auth_methods_json = excluded.auth_methods_json, command = excluded.command,
           args_json = excluded.args_json, environment_json = excluded.environment_json, is_builtin = excluded.is_builtin, updated_at = excluded.updated_at`,
      )
      .run(
        profile.id,
        profile.name,
        profile.description,
        profile.driverKind,
        profile.status,
        JSON.stringify(profile.capabilities),
        JSON.stringify(profile.authMethods),
        profile.command,
        JSON.stringify(profile.args),
        JSON.stringify(profile.environment),
        profile.isBuiltin ? 1 : 0,
        now,
        now,
      );
  }

  isReferenced(profileId: string): boolean {
    return Boolean(
      this.db
        .prepare('SELECT 1 FROM coding_agent_lanes WHERE profile_id = ? LIMIT 1')
        .get(profileId),
    );
  }

  removeIfUnreferenced(profileId: string, replacementProfileId: string): boolean {
    return this.db.transaction(() => {
      if (this.isReferenced(profileId)) return false;
      const profileExists = this.db
        .prepare('SELECT 1 FROM coding_agent_profiles WHERE id = ? LIMIT 1')
        .get(profileId);
      if (!profileExists) return false;
      const now = Date.now();
      this.db
        .prepare(
          'UPDATE coding_rooms SET default_profile_id = ?, updated_at = ? WHERE default_profile_id = ?',
        )
        .run(replacementProfileId, now, profileId);
      return this.db.prepare('DELETE FROM coding_agent_profiles WHERE id = ?').run(profileId).changes > 0;
    })();
  }
}
