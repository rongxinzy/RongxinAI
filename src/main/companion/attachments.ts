import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { CompanionAttachmentIssue } from '../../shared/companion/constants';
import {
  COMPANION_MAX_ATTACHMENTS,
  COMPANION_MAX_ATTACHMENT_BYTES,
  type CompanionAttachment,
} from '../../shared/companion/attachments';

const LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};
interface Row {
  id: string;
  name: string;
  path: string;
  bytes: number;
}

/** Native selections authorize references, not a general renderer filesystem API. */
export class CompanionAttachments {
  constructor(private readonly db: Database.Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS companion_attachments (
      id TEXT PRIMARY KEY, pet_id TEXT NOT NULL, path TEXT NOT NULL,
      name TEXT NOT NULL, bytes INTEGER NOT NULL, expires_at INTEGER NOT NULL
    ); CREATE INDEX IF NOT EXISTS companion_attachments_expiry
      ON companion_attachments(expires_at);`);
  }

  private async inspect(file: string) {
    const canonical = await realpath(file);
    const info = await stat(canonical);
    if (!info.isFile()) throw new Error(CompanionAttachmentIssue.Invalid);
    if (info.size > COMPANION_MAX_ATTACHMENT_BYTES)
      throw new Error(CompanionAttachmentIssue.TooLarge);
    return { path: canonical, name: path.basename(canonical), bytes: info.size };
  }

  /** Called only with paths supplied by the owned native file dialog. No file bytes are read. */
  async choose(petId: string, paths: readonly string[]): Promise<CompanionAttachment[]> {
    if (paths.length > COMPANION_MAX_ATTACHMENTS) throw new Error(CompanionAttachmentIssue.TooMany);
    const selected: Row[] = [];
    for (const file of paths) {
      const item = await this.inspect(file);
      if (!selected.some(previous => previous.path === item.path))
        selected.push({ id: randomUUID(), ...item });
    }
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM companion_attachments WHERE expires_at < ?').run(Date.now());
      const insert = this.db.prepare(`INSERT INTO companion_attachments
        (id, pet_id, path, name, bytes, expires_at) VALUES (?, ?, ?, ?, ?, ?)`);
      for (const item of selected)
        insert.run(item.id, petId, item.path, item.name, item.bytes, Date.now() + LIFETIME_MS);
    })();
    return selected.map(({ id, name, bytes }) => ({ id, name, bytes }));
  }

  async resolve(petId: string, ids: readonly string[] = []) {
    const fileAttachments = [];
    for (const id of new Set(ids)) {
      const row = this.db
        .prepare(`SELECT id, name, path, bytes FROM companion_attachments
        WHERE id = ? AND pet_id = ? AND expires_at >= ?`)
        .get(id, petId, Date.now()) as Row | undefined;
      if (!row) throw new Error(CompanionAttachmentIssue.Unavailable);
      try {
        const current = await this.inspect(row.path);
        if (current.path !== row.path) throw new Error('Attachment selection changed');
      } catch (cause) {
        throw new Error(CompanionAttachmentIssue.Unavailable, { cause });
      }
      const extension = path.extname(row.name).toLowerCase();
      const mimeType = IMAGE_MIME[extension];
      fileAttachments.push({
        name: row.name,
        path: row.path,
        extension: extension.slice(1).toUpperCase(),
        ...(mimeType ? { isImage: true } : {}),
      });
    }
    return { fileAttachments };
  }
}
