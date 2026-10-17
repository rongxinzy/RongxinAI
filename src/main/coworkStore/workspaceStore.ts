// Workspace CRUD for the CoworkStore class chain.
// Split from src/main/coworkStore.ts (issue #1069).
import { v4 as uuidv4 } from 'uuid';

import type { Workspace } from '../../shared/workspace';
import {
  normalizeWorkspacePath,
  workspaceIdForPath,
  workspaceNameForPath,
} from '../workspaceUtils';
import { CoworkStoreBase } from './base';

export class CoworkWorkspaceStore extends CoworkStoreBase {
  listWorkspaces(): Workspace[] {
    const rows = this.getAll<{
      id: string;
      name: string;
      path: string;
      is_hidden: number;
      created_at: number;
      updated_at: number;
    }>(
      'SELECT id, name, path, is_hidden, created_at, updated_at FROM workspaces ORDER BY updated_at DESC, name ASC',
    );
    const foldersByWorkspace = this.workspaceFolders.listAllByWorkspace();
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      path: row.path,
      folders: foldersByWorkspace.get(row.id) ?? [],
      isHidden: Boolean(row.is_hidden),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  getWorkspace(id: string): Workspace | null {
    const row = this.getOne<{
      id: string;
      name: string;
      path: string;
      is_hidden: number;
      created_at: number;
      updated_at: number;
    }>('SELECT id, name, path, is_hidden, created_at, updated_at FROM workspaces WHERE id = ?', [
      id,
    ]);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      folders: this.workspaceFolders.listFolders(row.id),
      isHidden: Boolean(row.is_hidden),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  ensureWorkspace(workspacePath: string, name?: string, isHidden = false): Workspace {
    const normalizedPath = normalizeWorkspacePath(workspacePath);
    if (!normalizedPath) throw new Error('Workspace path is required');

    const id = workspaceIdForPath(normalizedPath);
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO workspaces (id, name, path, is_hidden, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET is_hidden = MAX(workspaces.is_hidden, excluded.is_hidden)`,
      )
      .run(
        id,
        name?.trim() || workspaceNameForPath(normalizedPath),
        normalizedPath,
        isHidden ? 1 : 0,
        now,
        now,
      );
    return this.getWorkspace(id)!;
  }

  createWorkspace(workspacePath: string, name: string): Workspace {
    const normalizedPath = normalizeWorkspacePath(workspacePath);
    const normalizedName = name.trim();
    if (!normalizedPath) throw new Error('Workspace path is required');
    if (!normalizedName) throw new Error('Workspace name is required');

    const id = `workspace-${uuidv4()}`;
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO workspaces (id, name, path, is_hidden, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?)`,
      )
      .run(id, normalizedName, normalizedPath, now, now);
    return this.getWorkspace(id)!;
  }

  renameWorkspace(id: string, name: string): Workspace | null {
    const normalizedName = name.trim();
    if (!normalizedName) throw new Error('Workspace name is required');

    const result = this.db
      .prepare('UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?')
      .run(normalizedName, Date.now(), id);
    return result.changes > 0 ? this.getWorkspace(id) : null;
  }

  touchWorkspace(id: string): void {
    this.db
      .prepare(
        `UPDATE workspaces
         SET updated_at = MAX(?, (
           SELECT COALESCE(MAX(updated_at), 0) + 1 FROM workspaces WHERE id <> ?
         ))
         WHERE id = ?`,
      )
      .run(Date.now(), id, id);
  }

  setWorkspaceHidden(id: string, isHidden: boolean): void {
    this.db.prepare('UPDATE workspaces SET is_hidden = ? WHERE id = ?').run(isHidden ? 1 : 0, id);
  }

  setWorkspaceFolders(id: string, folders: string[]): void {
    this.workspaceFolders.replaceFolders(id, folders);
  }

  relocateWorkspace(id: string, workspacePath: string, name: string): Workspace | null {
    const existingWorkspace = this.getWorkspace(id);
    if (!existingWorkspace) return null;

    const normalizedPath = normalizeWorkspacePath(workspacePath);
    const normalizedName = name.trim();
    if (!normalizedPath || !normalizedName) throw new Error('Workspace path and name are required');

    const nextId = workspaceIdForPath(normalizedPath);
    if (nextId !== id && this.getWorkspace(nextId)) {
      throw new Error('A workspace already exists for the renamed directory');
    }

    const runningSession = this.getOne<{ id: string }>(
      "SELECT id FROM cowork_sessions WHERE workspace_id = ? AND status = 'running' LIMIT 1",
      [id],
    );
    if (runningSession) {
      throw new Error('Cannot relocate a workspace while a session is running');
    }

    // Project memory scope ids are derived from the path
    // (workspace-<sha256(cwd)>), so a relocation must carry both tables
    // alongside the workspace and sessions rows.
    const previousProjectId = workspaceIdForPath(existingWorkspace.path);
    const hasMemoryLinks = this.tableExists('memory_links');
    const hasMemoryCandidates = this.tableExists('memory_candidates');

    this.db.transaction(() => {
      this.db
        .prepare('UPDATE cowork_sessions SET workspace_id = ?, cwd = ? WHERE workspace_id = ?')
        .run(nextId, normalizedPath, id);
      this.db
        .prepare('UPDATE workspaces SET id = ?, name = ?, path = ? WHERE id = ?')
        .run(nextId, normalizedName, normalizedPath, id);
      this.workspaceFolders.transferFolders(id, nextId);
      if (hasMemoryLinks) {
        this.db
          .prepare('UPDATE memory_links SET project_id = ? WHERE project_id = ?')
          .run(nextId, previousProjectId);
      }
      if (hasMemoryCandidates) {
        this.db
          .prepare('UPDATE memory_candidates SET project_id = ? WHERE project_id = ?')
          .run(nextId, previousProjectId);
      }
    })();

    return this.getWorkspace(nextId);
  }

  /**
   * Removes a workspace row and every session that belongs to it. Files on
   * disk are never touched. Returns the ids of the deleted sessions so the
   * renderer can drop them from its in-memory state.
   */
  deleteWorkspace(id: string): string[] {
    const rows = this.db
      .prepare('SELECT id FROM cowork_sessions WHERE workspace_id = ?')
      .all(id) as { id: string }[];
    const sessionIds = rows.map(row => row.id);
    if (sessionIds.length > 0) {
      const placeholders = sessionIds.map(() => '?').join(',');
      this.db
        .prepare(`DELETE FROM cowork_sessions WHERE id IN (${placeholders})`)
        .run(...sessionIds);
    }
    this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
    this.workspaceFolders.deleteFolders(id);
    return sessionIds;
  }
}
