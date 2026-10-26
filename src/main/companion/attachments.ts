import { randomUUID } from 'node:crypto';
import { mkdir, open, realpath, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { CompanionAttachmentIssue } from '../../shared/companion/constants';
import {
  COMPANION_MAX_ATTACHMENTS,
  COMPANION_MAX_ATTACHMENT_BYTES,
  COMPANION_MAX_ATTACHMENT_NAME_LENGTH,
  companionIncomingFile,
  type CompanionAttachment,
  type CompanionIncomingFile,
} from '../../shared/companion/attachments';
import {
  inferAttachmentExtension,
  sanitizeAttachmentFileName,
} from '../coworkIpc/fileExportHelpers';
import { prepareCompanionImagesAsync } from '../workbenchTask/artifactWorkerPool';

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

  /** Only the owned native dialog or internal staging supplies these paths. */
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

  /** Async binary write only: no base64 decoding, image parsing, scanning or hashing on main. */
  async stage(petId: string, input: CompanionIncomingFile, directory: string) {
    const file = companionIncomingFile.parse(input);
    const name = sanitizeAttachmentFileName(file.name);
    const inferred = inferAttachmentExtension(name, file.mimeType);
    const extension = /^\.[a-z0-9]{1,16}$/i.test(inferred) ? inferred : '';
    const displayName = path.extname(name)
      ? name
      : name.slice(0, COMPANION_MAX_ATTACHMENT_NAME_LENGTH - extension.length) + extension;
    await mkdir(directory, { recursive: true });
    const location = path.join(directory, randomUUID() + extension);
    const handle = await open(location, 'wx', 0o600);
    try {
      await handle.writeFile(file.data);
      await handle.close();
      const [selected] = await this.choose(petId, [location]);
      this.db
        .prepare('UPDATE companion_attachments SET name = ? WHERE id = ?')
        .run(displayName, selected.id);
      return { ...selected, name: displayName };
    } catch (error) {
      await handle.close().catch(() => {});
      await unlink(location).catch(() => {});
      throw error;
    }
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

  /** Reuse the same owner/expiry/path checks before any model image processing. */
  async images(petId: string, ids: readonly string[], signal?: AbortSignal) {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    const { fileAttachments } = await this.resolve(petId, unique);
    return prepareCompanionImagesAsync(
      fileAttachments.map((file, index) => ({
        id: unique[index],
        name: file.name,
        path: file.path,
      })),
      signal,
    );
  }
}
