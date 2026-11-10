import fs from 'node:fs/promises';
import path from 'node:path';

import { encodeModelRepoFilePath } from '../../../shared/llamacpp/modelDownloadUrls';
import { StrataFamilyId, StrataInstallPhase } from '../../../shared/strata/constants';
import type {
  StrataInstallState,
  StrataMarketplaceVariant,
  StrataVariantRef,
} from '../../../shared/strata/types';
import { assertValidGgufFile, downloadLocalModelFile, sha256File } from '../localModelDownload';
import { STRATA_MODEL_CATALOG, getStrataCatalogEntry } from './strataModelCatalog';

const MODEL_FOLDER_PREFIX = {
  [StrataFamilyId.QwenFlashNext]: 'gyro-',
  [StrataFamilyId.Qwen36]: 'qwen36-',
  [StrataFamilyId.DeepSeek41]: 'deepseek-v4.1-flash-',
} as const;

type InstallFile = StrataMarketplaceVariant['files'][number] & { target: string };

export function resolveStrataInstallFiles(
  dataDir: string,
  family: StrataFamilyId,
  variant: StrataMarketplaceVariant,
): InstallFile[] {
  const prefix = MODEL_FOLDER_PREFIX[family];
  return variant.files.map(file => ({
    ...file,
    target: path.join(
      dataDir,
      'models',
      prefix + (file.shared ? 'shared' : variant.launchId),
      path.posix.basename(file.path),
    ),
  }));
}

function marker(file: InstallFile): string {
  return `${file.target}.done`;
}

async function fileSize(filePath: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() ? stat.size : 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
}

async function isVerified(file: InstallFile): Promise<boolean> {
  try {
    const stats = await fs.stat(file.target);
    if (!stats.isFile() || stats.size !== file.bytes) return false;
    const stamp = await fs.stat(marker(file));
    return (
      stamp.isFile() &&
      stamp.size < 256 &&
      stamp.mtimeMs >= stats.mtimeMs &&
      (await fs.readFile(marker(file), 'utf8')).trim() === `sha256 ${file.sha256}`
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function sameVariant(a: StrataVariantRef, b: StrataVariantRef): boolean {
  return a.catalogId === b.catalogId && a.launchId === b.launchId;
}

export class StrataModelInstallation {
  private job?: NonNullable<StrataInstallState['job']>;
  private controller?: AbortController;

  constructor(
    readonly dataDir: string,
    private readonly readCatalog: () => Map<string, StrataMarketplaceVariant[]>,
  ) {}

  async state(): Promise<StrataInstallState> {
    const catalog = this.readCatalog();
    const refs = STRATA_MODEL_CATALOG.flatMap(entry =>
      (catalog.get(entry.id) ?? []).map(variant => ({
        catalogId: entry.id,
        launchId: variant.launchId,
      })),
    );
    const installed = await Promise.all(
      refs.map(async ref => ((await this.isInstalled(ref)) ? ref : null)),
    );
    return { installed: installed.filter(ref => ref !== null), job: this.job && { ...this.job } };
  }

  async isInstalled(ref: StrataVariantRef): Promise<boolean> {
    const files = this.files(ref);
    for (const file of files) {
      if (!(await isVerified(file))) return false;
    }
    return files.length > 0;
  }

  start(ref: StrataVariantRef): void {
    if (this.controller) {
      if (this.job && sameVariant(ref, this.job)) return;
      throw new Error('Another Strata model is already downloading.');
    }
    const files = this.files(ref);
    const controller = new AbortController();
    this.controller = controller;
    this.job = {
      ...ref,
      phase: StrataInstallPhase.Downloading,
      total: files.reduce((sum, file) => sum + file.bytes, 0),
      completed: 0,
    };
    void this.installFiles(files, this.job, controller.signal).finally(() => {
      this.controller = undefined;
    });
  }

  cancel(ref: StrataVariantRef): void {
    if (this.job && sameVariant(this.job, ref)) this.controller?.abort();
  }

  private files(ref: StrataVariantRef): InstallFile[] {
    const entry = getStrataCatalogEntry(ref.catalogId);
    const variant = this.readCatalog()
      .get(ref.catalogId)
      ?.find(item => item.launchId === ref.launchId);
    if (!entry || !variant?.files.length) throw new Error('Unknown Strata model variant.');
    return resolveStrataInstallFiles(this.dataDir, entry.family, variant);
  }

  private async installFiles(
    files: InstallFile[],
    job: NonNullable<StrataInstallState['job']>,
    signal: AbortSignal,
  ): Promise<void> {
    let completed = 0;
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      const missing: InstallFile[] = [];
      let remaining = 0;
      for (const file of files) {
        signal.throwIfAborted();
        let verified = await isVerified(file);
        // A previous process may have exited between publishing the file and writing its stamp.
        if (!verified && (await fileSize(file.target)) === file.bytes) {
          job.phase = StrataInstallPhase.Verifying;
          verified = (await sha256File(file.target, signal)) === file.sha256;
          if (verified) {
            assertValidGgufFile(file.target);
            await fs.writeFile(marker(file), `sha256 ${file.sha256}`);
          }
        }
        if (verified) {
          completed += file.bytes;
          job.completed = completed;
        } else {
          missing.push(file);
          const partialBytes = await fileSize(`${file.target}.download`);
          remaining += file.bytes - (partialBytes <= file.bytes ? partialBytes : 0);
        }
      }
      job.completed = completed;
      const disk = await fs.statfs(this.dataDir, { bigint: true });
      if (disk.bavail * disk.bsize < BigInt(remaining)) {
        throw new Error('Not enough free space to download this Strata model.');
      }
      for (const file of missing) {
        signal.throwIfAborted();
        await fs.mkdir(path.dirname(file.target), { recursive: true });
        await fs.rm(marker(file), { force: true });
        const remote = `${file.repoId}/resolve/${file.revision}/${encodeModelRepoFilePath(file.path)}`;
        job.phase = StrataInstallPhase.Downloading;
        await downloadLocalModelFile(
          `https://huggingface.co/${remote}`,
          file.target,
          bytes => {
            job.completed = completed + Math.min(bytes, file.bytes);
          },
          signal,
          file.sha256,
          file.bytes,
          () => {
            job.phase = StrataInstallPhase.Verifying;
          },
        );
        await fs.writeFile(marker(file), `sha256 ${file.sha256}`);
        completed += file.bytes;
      }
      job.completed = completed;
      job.phase = StrataInstallPhase.Done;
    } catch (error) {
      if (signal.aborted) {
        job.phase = StrataInstallPhase.Cancelled;
      } else {
        console.warn(
          `[Strata] model installation failed for ${job.catalogId}/${job.launchId}:`,
          error,
        );
        job.error = error instanceof Error ? error.message : String(error);
        job.phase = StrataInstallPhase.Failed;
      }
    }
  }
}
