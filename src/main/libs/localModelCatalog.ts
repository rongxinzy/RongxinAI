import { readFileSync } from 'fs';
import { copyFile, mkdir, readdir, rename, rm, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { setImmediate as yieldToMainLoop } from 'node:timers/promises';

import Database from 'better-sqlite3';

import type { MarketplaceModel, MarketplaceSearchParams } from '../../shared/marketplace';
import type { CatalogUpdate, CatalogVersion } from './modelCatalogUpdateTypes';

export const LOCAL_MODEL_CATALOG_FILE = 'model-catalog.sqlite';

type CatalogRow = { payload: string };

export class LocalModelCatalog {
  private activePath: string | undefined;
  private readonly pointerPath: string;

  constructor(
    private readonly bundledPath: string,
    private readonly directory: string,
  ) {
    this.pointerPath = path.join(directory, 'model-catalog-current');
  }

  private read<T>(read: (db: Database.Database, version: CatalogVersion) => T): T {
    this.activePath ??= this.latestPath();
    const db = this.open(this.activePath);
    try {
      return read(db, this.version(db));
    } finally {
      db.close();
    }
  }

  private latestPath(): string {
    try {
      const current = readFileSync(this.pointerPath, 'utf8').trim();
      if (!/^\d+$/.test(current)) return this.bundledPath;
      const candidate = this.snapshotPath(Number(current));
      if (this.readVersion(candidate).revision > this.readVersion(this.bundledPath).revision) {
        return candidate;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[Marketplace] Updated model catalog is unreadable:', error);
      }
    }
    return this.bundledPath;
  }

  private snapshotPath(revision: number): string {
    return path.join(this.directory, `model-catalog-${revision}.sqlite`);
  }

  private open(filePath: string): Database.Database {
    return new Database(filePath, { readonly: true, fileMustExist: true });
  }

  private version(db: Database.Database): CatalogVersion {
    const row = db
      .prepare('SELECT revision, updated_at AS updatedAt FROM catalog_version')
      .get() as CatalogVersion | undefined;
    if (!row || !Number.isSafeInteger(row.revision))
      throw new Error('Invalid model catalog version');
    return row;
  }

  search(params: MarketplaceSearchParams): CatalogVersion & {
    models: MarketplaceModel[];
    totalCount: number;
    nextCursor?: string;
  } {
    const limit = Math.min(100, Math.max(1, Math.floor(params.limit ?? 20)));
    const page = Math.min(5000, Math.max(1, Math.floor(params.pageNumber ?? 1)));
    const offset = (page - 1) * limit;
    return this.read((db, version) => {
      const cursor = /^([0-9]+):([0-9]+)$/.exec(params.cursor ?? '');
      if (cursor && Number(cursor[1]) !== version.revision) {
        return { ...version, models: [], totalCount: 0 };
      }
      const start = cursor ? Number(cursor[2]) : offset;
      const filters = [];
      const values: (string | number)[] = [];
      if (params.query?.trim()) {
        filters.push('instr(lower(search_text), lower(?)) > 0');
        values.push(params.query.trim().slice(0, 256));
      }
      if (params.featuredOnly) filters.push('featured_rank IS NOT NULL');
      const tags = new Set(params.tags?.slice(0, 16).map(tag => tag.toLowerCase().slice(0, 64)));
      if (params.task && params.task !== 'all') tags.add(params.task);
      for (const tag of tags) {
        filters.push('EXISTS (SELECT 1 FROM json_each(catalog_models.tags) WHERE value = ?)');
        values.push(tag);
      }
      if (params.quantization?.trim()) {
        filters.push(
          "EXISTS (SELECT 1 FROM json_each(catalog_models.payload, '$.files') WHERE lower(json_extract(value, '$.quantization')) = lower(?))",
        );
        values.push(params.quantization.trim().slice(0, 64));
      }
      const sizes = {
        all: '',
        small: 'parameter_count < 4',
        desktop: 'parameter_count BETWEEN 4 AND 8',
        workstation: 'parameter_count > 8 AND parameter_count <= 32',
        large: 'parameter_count > 32',
      };
      if (params.size && sizes[params.size]) {
        filters.push(`(parameter_count IS NULL OR ${sizes[params.size]})`);
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const order = params.featuredOnly ? 'featured_rank, position, repo_id' : 'position, repo_id';
      const { totalCount } = db
        .prepare(`SELECT count(*) AS totalCount FROM catalog_models ${where}`)
        .get(...values) as { totalCount: number };
      const rows = db
        .prepare(`SELECT payload FROM catalog_models ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
        .all(...values, limit, start) as CatalogRow[];
      const models = rows.map(row => JSON.parse(row.payload) as MarketplaceModel);
      return {
        ...version,
        models,
        totalCount,
        ...(start + models.length < totalCount
          ? { nextCursor: `${version.revision}:${start + models.length}` }
          : {}),
      };
    });
  }

  find(repoId: string): MarketplaceModel | null {
    return this.read(db => {
      const row = db
        .prepare('SELECT payload FROM catalog_models WHERE repo_id = ? COLLATE NOCASE')
        .get(repoId) as CatalogRow | undefined;
      return row ? (JSON.parse(row.payload) as MarketplaceModel) : null;
    });
  }

  getVersion(): CatalogVersion {
    return this.read((_db, version) => version);
  }

  getLatestVersion(): CatalogVersion {
    return this.readVersion(this.latestPath());
  }

  async applyUpdate(update: CatalogUpdate): Promise<void> {
    const base = this.latestPath();
    const active = this.readVersion(base);
    if (update.revision <= active.revision) return;
    if (update.baseRevision !== null && active.revision !== update.baseRevision) {
      throw new Error('Model catalog update does not match the local revision');
    }
    const destination = this.snapshotPath(update.revision);
    const suffix = `.${randomUUID()}.tmp`;
    const staged = `${destination}${suffix}`;
    const pointer = `${this.pointerPath}${suffix}`;
    await mkdir(path.dirname(staged), { recursive: true });
    try {
      await copyFile(base, staged);
      const db = new Database(staged);
      try {
        db.exec('BEGIN');
        if (update.baseRevision === null) db.exec('DELETE FROM catalog_models');
        const remove = db.prepare('DELETE FROM catalog_models WHERE repo_id = ? COLLATE NOCASE');
        const upsert = db.prepare(
          'INSERT OR REPLACE INTO catalog_models VALUES (?, ?, ?, ?, ?, ?, ?)',
        );
        for (let index = 0; index < update.deletes.length; index++) {
          if (index > 0 && index % 100 === 0) await yieldToMainLoop();
          remove.run(update.deletes[index]);
        }
        for (let index = 0; index < update.upserts.length; index++) {
          if (index > 0 && index % 100 === 0) await yieldToMainLoop();
          upsert.run(...update.upserts[index]);
        }
        if (!db.prepare('SELECT 1 FROM catalog_models LIMIT 1').get()) {
          throw new Error('Model catalog update would leave the catalog empty');
        }
        db.prepare('UPDATE catalog_version SET revision = ?, updated_at = ?').run(
          update.revision,
          update.updatedAt,
        );
        db.exec('COMMIT');
      } finally {
        db.close();
      }
      await rename(staged, destination);
      await writeFile(pointer, String(update.revision), { flag: 'wx' });
      await rename(pointer, this.pointerPath);
      const entries = await readdir(this.directory);
      await Promise.all(
        entries
          .filter(name => /^model-catalog-\d+\.sqlite$/.test(name))
          .map(name => path.join(this.directory, name))
          .filter(file => file !== destination && file !== this.activePath)
          .map(file => rm(file, { force: true }).catch((): void => undefined)),
      );
    } finally {
      await Promise.all([staged, pointer].map(file => rm(file, { force: true })));
    }
  }

  private readVersion(filePath: string): CatalogVersion {
    const bundled = this.open(filePath);
    try {
      return this.version(bundled);
    } finally {
      bundled.close();
    }
  }
}
