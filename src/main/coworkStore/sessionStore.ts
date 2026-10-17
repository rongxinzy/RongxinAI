// Session CRUD and listing for the CoworkStore class chain.
// Split from src/main/coworkStore.ts (issue #1069).
import { v4 as uuidv4 } from 'uuid';

import {
  COWORK_MESSAGE_PAGE_SIZE,
  COWORK_SESSION_PAGE_SIZE,
  CoworkExecutionMode,
  CoworkSessionMode,
  CoworkSessionSource,
  type CoworkExecutionMode as CoworkExecutionModeType,
  type CoworkSessionMode as CoworkSessionModeType,
} from '../../shared/cowork/constants';
import type { CoworkPersistedArtifact } from '../../shared/cowork/artifacts';
import type {
  CoworkSessionExpertInput,
  CoworkSessionExpertSnapshot,
} from '../../shared/cowork/sessionExperts';
import {
  ensureDefaultConversationWorkspacePath,
  isDefaultConversationWorkspacePath,
} from '../defaultConversationWorkspace';
import { normalizeWorkspacePath } from '../workspaceUtils';
import {
  readCoworkSessionArtifacts,
  readCoworkSessionMessages,
  type CoworkSessionReadOptions,
} from '../coworkSessionRead';
import { CoworkMessageStore } from './messageStore';
import type { CoworkSession, CoworkSessionStatus, CoworkSessionSummary } from './types';

