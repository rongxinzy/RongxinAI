// Agent CRUD for the CoworkStore class chain.
// Split from src/main/coworkStore.ts (issue #1069).
import { v4 as uuidv4 } from 'uuid';

import { normalizeAgentAvatarIcon } from '../../shared/agent/avatar';
import { CoworkConversationSearchStore } from './conversationSearchStore';
import type { Agent, AgentSource, CreateAgentRequest, UpdateAgentRequest } from './types';

export class CoworkAgentStore extends CoworkConversationSearchStore {
  // ========== Agent CRUD ==========

  listAgents(): Agent[] {
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
      enabled: number;
      pinned?: number | null;
      pin_order?: number | null;
      is_default: number;
      source: string;
      preset_id: string;
      created_at: number;
      updated_at: number;
    }

    const rows = this.getAll<AgentRow>(`
      SELECT * FROM agents ORDER BY is_default DESC, created_at ASC
    `);

    return rows.map(row => this.mapAgentRow(row));
  }

  getAgent(id: string): Agent | null {
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
      enabled: number;
      pinned?: number | null;
      pin_order?: number | null;
      is_default: number;
      source: string;
      preset_id: string;
      created_at: number;
      updated_at: number;
    }

    const row = this.getOne<AgentRow>(`SELECT * FROM agents WHERE id = ?`, [id]);
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
      uuidv4();
    const now = Date.now();

    // Ensure no duplicate ID
    const existing = this.getAgent(id);
    if (existing) {
      // Append timestamp to make unique
      return this.createAgent({ ...request, id: `${id}-${Date.now()}` });
    }

    // 名称去重校验（大小写不敏感）
    const dupName = this.getOne<{ id: string }>(
      'SELECT id FROM agents WHERE LOWER(name) = LOWER(?) AND is_default = 0',
      [request.name.trim()],
    );
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
      INSERT INTO agents (id, name, description, system_prompt, identity, model, working_directory, icon, skill_ids, enabled, is_default, source, preset_id, triage_override, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?)
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
        request.source || 'custom',
        request.presetId || '',
        request.triageOverride ? JSON.stringify(request.triageOverride) : null,
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
    if (updates.triageOverride !== undefined) {
      setClauses.push('triage_override = ?');
      values.push(updates.triageOverride ? JSON.stringify(updates.triageOverride) : null);
    }

    values.push(id);
    this.db.prepare(`UPDATE agents SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
    return this.getAgent(id);
  }

  deleteAgent(id: string): boolean {
    if (id === 'main') return false; // Cannot delete default agent
    this.db.prepare('DELETE FROM agents WHERE id = ? AND is_default = 0').run(id);
    return true;
  }

  private mapAgentRow(row: {
    id: string;
    name: string;
    description: string;
    system_prompt: string;
    identity: string;
    model: string;
    working_directory?: string | null;
    icon: string;
    skill_ids: string;
    enabled: number;
    pinned?: number | null;
    pin_order?: number | null;
    is_default: number;
    source: string;
    preset_id: string;
    triage_override?: string | null;
    created_at: number;
    updated_at: number;
  }): Agent {
    let skillIds: string[] = [];
    try {
      skillIds = JSON.parse(row.skill_ids);
    } catch {
      skillIds = [];
    }
    let triageOverride = undefined;
    if (row.triage_override) {
      try {
        triageOverride = JSON.parse(row.triage_override);
      } catch {
        triageOverride = undefined;
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
      enabled: Boolean(row.enabled),
      pinned: Boolean(row.pinned),
      pinOrder: row.pinned ? (row.pin_order ?? null) : null,
      isDefault: Boolean(row.is_default),
      source: row.source as AgentSource,
      presetId: row.preset_id,
      triageOverride,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private getNextAgentPinOrder(): number {
    const row = this.getOne<{ max_order: number | null }>(
      'SELECT MAX(pin_order) as max_order FROM agents WHERE pinned = 1',
    );
    return (row?.max_order ?? 0) + 1;
  }
}
