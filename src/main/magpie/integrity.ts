import fs from 'node:fs/promises';
import path from 'node:path';
import { sha256FileStream } from '../libs/fileHasher';
export const MAGPIE_COMMIT = 'f074996d93b87b17ea682c4b5951d52794bb28cb';
export const MAGPIE_VERSION = 'zhiyuan-f074996d93b8';
let hashing = false;
async function hashMagpieBinary(file: string, signal: AbortSignal): Promise<string> {
  if (hashing) throw new Error('Magpie verification already running');
  signal.throwIfAborted();
  hashing = true;
  try {
    return await sha256FileStream(file, { signal });
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
