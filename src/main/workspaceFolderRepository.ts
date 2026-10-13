import type Database from 'better-sqlite3';

interface WorkspaceFolderRow {
  workspace_id: string;
  path: string;
  position: number;
}

/**
 * Attached extra folders for a workspace. The primary path lives on the
 * `workspaces` row itself (it is the session working directory); this table
 * only stores the additional folders shown in the edit-project dialog.
 */
export class WorkspaceFolderRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  listFolders(workspaceId: string): string[] {
    const rows = this.db
      .prepare(
        'SELECT path FROM workspace_folders WHERE workspace_id = ? ORDER BY position ASC, path ASC',
      )
      .all(workspaceId) as { path: string }[];
    return rows.map(row => row.path);
  }

  /** One query for bulk reads (listWorkspaces). */
  listAllByWorkspace(): Map<string, string[]> {
    const rows = this.db
      .prepare(
        'SELECT workspace_id, path, position FROM workspace_folders ORDER BY workspace_id, position ASC, path ASC',
      )
      .all() as WorkspaceFolderRow[];
    const byWorkspace = new Map<string, string[]>();
    for (const row of rows) {
      const list = byWorkspace.get(row.workspace_id) ?? [];
      list.push(row.path);
      byWorkspace.set(row.workspace_id, list);
    }
    return byWorkspace;
  }

  /** Replaces the full folder list for a workspace with a normalized copy. */
  replaceFolders(workspaceId: string, folders: string[]): void {
    const normalized = normalizeFolderList(folders);
    const deleteAll = this.db.prepare('DELETE FROM workspace_folders WHERE workspace_id = ?');
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO workspace_folders (workspace_id, path, position) VALUES (?, ?, ?)',
    );
    this.db.transaction(() => {
      deleteAll.run(workspaceId);
      normalized.forEach((folder, index) => insert.run(workspaceId, folder, index));
    })();
  }

  /** Moves attached folders to a replacement workspace id (relocate). */
  transferFolders(fromWorkspaceId: string, toWorkspaceId: string): void {
    if (fromWorkspaceId === toWorkspaceId) return;
    this.db
      .prepare('UPDATE workspace_folders SET workspace_id = ? WHERE workspace_id = ?')
      .run(toWorkspaceId, fromWorkspaceId);
  }

  deleteFolders(workspaceId: string): void {
    this.db.prepare('DELETE FROM workspace_folders WHERE workspace_id = ?').run(workspaceId);
  }
}

function normalizeFolderList(folders: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const folder of folders) {
    const trimmed = folder.trim();
    if (!trimmed) continue;
    const key = process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(trimmed);
  }
  return normalized;
}
