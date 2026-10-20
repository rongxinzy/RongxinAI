import fs from 'fs';
import { pipeline } from 'stream/promises';
import yazl from 'yazl';

type LogArchiveFileEntry = {
  archiveName: string;
  filePath: string;
};

type LogVirtualArchiveEntry = {
  archiveName: string;
  content: string | Buffer;
};

export type ExportLogsZipInput = {
  outputPath: string;
  entries?: LogArchiveFileEntry[];
  virtualEntries?: LogVirtualArchiveEntry[];
};

export type ExportLogsZipResult = {
  exportedEntries: string[];
  missingEntries: string[];
};

const EXPORT_TIMEOUT_MS = 30_000;

export async function exportLogsZip(input: ExportLogsZipInput): Promise<ExportLogsZipResult> {
  const zipFile = new yazl.ZipFile();
  const exportedEntries: string[] = [];
  const missingEntries: string[] = [];

  // Defensive: propagate ZipFile-level errors into the output stream so
  // pipeline() can reject immediately instead of hanging until timeout.
  zipFile.on('error', err => {
    (zipFile.outputStream as unknown as { destroy(err: Error): void }).destroy(err as Error);
  });

  // 1. Process virtual in-memory entries (e.g. system diagnostics json, summary text)
  if (input.virtualEntries && input.virtualEntries.length > 0) {
    for (const vEntry of input.virtualEntries) {
      try {
        const buffer = Buffer.isBuffer(vEntry.content)
          ? vEntry.content
          : Buffer.from(vEntry.content, 'utf-8');
        zipFile.addBuffer(buffer, vEntry.archiveName);
        exportedEntries.push(vEntry.archiveName);
      } catch {
        missingEntries.push(vEntry.archiveName);
      }
    }
  }

  // 2. Process physical file entries
  const fileEntries = input.entries || [];
  for (const entry of fileEntries) {
    try {
      const stat = fs.statSync(entry.filePath);
      if (stat.isFile()) {
        const { size } = stat;
        if (size > 0) {
          const readStream = fs.createReadStream(entry.filePath, { start: 0, end: size - 1 });
          zipFile.addReadStream(readStream, entry.archiveName);
        } else {
          zipFile.addBuffer(Buffer.alloc(0), entry.archiveName);
        }
        exportedEntries.push(entry.archiveName);
        continue;
      }
    } catch {
      // File does not exist or became inaccessible — treat as missing
    }
    missingEntries.push(entry.archiveName);
    zipFile.addBuffer(Buffer.alloc(0), entry.archiveName);
  }

  const outputStream = fs.createWriteStream(input.outputPath);

  const pipelinePromise = pipeline(zipFile.outputStream, outputStream);
  zipFile.end();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Log export timed out')), EXPORT_TIMEOUT_MS);
  });

  try {
    await Promise.race([pipelinePromise, timeoutPromise]);
  } catch (err) {
    outputStream.destroy();
    pipelinePromise.catch(() => {});
    try {
      fs.unlinkSync(input.outputPath);
    } catch {
      /* ignore cleanup errors */
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  return { exportedEntries, missingEntries };
}
