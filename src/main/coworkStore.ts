/** Public Cowork persistence API. Its repositories share one SQLite connection. */
import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { CoworkError } from '../common/coworkError';

import type { CoworkPersistedArtifact } from '../shared/cowork/artifacts';
import {
  COWORK_MESSAGE_PAGE_SIZE,
  COWORK_SESSION_PAGE_SIZE,
  CoworkExecutionMode,
  CoworkMessageType,
  CoworkSessionMode,
  CoworkSessionSource,
  CoworkSessionStatus,
  type CoworkExecutionMode as CoworkExecutionModeType,
  type CoworkSessionMode as CoworkSessionModeType,
} from '../shared/cowork/constants';
import type {
  CoworkSessionExpertInput,
  CoworkSessionExpertSnapshot,
} from '../shared/cowork/sessionExperts';
import { ArtifactLedger } from './artifactLedger/artifactLedger';
import { readCoworkSessionArtifacts, type CoworkSessionReadOptions } from './coworkSessionRead';
import { CoworkAgentStore } from './coworkStore/agentStore';
import { CoworkConfigStore } from './coworkStore/configStore';
import { CoworkConversationSearchStore } from './coworkStore/conversationSearchStore';
import { CoworkMessageStore } from './coworkStore/messageStore';
import type {
  CoworkConfigUpdate,
  CoworkMessage,
  CoworkSession,
  CoworkSessionSummary,
  CreateAgentRequest,
  UpdateAgentRequest,
} from './coworkStore/types';
import { CoworkWorkspaceStore } from './coworkStore/workspaceStore';
import {
  ensureDefaultConversationWorkspacePath,
  isDefaultConversationWorkspacePath,
} from './defaultConversationWorkspace';
import { normalizeWorkspacePath } from './workspaceUtils';

export type {
  Agent,
  CreateAgentRequest,
  UpdateAgentRequest,
  CoworkConfig,
  CoworkConfigUpdate,
  CoworkConversationSearchRecord,
  CoworkMessage,
  CoworkMessageMetadata,
  CoworkSession,
  CoworkSessionSummary,
} from './coworkStore/types';
export { CoworkExecutionMode };

export type CoworkSessionDeletionSelection =
  | { ids: readonly string[] }
  | { agentId: string }
  | { workspaceId: string };

type PersistedSessionStatus = Exclude<CoworkSessionStatus, typeof CoworkSessionStatus.Running>;

// Live status is projected from Pi. Old rows can still contain its former persisted copy.
function readPersistedSessionStatus(status: string): PersistedSessionStatus {
  return status === CoworkSessionStatus.Running
    ? CoworkSessionStatus.Idle
    : (status as PersistedSessionStatus);
}

function readSessionSkillIds(id: string, value?: string | null): string[] {
  if (value) {
    try {
      const skills: unknown = JSON.parse(value);
      if (Array.isArray(skills)) return skills;
    } catch (error) {
      console.error('[CoworkStore] Failed to parse active_skill_ids for session', id, error);
    }
  }
  return [];
}

export class CoworkStore {
  readonly messages: CoworkMessageStore;
  readonly workspaces: CoworkWorkspaceStore;
  private readonly artifactLedger: ArtifactLedger;
  private readonly agents: CoworkAgentStore;
  private readonly config: CoworkConfigStore;
  private readonly search: CoworkConversationSearchStore;

  constructor(
    private readonly db: Database.Database,
    artifactLedger?: ArtifactLedger,
  ) {
    this.messages = new CoworkMessageStore(db);
    this.workspaces = new CoworkWorkspaceStore(db);
    this.artifactLedger = artifactLedger ?? new ArtifactLedger(db);
    this.agents = new CoworkAgentStore(db);
    this.config = new CoworkConfigStore(db);
    this.search = new CoworkConversationSearchStore(db);
  }

