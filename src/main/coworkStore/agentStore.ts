import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

import { normalizeAgentAvatarIcon } from '../../shared/agent/avatar';
import { AgentId } from '../../shared/agent/constants';
import type { Agent, AgentSource, CreateAgentRequest, UpdateAgentRequest } from './types';

interface AgentRow {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  identity: string;
  model: string;
  working_directory?: string | null;
  icon: string;
  skill_ids: string;
  mcp_ids?: string;
  enabled: number;
  pinned?: number | null;
  pin_order?: number | null;
  is_default: number;
  source: string;
  preset_id: string;
  // The expert registration script still uses triage_override.
  created_at: number;
  updated_at: number;
}

export class CoworkAgentStore {
  constructor(private readonly db: Database.Database) {}

  listAgents(): Agent[] {
    const rows = this.db
      .prepare<[], AgentRow>('SELECT * FROM agents ORDER BY is_default DESC, created_at ASC')
      .all();
    return rows.map(row => this.mapAgentRow(row));
  }

  getAgent(id: string): Agent | null {
    const row = this.db.prepare<[string], AgentRow>('SELECT * FROM agents WHERE id = ?').get(id);
    if (!row) return null;
    return this.mapAgentRow(row);
  }

  createAgent(request: CreateAgentRequest): Agent {
    const id =
      request.id ||
      request.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') ||
      randomUUID();
    const now = Date.now();

    // Ensure no duplicate ID
    const existing = this.getAgent(id);
    if (existing) {
      // Append timestamp to make unique
      return this.createAgent({ ...request, id: `${id}-${Date.now()}` });
    }

    // 名称去重校验（大小写不敏感）
    const dupName = this.db
      .prepare<[string], { id: string }>(
        'SELECT id FROM agents WHERE LOWER(name) = LOWER(?) AND is_default = 0',
      )
      .get(request.name.trim());
    if (dupName) {
      throw new Error('Agent name already exists');
    }

    // 保留名校验
    const reservedNames = ['主 Agent', 'Primary Agent'];
    if (reservedNames.includes(request.name.trim())) {
      throw new Error('Cannot use reserved agent name');
    }

    this.db
      .prepare(
        `
      INSERT INTO agents (id, name, description, system_prompt, identity, model, working_directory, icon, skill_ids, mcp_ids, enabled, is_default, source, preset_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?)
    `,
      )
      .run(
        id,
        request.name,
        request.description || '',
        request.systemPrompt || '',
        request.identity || '',
        request.model || '',
        request.workingDirectory || '',
        normalizeAgentAvatarIcon(request.icon),
        JSON.stringify(request.skillIds || []),
        JSON.stringify(request.mcpIds || []),
        request.source || 'custom',
        request.presetId || '',
        now,
        now,
      );

    return this.getAgent(id)!;
  }

  backfillEmptyAgentModels(modelId: string): number {
    const normalizedModelId = modelId.trim();
    if (!normalizedModelId) return 0;

    const result = this.db
      .prepare("UPDATE agents SET model = ?, updated_at = ? WHERE TRIM(COALESCE(model, '')) = ''")
      .run(normalizedModelId, Date.now());

    return result.changes;
  }

  updateAgent(id: string, updates: UpdateAgentRequest): Agent | null {
    const existing = this.getAgent(id);
    if (!existing) return null;

    const now = Date.now();
    const setClauses: string[] = ['updated_at = ?'];
    const values: (string | number | null)[] = [now];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      setClauses.push('description = ?');
      values.push(updates.description);
    }
    if (updates.systemPrompt !== undefined) {
      setClauses.push('system_prompt = ?');
      values.push(updates.systemPrompt);
    }
    if (updates.identity !== undefined) {
      setClauses.push('identity = ?');
      values.push(updates.identity);
    }
    if (updates.model !== undefined) {
      setClauses.push('model = ?');
      values.push(updates.model);
    }
    if (updates.workingDirectory !== undefined) {
      setClauses.push('working_directory = ?');
      values.push(updates.workingDirectory);
    }
    if (updates.icon !== undefined) {
      setClauses.push('icon = ?');
      values.push(normalizeAgentAvatarIcon(updates.icon));
    }
    if (updates.skillIds !== undefined) {
      setClauses.push('skill_ids = ?');
      values.push(JSON.stringify(updates.skillIds));
    }
    if (updates.mcpIds !== undefined) {
      setClauses.push('mcp_ids = ?');
      values.push(JSON.stringify(updates.mcpIds));
    }
    if (updates.enabled !== undefined) {
      setClauses.push('enabled = ?');
      values.push(updates.enabled ? 1 : 0);
    }
    if (updates.pinned !== undefined) {
      setClauses.push('pinned = ?');
      values.push(updates.pinned ? 1 : 0);
      if (updates.pinned) {
        const currentPinOrder = existing.pinOrder ?? null;
        const nextPinOrder = currentPinOrder ?? this.getNextAgentPinOrder();
        setClauses.push('pin_order = ?');
        values.push(nextPinOrder);
      } else {
        setClauses.push('pin_order = NULL');
      }
    }

    values.push(id);
    this.db.prepare(`UPDATE agents SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
    return this.getAgent(id);
  }

  deleteAgent(id: string): boolean {
    if (id === AgentId.Main) return false;
    const { changes } = this.db
      .prepare('DELETE FROM agents WHERE id = ? AND is_default = 0')
      .run(id);
    return changes > 0;
  }

  private mapAgentRow(row: AgentRow): Agent {
    let skillIds: string[] = [];
    try {
      skillIds = JSON.parse(row.skill_ids);
    } catch {
      skillIds = [];
    }
    let mcpIds: string[] = [];
    if (row.mcp_ids) {
      try {
        mcpIds = JSON.parse(row.mcp_ids);
      } catch {
        mcpIds = [];
      }
    }
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      systemPrompt: row.system_prompt,
      identity: row.identity,
      model: row.model,
      workingDirectory: row.working_directory || '',
      icon: row.icon,
      skillIds,
      mcpIds,
      enabled: Boolean(row.enabled),
      pinned: Boolean(row.pinned),
      pinOrder: row.pinned ? (row.pin_order ?? null) : null,
      isDefault: Boolean(row.is_default),
      source: row.source as AgentSource,
      presetId: row.preset_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private getNextAgentPinOrder(): number {
    const row = this.db
      .prepare<[], { max_order: number | null }>(
        'SELECT MAX(pin_order) as max_order FROM agents WHERE pinned = 1',
      )
      .get();
    return (row?.max_order ?? 0) + 1;
  }
}