export class CoworkSessionStore extends CoworkMessageStore {
  createSession(
    title: string,
    cwd: string,
    systemPrompt: string = '',
    executionMode: CoworkExecutionModeType = CoworkExecutionMode.Local,
    activeSkillIds: string[] = [],
    agentId: string = 'main',
    modelOverride: string = '',
    mode: 'work' | 'chat' = 'work',
    id?: string,
    workspaceId?: string,
    expertSnapshots: CoworkSessionExpertInput[] = [],
    source: CoworkSessionSource = CoworkSessionSource.Manual,
  ): CoworkSession {
    const sessionId = id || uuidv4();
    const now = Date.now();
    const resolvedCwd = isDefaultConversationWorkspacePath(cwd)
      ? ensureDefaultConversationWorkspacePath()
      : cwd;
    const workspace = workspaceId
      ? this.getWorkspace(workspaceId)
      : this.ensureWorkspace(resolvedCwd);
    if (!workspace) throw new Error('Workspace not found');

    const insertSession = this.db.prepare(`
      INSERT INTO cowork_sessions (id, title, title_user_renamed, status, mode, cwd, system_prompt, model_override, execution_mode, active_skill_ids, workspace_id, agent_id, pinned, source, created_at, updated_at)
      VALUES (?, ?, 0, 'idle', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `);
    const insertExpert = this.db.prepare(`
      INSERT INTO cowork_session_experts
        (session_id, expert_id, package_id, expert_name, source, prompt_snapshot, skill_ids, capability_policy, content_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const create = this.db.transaction(() => {
      insertSession.run(
        sessionId,
        title,
        mode,
        resolvedCwd,
        systemPrompt,
        modelOverride,
        executionMode,
        JSON.stringify(activeSkillIds),
        workspace.id,
        agentId,
        source,
        now,
        now,
      );
      for (const expert of expertSnapshots) {
        insertExpert.run(
          sessionId,
          expert.expertId,
          expert.packageId,
          expert.expertName,
          expert.source,
          expert.promptSnapshot,
          JSON.stringify(expert.skillIds),
          JSON.stringify(expert.capabilityPolicy ?? {}),
          expert.contentHash,
          now,
        );
      }
    });
    create();

    return {
      id: sessionId,
      title,
      titleUserRenamed: false,
      status: 'idle',
      mode,
      pinned: false,
      pinOrder: null,
      cwd,
      systemPrompt,
      modelOverride,
      executionMode,
      activeSkillIds,
      workspaceId: workspace.id,
      agentId,
      source,
      experts: expertSnapshots.map(expert => ({
        ...expert,
        capabilityPolicy: expert.capabilityPolicy ?? {},
        createdAt: now,
      })),
      messages: [],
      messagesOffset: 0,
      totalMessages: 0,
      artifacts: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  getSession(
    id: string,
    messageLimit: number | null = COWORK_MESSAGE_PAGE_SIZE,
    options: CoworkSessionReadOptions = {},
  ): CoworkSession | null {
    interface SessionRow {
      id: string;
      title: string;
      title_user_renamed?: number | null;
      status: string;
      mode: string | null;
      pinned?: number | null;
      pin_order?: number | null;
      cwd: string;
      system_prompt: string;
      model_override?: string | null;
      execution_mode?: string | null;
      active_skill_ids?: string | null;
      workspace_id?: string | null;
      agent_id?: string | null;
      source?: string | null;
      created_at: number;
      updated_at: number;
    }

    const row = this.getOne<SessionRow>(
      `
      SELECT id, title, title_user_renamed, status, mode, pinned, pin_order, cwd, system_prompt, model_override, execution_mode, active_skill_ids, workspace_id, agent_id, source, created_at, updated_at
      FROM cowork_sessions
      WHERE id = ?
    `,
      [id],
    );

    if (!row) return null;

    const { totalMessages, messageOffset, messages } = readCoworkSessionMessages(
      this,
      id,
      messageLimit,
      () => this.getSessionMessages(id),
    );

    let activeSkillIds: string[] = [];
    if (row.active_skill_ids) {
      try {
        activeSkillIds = JSON.parse(row.active_skill_ids);
      } catch (e) {
        console.error('[CoworkStore] Failed to parse active_skill_ids for session', id, e);
        activeSkillIds = [];
      }
    }

    const expertRows = this.db
      .prepare(
        `SELECT expert_id, package_id, expert_name, source, prompt_snapshot,
              skill_ids, capability_policy, content_hash, created_at
       FROM cowork_session_experts
       WHERE session_id = ?
       ORDER BY created_at ASC, expert_id ASC`,
      )
      .all(id) as Array<{
      expert_id: string;
      package_id: string;
      expert_name: string;
      source: CoworkSessionExpertSnapshot['source'];
      prompt_snapshot: string;
      skill_ids: string;
      capability_policy: string;
      content_hash: string;
      created_at: number;
    }>;
    const experts = expertRows.map((expertRow): CoworkSessionExpertSnapshot => {
      let skillIds: string[] = [];
      let capabilityPolicy: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(expertRow.skill_ids);
        if (Array.isArray(parsed)) {
          skillIds = parsed.filter((value): value is string => typeof value === 'string');
        }
      } catch {
        // Keep malformed legacy snapshots empty.
      }
      try {
        const parsed = JSON.parse(expertRow.capability_policy);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          capabilityPolicy = parsed;
        }
      } catch {
        // Keep malformed legacy snapshots restrictive.
      }
      return {
        expertId: expertRow.expert_id,
        packageId: expertRow.package_id,
        expertName: expertRow.expert_name,
        source: expertRow.source,
        promptSnapshot: expertRow.prompt_snapshot,
        skillIds,
        capabilityPolicy,
        contentHash: expertRow.content_hash,
        createdAt: expertRow.created_at,
      };
    });

    const artifacts = readCoworkSessionArtifacts(
      this.artifactIndex,
      id,
      row.status as CoworkSessionStatus,
      options,
    );

    return {
      id: row.id,
      title: row.title,
      titleUserRenamed: Boolean(row.title_user_renamed),
      status: row.status as CoworkSessionStatus,
      mode: (row.mode as 'work' | 'chat') || 'work',
      pinned: Boolean(row.pinned),
      pinOrder: row.pin_order ?? null,
      cwd: row.cwd,
      systemPrompt: row.system_prompt,
      modelOverride: row.model_override || '',
      executionMode:
        row.execution_mode === CoworkExecutionMode.Auto
          ? CoworkExecutionMode.Auto
          : CoworkExecutionMode.Local,
      activeSkillIds,
      workspaceId: row.workspace_id || this.ensureWorkspace(row.cwd).id,
      agentId: row.agent_id || 'main',
      source: (row.source as CoworkSessionSource) || CoworkSessionSource.Manual,
      experts,
      messages,
      messagesOffset: messageOffset,
      totalMessages,
      artifacts,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  refreshSessionArtifacts(sessionId: string): CoworkPersistedArtifact[] {
    return this.artifactIndex.refreshSession(sessionId);
  }

  updateSession(
    id: string,
    updates: Partial<
      Pick<
        CoworkSession,
        | 'title'
        | 'status'
        | 'cwd'
        | 'systemPrompt'
        | 'modelOverride'
        | 'executionMode'
        | 'activeSkillIds'
      >
    >,
    options: { touchUpdatedAt?: boolean; userInitiatedTitleChange?: boolean } = {},
  ): void {
    const setClauses: string[] = [];
    const values: (string | number | null)[] = [];

    if (options.touchUpdatedAt ?? true) {
      setClauses.push('updated_at = ?');
      values.push(Date.now());
    }

    if (updates.title !== undefined) {
      setClauses.push('title = ?');
      values.push(updates.title);
      if (options.userInitiatedTitleChange) {
        setClauses.push('title_user_renamed = 1');
      }
    }
    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      values.push(updates.status);
    }
    if (updates.cwd !== undefined) {
      setClauses.push('cwd = ?');
      values.push(updates.cwd);
    }
    if (updates.systemPrompt !== undefined) {
      setClauses.push('system_prompt = ?');
      values.push(updates.systemPrompt);
    }
    if (updates.modelOverride !== undefined) {
      setClauses.push('model_override = ?');
      values.push(updates.modelOverride);
    }
    if (updates.executionMode !== undefined) {
      setClauses.push('execution_mode = ?');
      values.push(updates.executionMode);
    }
    if (updates.activeSkillIds !== undefined) {
      setClauses.push('active_skill_ids = ?');
      values.push(JSON.stringify(updates.activeSkillIds));
    }

    if (setClauses.length === 0) return;

    values.push(id);
    this.db
      .prepare(
        `
      UPDATE cowork_sessions
      SET ${setClauses.join(', ')}
      WHERE id = ?
    `,
      )
      .run(...values);
  }

  replaceSessionExperts(id: string, expertSnapshots: CoworkSessionExpertInput[]): void {
    const deleteExperts = this.db.prepare(
      'DELETE FROM cowork_session_experts WHERE session_id = ?',
    );
    const insertExpert = this.db.prepare(`
      INSERT INTO cowork_session_experts
        (session_id, expert_id, package_id, expert_name, source, prompt_snapshot, skill_ids, capability_policy, content_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = Date.now();
    const replace = this.db.transaction(() => {
      deleteExperts.run(id);
      for (const expert of expertSnapshots) {
        insertExpert.run(
          id,
          expert.expertId,
          expert.packageId,
          expert.expertName,
          expert.source,
          expert.promptSnapshot,
          JSON.stringify(expert.skillIds),
          JSON.stringify(expert.capabilityPolicy ?? {}),
          expert.contentHash,
          now,
        );
      }
    });
    replace();
  }

  deleteSession(id: string): void {
    this.db.prepare('DELETE FROM cowork_sessions WHERE id = ?').run(id);
  }

  deleteSessions(ids: string[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(`DELETE FROM cowork_sessions WHERE id IN (${placeholders})`).run(...ids);
  }

  deleteSessionsByAgentId(agentId: string): string[] {
    const rows = this.db
      .prepare('SELECT id FROM cowork_sessions WHERE agent_id = ?')
      .all(agentId) as { id: string }[];
    const ids = rows.map(r => r.id);
    if (ids.length > 0) {
      this.deleteSessions(ids);
    }
    return ids;
  }

  setSessionPinned(id: string, pinned: boolean): number | null {
    if (!pinned) {
      this.db
        .prepare('UPDATE cowork_sessions SET pinned = 0, pin_order = NULL WHERE id = ?')
        .run(id);
      return null;
    }

    const session = this.db
      .prepare('SELECT workspace_id FROM cowork_sessions WHERE id = ?')
      .get(id) as { workspace_id?: string | null } | undefined;
    if (!session) {
      return null;
    }

    const workspaceId = session.workspace_id || '';
    const maxRow = this.db
      .prepare(
        `
        SELECT MAX(pin_order) as max_pin_order
        FROM cowork_sessions
        WHERE pinned = 1 AND COALESCE(workspace_id, '') = ?
      `,
      )
      .get(workspaceId) as { max_pin_order?: number | null } | undefined;
    const pinOrder = (maxRow?.max_pin_order ?? 0) + 1;
    this.db
      .prepare('UPDATE cowork_sessions SET pinned = 1, pin_order = ? WHERE id = ?')
      .run(pinOrder, id);
    return pinOrder;
  }

  countSessions(
    agentId?: string,
    workspaceId?: string,
    mode?: CoworkSessionModeType,
    sources?: readonly CoworkSessionSource[],
  ): number {
    const filters: string[] = [];
    const params: string[] = [];
    if (workspaceId) {
      filters.push('workspace_id = ?');
      params.push(workspaceId);
    } else if (agentId) {
      filters.push('agent_id = ?');
      params.push(agentId);
    }
    if (mode) {
      filters.push('mode = ?');
      params.push(mode);
    }
    if (sources?.length) {
      filters.push(`source IN (${sources.map(() => '?').join(', ')})`);
      params.push(...sources);
    }

    const whereClause = filters.length > 0 ? ` WHERE ${filters.join(' AND ')}` : '';
    const row = this.db
      .prepare(`SELECT COUNT(*) as count FROM cowork_sessions${whereClause}`)
      .get(...params) as { count: number } | undefined;
    return row?.count || 0;
  }

  listSessions(
    limit = COWORK_SESSION_PAGE_SIZE,
    offset = 0,
    agentId?: string,
    workspaceId?: string,
    mode?: CoworkSessionModeType,
    sources?: readonly CoworkSessionSource[],
  ): CoworkSessionSummary[] {
    interface SessionSummaryRow {
      id: string;
      title: string;
      status: string;
      mode: string | null;
      pinned: number | null;
      pin_order: number | null;
      cwd: string;
      workspace_id: string | null;
      agent_id: string | null;
      source: string | null;
      created_at: number;
      updated_at: number;
    }

    const filters: string[] = [];
    const params: Array<string | number> = [];
    if (workspaceId) {
      filters.push('workspace_id = ?');
      params.push(workspaceId);
    } else if (agentId) {
      filters.push('agent_id = ?');
      params.push(agentId);
    }
    if (mode) {
      filters.push('mode = ?');
      params.push(mode);
    }
    if (sources?.length) {
      filters.push(`source IN (${sources.map(() => '?').join(', ')})`);
      params.push(...sources);
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = this.getAll<SessionSummaryRow>(
      `
        SELECT id, title, status, mode, pinned, pin_order, cwd, workspace_id, agent_id, source, created_at, updated_at
        FROM cowork_sessions
        ${whereClause}
        ORDER BY pinned DESC,
          CASE WHEN pinned = 1 THEN COALESCE(pin_order, updated_at, created_at) END ASC,
          CASE WHEN pinned = 0 THEN updated_at END DESC,
          updated_at DESC
        LIMIT ? OFFSET ?
      `,
      [...params, limit, offset],
    );

    return rows.map(row => ({
      id: row.id,
      title: row.title,
      status: row.status as CoworkSessionStatus,
      mode: (row.mode as CoworkSessionModeType) || CoworkSessionMode.Work,
      pinned: Boolean(row.pinned),
      pinOrder: row.pin_order ?? null,
      workspaceId: row.workspace_id || this.ensureWorkspace(row.cwd).id,
      agentId: row.agent_id || 'main',
      source: (row.source as CoworkSessionSource) || CoworkSessionSource.Manual,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  resetRunningSessions(): number {
    const now = Date.now();
    const result = this.db
      .prepare(
        `
      UPDATE cowork_sessions
      SET status = 'idle', updated_at = ?
      WHERE status = 'running'
    `,
      )
      .run(now);
    return result.changes;
  }

  listRecentCwds(limit: number = 8): string[] {
    interface CwdRow {
      cwd: string;
      updated_at: number;
    }

    const rows = this.getAll<CwdRow>(
      `
      SELECT cwd, updated_at
      FROM cowork_sessions
      WHERE cwd IS NOT NULL AND TRIM(cwd) != ''
      ORDER BY updated_at DESC
      LIMIT ?
    `,
      [Math.max(limit * 8, limit)],
    );

    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const normalized = normalizeWorkspacePath(row.cwd);
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      deduped.push(normalized);
      if (deduped.length >= limit) {
        break;
      }
    }

    return deduped;
  }
}