  /** Commit the outcome and transcript together before publishing the message. */
  recordTerminalError(
    sessionId: string,
    error: CoworkError,
    publish: (message: CoworkMessage) => void,
  ): boolean {
    const outcome = this.db.transaction(() => {
      const session = this.db
        .prepare<[string], { status: string }>('SELECT status FROM cowork_sessions WHERE id = ?')
        .get(sessionId);
      if (!session) return null;

      // Only inspect a terminal system message; never materialize tool results or history.
      const latest = this.db
        .prepare<[string, string, string], { error: unknown; errorKind: unknown }>(`
        SELECT
          CASE WHEN type = ? THEN
            CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.error') END
          END AS error,
          CASE WHEN type = ? THEN
            CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.errorKind') END
          END AS errorKind
        FROM (
          SELECT type, metadata FROM cowork_messages
          WHERE session_id = ?
          ORDER BY COALESCE(sequence, created_at) DESC, created_at DESC, ROWID DESC
          LIMIT 1
        )
      `)
        .get(CoworkMessageType.System, CoworkMessageType.System, sessionId);

      const changedStatus = session.status !== CoworkSessionStatus.Error;
      if (!error.message || (latest?.error === error.message && latest.errorKind === error.kind)) {
        if (changedStatus) this.updateSession(sessionId, { status: CoworkSessionStatus.Error });
        return { recorded: changedStatus, message: null };
      }
      return {
        recorded: true,
        message: this.messages.addMessage(
          sessionId,
          {
            type: CoworkMessageType.System,
            content: '',
            metadata: { error: error.message, errorKind: error.kind },
          },
          undefined,
          changedStatus ? CoworkSessionStatus.Error : undefined,
        ),
      };
    })();

    // Commit before IPC so switching sessions immediately sees the canonical message.
    if (outcome?.message) publish(outcome.message);
    return outcome?.recorded === true;
  }

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
    initialUserMessage?: Pick<CoworkMessage, 'content' | 'metadata'>,
  ): CoworkSession {
    const sessionId = id || randomUUID();
    const now = Date.now();
    const resolvedCwd = isDefaultConversationWorkspacePath(cwd)
      ? ensureDefaultConversationWorkspacePath()
      : cwd;
    const workspace = workspaceId
      ? this.workspaces.getWorkspace(workspaceId)
      : this.workspaces.ensureWorkspace(resolvedCwd);
    if (!workspace) throw new Error('Workspace not found');

    const insertSession = this.db.prepare(`
      INSERT INTO cowork_sessions (id, title, title_user_renamed, status, mode, cwd, system_prompt, model_override, execution_mode, active_skill_ids, workspace_id, agent_id, pinned, source, pi_history_key, created_at, updated_at)
      VALUES (?, ?, 0, 'idle', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
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
        randomUUID(),
        now,
        now,
      );
      this.insertSessionExperts(sessionId, expertSnapshots, now);
      if (!initialUserMessage) return null;
      const message = this.messages.addMessage(
        sessionId,
        {
          ...initialUserMessage,
          type: CoworkMessageType.User,
        },
        now,
      );
      this.workspaces.touchWorkspace(workspace.id);
      return message;
    });
    const message = create();

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
      messages: message ? [message] : [],
      messagesOffset: 0,
      totalMessages: message ? 1 : 0,
      artifacts: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  hasSession(id: string): boolean {
    return this.db.prepare('SELECT 1 FROM cowork_sessions WHERE id = ?').get(id) !== undefined;
  }

  /** Null identifies a legacy row. Undefined means that the session does not exist. */
  getPiHistoryKey(id: string): string | null | undefined {
    return this.db
      .prepare<[string], { pi_history_key: string | null }>(
        'SELECT pi_history_key FROM cowork_sessions WHERE id = ?',
      )
      .get(id)?.pi_history_key;
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

    const row = this.db
      .prepare<[string], SessionRow>(`
      SELECT id, title, title_user_renamed, status, mode, pinned, pin_order, cwd, system_prompt, model_override, execution_mode, active_skill_ids, workspace_id, agent_id, source, created_at, updated_at
      FROM cowork_sessions
      WHERE id = ?
    `)
      .get(id);

    if (!row) return null;

    const { totalMessages, messageOffset, messages } = this.messages.readSessionMessages(
      id,
      messageLimit,
    );

    const activeSkillIds = readSessionSkillIds(id, row.active_skill_ids);

    const artifacts = readCoworkSessionArtifacts(this.artifactLedger, id, options);

    return {
      id: row.id,
      title: row.title,
      titleUserRenamed: Boolean(row.title_user_renamed),
      status: readPersistedSessionStatus(row.status),
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
      workspaceId: row.workspace_id || this.workspaces.ensureWorkspace(row.cwd).id,
      agentId: row.agent_id || 'main',
      source: (row.source as CoworkSessionSource) || CoworkSessionSource.Manual,
      experts: this.getSessionExperts(id),
      messages,
      messagesOffset: messageOffset,
      totalMessages,
      artifacts,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  getSessionExperts(id: string): CoworkSessionExpertSnapshot[] {
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
    return expertRows.map(expertRow => {
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
  }

  listSessionArtifacts(sessionId: string): CoworkPersistedArtifact[] {
    return this.artifactLedger.list(sessionId);
  }

  appendSessionSkills(id: string, skillIds: readonly string[]): string[] {
    const session = this.db
      .prepare<[string], { active_skill_ids: string | null }>(
        'SELECT active_skill_ids FROM cowork_sessions WHERE id = ?',
      )
      .get(id);
    if (!session) return [];
    const current = readSessionSkillIds(id, session.active_skill_ids);
    const merged = [...new Set([...current, ...skillIds])];
    if (
      merged.length !== current.length ||
      merged.some((skill, index) => skill !== current[index])
    ) {
      this.db
        .prepare('UPDATE cowork_sessions SET active_skill_ids = ? WHERE id = ?')
        .run(JSON.stringify(merged), id);
    }
    return merged;
  }

  updateSession(
    id: string,
    updates: Partial<
      Pick<CoworkSession, 'title' | 'cwd' | 'systemPrompt' | 'modelOverride' | 'executionMode'> & {
        status: PersistedSessionStatus;
      }
    >,
    options: { touchUpdatedAt?: boolean; userInitiatedTitleChange?: boolean } = {},
  ): void {
    const setClauses: string[] = [];
    const values: (string | number | null)[] = [];

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
    const statusOnly = setClauses.length === 1 ? updates.status : undefined;
    if (options.touchUpdatedAt ?? true) {
      setClauses.push('updated_at = ?');
      values.push(Date.now());
    }

    if (setClauses.length === 0) return;

    values.push(id);
    if (statusOnly !== undefined) values.push(statusOnly);
    this.db
      .prepare(
        `
      UPDATE cowork_sessions
      SET ${setClauses.join(', ')}
      WHERE id = ?${statusOnly !== undefined ? ' AND status IS NOT ?' : ''}
    `,
      )
      .run(...values);
  }

  updateSessionPrompt(
    id: string,
    updates: { expertSnapshots?: CoworkSessionExpertInput[]; systemPrompt?: string },
  ): void {
    this.db.transaction(() => {
      if (updates.expertSnapshots) {
        this.db.prepare('DELETE FROM cowork_session_experts WHERE session_id = ?').run(id);
        this.insertSessionExperts(id, updates.expertSnapshots, Date.now());
      }
      if (updates.systemPrompt !== undefined) {
        this.updateSession(id, { systemPrompt: updates.systemPrompt });
      }
    })();
  }

  private insertSessionExperts(
    id: string,
    expertSnapshots: CoworkSessionExpertInput[],
    now: number,
  ): void {
    if (!expertSnapshots.length) return;
    const insertExpert = this.db.prepare(`
      INSERT INTO cowork_session_experts
        (session_id, expert_id, package_id, expert_name, source, prompt_snapshot, skill_ids, capability_policy, content_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
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
  }

  getSessionFinalizationSnapshots(selection: CoworkSessionDeletionSelection): Array<{
    id: string;
    title: string;
    cwd: string;
    lastAssistantContent: string | null;
    piHistoryKey: string | null;
  }> {
    const [condition, value] =
      'ids' in selection
        ? ['s.id IN (SELECT value FROM json_each(?))', JSON.stringify(selection.ids)]
        : 'agentId' in selection
          ? ['s.agent_id = ?', selection.agentId]
          : ['s.workspace_id = ?', selection.workspaceId];
    return this.db
      .prepare<
        [string],
        {
          id: string;
          title: string;
          cwd: string;
          lastAssistantContent: string | null;
          piHistoryKey: string | null;
        }
      >(`SELECT s.id, s.title, s.cwd, s.pi_history_key AS piHistoryKey,
        (SELECT substr(m.content, 1, 1500) FROM cowork_messages m
         WHERE m.session_id = s.id AND m.type = 'assistant'
         ORDER BY COALESCE(m.sequence, m.created_at) DESC, m.created_at DESC, m.rowid DESC
         LIMIT 1) AS lastAssistantContent
       FROM cowork_sessions s WHERE ${condition}`)
      .all(value);
  }

  deleteSessions(ids: readonly string[]): number {
    if (ids.length === 0) return 0;
    return this.db
      .prepare('DELETE FROM cowork_sessions WHERE id IN (SELECT value FROM json_each(?))')
      .run(JSON.stringify(ids)).changes;
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

  listSessions(
    limit = COWORK_SESSION_PAGE_SIZE,
    offset = 0,
    agentId?: string,
    workspaceId?: string,
    mode?: CoworkSessionModeType,
    sources?: readonly CoworkSessionSource[],
  ): { sessions: CoworkSessionSummary[]; hasMore: boolean } {
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
    const rows = this.db
      .prepare<Array<string | number>, SessionSummaryRow>(`
        SELECT id, title, status, mode, pinned, pin_order, cwd, workspace_id, agent_id, source, created_at, updated_at
        FROM cowork_sessions
        ${whereClause}
        ORDER BY pinned DESC,
          CASE WHEN pinned = 1 THEN COALESCE(pin_order, updated_at, created_at) END ASC,
          CASE WHEN pinned = 0 THEN updated_at END DESC,
          updated_at DESC
        LIMIT ? OFFSET ?
      `)
      .all(...params, limit < 0 ? limit : limit + 1, offset);

    const hasMore = limit >= 0 && rows.length > limit;
    if (hasMore) rows.pop();
    const sessions = rows.map(row => ({
      id: row.id,
      title: row.title,
      status: readPersistedSessionStatus(row.status),
      mode: (row.mode as CoworkSessionModeType) || CoworkSessionMode.Work,
      pinned: Boolean(row.pinned),
      pinOrder: row.pin_order ?? null,
      workspaceId: row.workspace_id || this.workspaces.ensureWorkspace(row.cwd).id,
      agentId: row.agent_id || 'main',
      source: (row.source as CoworkSessionSource) || CoworkSessionSource.Manual,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    return { sessions, hasMore };
  }

  listRecentCwds(limit: number = 8): string[] {
    interface CwdRow {
      cwd: string;
      updated_at: number;
    }

    const rows = this.db
      .prepare<[number], CwdRow>(`
      SELECT cwd, updated_at
      FROM cowork_sessions
      WHERE cwd IS NOT NULL AND TRIM(cwd) != ''
      ORDER BY updated_at DESC
      LIMIT ?
    `)
      .all(Math.max(limit * 8, limit));

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

  listAgents() {
    return this.agents.listAgents();
  }

  getAgent(id: string) {
    return this.agents.getAgent(id);
  }

  createAgent(request: CreateAgentRequest) {
    return this.agents.createAgent(request);
  }

  updateAgent(id: string, updates: UpdateAgentRequest) {
    return this.agents.updateAgent(id, updates);
  }

  deleteAgent(id: string) {
    return this.agents.deleteAgent(id);
  }

  backfillEmptyAgentModels(modelId: string) {
    return this.agents.backfillEmptyAgentModels(modelId);
  }

  getConfig() {
    return this.config.getConfig();
  }

  setConfig(config: CoworkConfigUpdate): void {
    this.config.setConfig(config);
  }

  getAppLanguage(): 'zh' | 'en' {
    return this.config.getAppLanguage();
  }

  conversationSearch(options: Parameters<CoworkConversationSearchStore['conversationSearch']>[0]) {
    return this.search.conversationSearch(options);
  }

  recentChats(options: Parameters<CoworkConversationSearchStore['recentChats']>[0]) {
    return this.search.recentChats(options);
  }
}
