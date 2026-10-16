import fs from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
export const MAGPIE_COMMIT = 'f074996d93b87b17ea682c4b5951d52794bb28cb';
export const MAGPIE_VERSION = 'zhiyuan-f074996d93b8';
let hashing = false;
async function hashMagpieBinary(file: string, signal: AbortSignal): Promise<string> {
  if (hashing) throw new Error('Magpie verification already running');
  signal.throwIfAborted();
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size < 1 || stat.size > 512 * 1024 * 1024)
    throw new Error('Invalid Magpie binary size');
  hashing = true;
  try {
    return await new Promise<string>((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, 'hashWorker.js'), { workerData: { file } });
      let settled = false;
      const finish = (error?: Error, digest?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        void worker.terminate();
        if (error) reject(error);
        else resolve(digest!);
      };
      const abort = () => finish(new Error('Magpie verification cancelled'));
      const timer = setTimeout(() => finish(new Error('Magpie verification timed out')), 120_000);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      worker.once('error', () => finish(new Error('Magpie verification worker failed')));
      worker.once('exit', () => finish(new Error('Magpie verification worker exited')));
      worker.once('message', (message: { digest?: string; runMs?: number }) => {
        if (!message.digest || !/^[a-f0-9]{64}$/.test(message.digest))
          finish(new Error('Invalid Magpie digest'));
        else {
          console.debug(
            `[Magpie] verification ran ${Math.round(message.runMs ?? 0)} ms (queue 0 ms)`,
          );
          finish(undefined, message.digest);
        }
      });
    });
  } finally {
    hashing = false;
  }
}
export async function verifyMagpieBinary(
  root: string,
  signal: AbortSignal,
  hasher = hashMagpieBinary,
): Promise<string> {
  const target = `${process.platform}-${process.arch}`;
  if (!/^(linux|darwin|win32)-(x64|arm64)$/.test(target))
    throw new Error('Unsupported Magpie platform');
  const dir = path.join(root, target);
  const manifestFile = path.join(dir, 'manifest.json');
  if ((await fs.stat(manifestFile)).size > 16_384) throw new Error('Invalid Magpie manifest size');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  const name = process.platform === 'win32' ? 'magpie.exe' : 'magpie';
  if (
    manifest.schemaVersion !== 1 ||
    manifest.platform !== process.platform ||
    manifest.arch !== process.arch ||
    manifest.binary !== name ||
    manifest.source?.commit !== MAGPIE_COMMIT ||
    manifest.version !== MAGPIE_VERSION ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256)
  )
    throw new Error('Invalid Magpie manifest');
  const file = path.join(dir, name);
  if ((await hasher(file, signal)) !== manifest.sha256)
    throw new Error('Magpie binary integrity check failed');
  return file;
}
