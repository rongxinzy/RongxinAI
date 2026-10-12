import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { SkillManifestItem } from '@aep/sdk-node';
import yauzl from 'yauzl';

import type { AgentControlState } from './state.js';
import {
  type AgentControlClient,
  type ManagedSkill,
  type SkillReconcileResult,
  SkillSyncStatus,
} from './types.js';

const SKILL_ETAG_KEY = 'skill_etag';
const SKILL_REVISION_KEY = 'skill_revision';
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 256 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 4_096;

export class ManagedSkillReconciler {
  readonly #skillRoot: string;
  readonly #onSkillsChanged: (() => void) | undefined;

  constructor(
    readonly client: AgentControlClient,
    readonly state: AgentControlState,
    skillRoot: string,
    onSkillsChanged?: () => void,
  ) {
    this.#skillRoot = path.resolve(skillRoot);
    this.#onSkillsChanged = onSkillsChanged;
  }

  async reconcile(): Promise<SkillReconcileResult> {
    const etag = this.state.getValue(SKILL_ETAG_KEY) ?? undefined;
    const result = await this.client.getSkillManifest(etag);
    if (result.notModified) {
      return {
        revision: this.state.getValue(SKILL_REVISION_KEY) ?? '',
        items: this.state.managedSkills().map(skill => ({
          skillId: skill.skillId,
          version: skill.version,
          status: SkillSyncStatus.Unchanged,
        })),
      };
    }

    let changed = false;
    try {
      fs.mkdirSync(this.#skillRoot, { recursive: true });
      const desired = new Set<string>();
      const items: Array<SkillReconcileResult['items'][number]> = [];
      for (const skill of result.manifest.skills) {
        if (!skill.enabled) continue;
        validateSkill(skill);
        if (desired.has(skill.id)) {
          throw new Error(`Skill manifest contains duplicate ID ${skill.id}.`);
        }
        desired.add(skill.id);
        const installed = this.state.managedSkills().find(item => item.skillId === skill.id);
        if (
          installed?.version === skill.version &&
          installed.sha256 === skill.package.sha256 &&
          fs.existsSync(installed.path)
        ) {
          items.push({
            skillId: skill.id,
            version: skill.version,
            status: SkillSyncStatus.Unchanged,
          });
          continue;
        }
        await this.#install(skill, installed);
        changed = true;
        items.push({
          skillId: skill.id,
          version: skill.version,
          status: installed ? SkillSyncStatus.Updated : SkillSyncStatus.Installed,
        });
      }

      for (const installed of this.state.managedSkills()) {
        if (desired.has(installed.skillId)) continue;
        this.#remove(installed);
        changed = true;
        items.push({
          skillId: installed.skillId,
          version: installed.version,
          status: SkillSyncStatus.Removed,
        });
      }

      this.state.setValue(SKILL_REVISION_KEY, result.manifest.revision);
      if (result.etag) this.state.setValue(SKILL_ETAG_KEY, result.etag);
      return { revision: result.manifest.revision, items };
    } finally {
      if (changed) this.#onSkillsChanged?.();
    }
  }

  async #install(skill: SkillManifestItem, installed: ManagedSkill | undefined): Promise<void> {
    const target = this.#targetPath(skill.id);
    if (installed && path.resolve(installed.path) !== target) {
      throw new Error(`Managed Skill ${skill.id} has an invalid ownership path.`);
    }
    if (!installed && fs.existsSync(target)) {
      throw new Error(`Managed Skill ${skill.id} conflicts with an existing local Skill.`);
    }

    const archive = await this.client.downloadSkillPackage(skill.id, skill.version);
    if (archive.byteLength > MAX_ARCHIVE_BYTES) {
      throw new Error(`Skill ${skill.id} package exceeds the archive size limit.`);
    }
    if (archive.byteLength !== skill.package.size) {
      throw new Error(`Skill ${skill.id} package size mismatch.`);
    }
    const actualHash = createHash('sha256').update(archive).digest('hex');
    if (actualHash !== skill.package.sha256.toLowerCase()) {
      throw new Error(`Skill ${skill.id} package checksum mismatch.`);
    }

    const staging = path.join(this.#skillRoot, `.zhiyuan-staging-${skill.id}-${randomUUID()}`);
    const backup = path.join(this.#skillRoot, `.zhiyuan-backup-${skill.id}-${randomUUID()}`);
    fs.mkdirSync(staging, { recursive: false });
    let backedUp = false;
    try {
      await extractSkillZip(archive, staging);
      if (!fs.statSync(path.join(staging, 'SKILL.md'), { throwIfNoEntry: false })?.isFile()) {
        throw new Error(`Skill ${skill.id} package does not contain root SKILL.md.`);
      }
      if (fs.existsSync(target)) {
        fs.renameSync(target, backup);
        backedUp = true;
      }
      fs.renameSync(staging, target);
      try {
        this.state.setManagedSkill({
          skillId: skill.id,
          version: skill.version,
          sha256: skill.package.sha256.toLowerCase(),
          path: target,
        });
      } catch (error) {
        removeDirectory(target);
        if (backedUp) fs.renameSync(backup, target);
        throw error;
      }
      if (backedUp) removeDirectory(backup);
    } catch (error) {
      removeDirectory(staging);
      if (!fs.existsSync(target) && backedUp && fs.existsSync(backup)) {
        fs.renameSync(backup, target);
      }
      throw error;
    }
  }

  #remove(skill: ManagedSkill): void {
    const target = this.#targetPath(skill.skillId);
    if (path.resolve(skill.path) !== target) {
      throw new Error(`Managed Skill ${skill.skillId} has an invalid ownership path.`);
    }
    removeDirectory(target);
    this.state.removeManagedSkill(skill.skillId);
  }

  #targetPath(skillId: string): string {
    return path.join(this.#skillRoot, safeSkillId(skillId));
  }
}

export function extractSkillZip(archive: Uint8Array, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(Buffer.from(archive), { lazyEntries: true }, (openError, zip) => {
      if (openError || !zip) {
        reject(openError ?? new Error('Skill ZIP could not be opened.'));
        return;
      }
      let entryCount = 0;
      let extractedBytes = 0;
      let settled = false;
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        zip.close();
        reject(error);
      };
      zip.on('error', fail);
      zip.on('entry', entry => {
        try {
          entryCount += 1;
          extractedBytes += entry.uncompressedSize;
          if (entryCount > MAX_ARCHIVE_ENTRIES || extractedBytes > MAX_EXTRACTED_BYTES) {
            fail(new Error('Skill ZIP exceeds extraction limits.'));
            return;
          }
          const output = safeZipEntryPath(
            destination,
            entry.fileName,
            entry.externalFileAttributes,
          );
          if (entry.fileName.replaceAll('\\', '/').endsWith('/')) {
            fs.mkdirSync(output, { recursive: true });
            zip.readEntry();
            return;
          }
          fs.mkdirSync(path.dirname(output), { recursive: true });
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) {
              fail(streamError ?? new Error('Skill ZIP entry could not be read.'));
              return;
            }
            const writer = fs.createWriteStream(output, { flags: 'wx' });
            writer.once('error', fail);
            stream.once('error', fail);
            writer.once('close', () => {
              if (!settled) zip.readEntry();
            });
            stream.pipe(writer);
          });
        } catch (error) {
          fail(asError(error));
        }
      });
      zip.on('end', () => {
        if (settled) return;
        settled = true;
        resolve();
      });
      zip.readEntry();
    });
  });
}

function validateSkill(skill: SkillManifestItem): void {
  safeSkillId(skill.id);
  if (!skill.version.trim()) throw new Error(`Skill ${skill.id} has no version.`);
  if (!/^[a-fA-F0-9]{64}$/.test(skill.package.sha256)) {
    throw new Error(`Skill ${skill.id} has an invalid checksum.`);
  }
  if (!Number.isSafeInteger(skill.package.size) || skill.package.size < 0) {
    throw new Error(`Skill ${skill.id} has an invalid package size.`);
  }
}

function safeSkillId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error(`Unsafe Skill identifier ${value}.`);
  }
  return value;
}

function safeZipEntryPath(destination: string, fileName: string, attributes: number): string {
  const normalized = fileName.replaceAll('\\', '/');
  const segments = normalized.split('/').filter(Boolean);
  const fileType = (attributes >>> 16) & 0o170000;
  if (
    !normalized ||
    normalized.includes('\0') ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized) ||
    segments.includes('..') ||
    fileType === 0o120000
  ) {
    throw new Error(`Unsafe Skill ZIP entry ${fileName}.`);
  }
  const root = path.resolve(destination);
  const output = path.resolve(root, ...segments);
  if (output !== root && !output.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Skill ZIP entry escaped its destination: ${fileName}.`);
  }
  return output;
}

function removeDirectory(directory: string): void {
  if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true, force: true });
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
