import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sha256FileStream } from '../libs/fileHasher';
export const MAGPIE_COMMIT = 'f074996d93b87b17ea682c4b5951d52794bb28cb';
export const MAGPIE_VERSION = 'zhiyuan-f074996d93b8';
let hashing = false;
const verifiedSignedDigests = new Set<string>();

export interface VerifyMagpieBinaryOptions {
  verifySignature?: (file: string, platform: NodeJS.Platform, signal: AbortSignal) => Promise<void>;
}

const WINDOWS_SECURITY_DIR_OFFSET_PE32 = 128;
const WINDOWS_SECURITY_DIR_OFFSET_PE32_PLUS = 144;

async function readRange(
  handle: fs.FileHandle,
  offset: number,
  length: number,
  fileSize: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + length > fileSize) {
    throw new Error('Truncated model service PE binary');
  }
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, offset);
  if (bytesRead < length) {
    throw new Error('Truncated model service PE binary');
  }
  return buffer;
}

/**
 * Verifies the Windows PE binary carries an aligned, structurally valid
 * Authenticode PKCS#7 WIN_CERTIFICATE table at EOF before trusting a signed seal.
 */
export async function assertPeHasAuthenticodeSignature(file: string): Promise<void> {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const dos = await readRange(handle, 0, 64, size);
    if (dos.toString('ascii', 0, 2) !== 'MZ') {
      throw new Error('Model service binary is not a Windows PE executable');
    }
    const peOffset = dos.readUInt32LE(60);
    if (peOffset < 64) {
      throw new Error('Invalid model service PE header offset');
    }
    const pe = await readRange(handle, peOffset, 24, size);
    if (pe.readUInt32LE(0) !== 0x4550) {
      throw new Error('Invalid model service PE signature');
    }
    const numberOfSections = pe.readUInt16LE(6);
    const optionalSize = pe.readUInt16LE(20);
    const optional = await readRange(handle, peOffset + 24, optionalSize, size);
    const magic = optionalSize >= 2 ? optional.readUInt16LE(0) : 0;
    const dirOffset =
      magic === 0x20b
        ? WINDOWS_SECURITY_DIR_OFFSET_PE32_PLUS
        : magic === 0x10b
          ? WINDOWS_SECURITY_DIR_OFFSET_PE32
          : -1;
    if (dirOffset < 0 || optionalSize < dirOffset + 8) {
      throw new Error('Model service binary is missing PE certificate directory');
    }
    const numberOfRvasAndSizes = optional.readUInt32LE(magic === 0x20b ? 108 : 92);
    if (numberOfRvasAndSizes < 5) {
      throw new Error('Model service binary is missing Authenticode certificate directory');
    }
    const headerEnd = peOffset + 24 + optionalSize + numberOfSections * 40;
    const certOffset = optional.readUInt32LE(dirOffset);
    const certBytes = optional.readUInt32LE(dirOffset + 4);
    if (
      certOffset === 0 ||
      certBytes < 8 ||
      certOffset < headerEnd ||
      certOffset % 8 !== 0 ||
      certOffset + certBytes > size
    ) {
      throw new Error('Model service binary is missing a valid Authenticode certificate table');
    }
    const certHeader = await readRange(handle, certOffset, 8, size);
    const length = certHeader.readUInt32LE(0);
    const revision = certHeader.readUInt16LE(4);
    const certType = certHeader.readUInt16LE(6);
    if (length < 8 || length > certBytes || revision !== 0x200 || certType !== 2) {
      throw new Error('Model service binary contains an invalid Authenticode certificate entry');
    }
  } finally {
    await handle.close();
  }
}

async function defaultVerifyOsSignature(
  file: string,
  platform: NodeJS.Platform,
  signal: AbortSignal,
): Promise<void> {
  if (platform === 'darwin') {
    await new Promise<void>((resolve, reject) => {
      execFile(
        '/usr/bin/codesign',
        ['--verify', '--strict', file],
        { timeout: 5_000, signal },
        error => {
          if (!error) return resolve();
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ENOENT') {
            console.warn(
              '[Magpie] codesign tool unavailable; falling back to SHA-256 verification.',
            );
            return resolve();
          }
          reject(new Error(`Model service macOS code signature check failed: ${error.message}`));
        },
      );
    });
    return;
  }
  if (platform === 'win32') {
    await assertPeHasAuthenticodeSignature(file);
    await new Promise<void>((resolve, reject) => {
      execFile(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '$s = Get-AuthenticodeSignature -LiteralPath $env:ZHIYUAN_MAGPIE_BIN; if ($null -eq $s -or $s.Status -ne "Valid" -or $null -eq $s.TimeStamperCertificate) { Write-Error "InvalidAuthenticode:$($s.Status)"; exit 1 }',
        ],
        {
          windowsHide: true,
          timeout: 5_000,
          signal,
          env: { ...process.env, ZHIYUAN_MAGPIE_BIN: file },
        },
        (error, _stdout, stderr) => {
          if (!error) return resolve();
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ENOENT' || code === 'EACCES') {
            console.warn(
              '[Magpie] PowerShell Authenticode check unavailable; continuing with PE certificate table + SHA-256 verification.',
            );
            return resolve();
          }
          const detail = stderr?.trim() || error.message;
          reject(new Error(`Model service Authenticode signature verification failed: ${detail}`));
        },
      );
    });
  }
}

async function hashMagpieBinary(file: string, signal: AbortSignal): Promise<string> {
  if (hashing) throw new Error('Runtime verification already running');
  signal.throwIfAborted();
  hashing = true;
  try {
    return await sha256FileStream(file, { signal });
  } finally {
    hashing = false;
  }
}

function expectedSigningFormat(platform: NodeJS.Platform): string | undefined {
  if (platform === 'win32') return 'authenticode';
  if (platform === 'darwin') return 'codesign';
  return undefined;
}

export async function verifyMagpieBinary(
  root: string,
  signal: AbortSignal,
  hasher = hashMagpieBinary,
  options?: VerifyMagpieBinaryOptions,
): Promise<string> {
  const target = `${process.platform}-${process.arch}`;
  if (!/^(linux|darwin|win32)-(x64|arm64)$/.test(target))
    throw new Error('Unsupported model service platform');
  const dir = path.join(root, target);
  const manifestFile = path.join(dir, 'manifest.json');
  if ((await fs.stat(manifestFile)).size > 16_384)
    throw new Error('Invalid model service manifest size');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8')) as Record<string, unknown>;
  const name = process.platform === 'win32' ? 'magpie.exe' : 'magpie';
  const source = manifest.source as Record<string, unknown> | undefined;
  if (
    manifest.schemaVersion !== 1 ||
    manifest.platform !== process.platform ||
    manifest.arch !== process.arch ||
    manifest.binary !== name ||
    source?.commit !== MAGPIE_COMMIT ||
    manifest.version !== MAGPIE_VERSION ||
    typeof manifest.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256)
  )
    throw new Error('Invalid model service manifest');
  if (manifest.sizeBytes !== undefined) {
    if (
      typeof manifest.sizeBytes !== 'number' ||
      !Number.isSafeInteger(manifest.sizeBytes) ||
      manifest.sizeBytes <= 0
    ) {
      throw new Error('Invalid model service manifest sizeBytes');
    }
  }
  const signing = manifest.signing as Record<string, unknown> | undefined;
  if (signing !== undefined) {
    const format = expectedSigningFormat(process.platform);
    if (
      !format ||
      !signing ||
      typeof signing !== 'object' ||
      signing.platform !== process.platform ||
      signing.format !== format ||
      typeof manifest.buildSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(manifest.buildSha256) ||
      manifest.buildSha256 === manifest.sha256
    ) {
      throw new Error('Invalid model service signing seal');
    }
  }
  const file = path.join(dir, name);
  if (manifest.sizeBytes !== undefined && hasher === hashMagpieBinary) {
    if ((await fs.stat(file)).size !== manifest.sizeBytes) {
      throw new Error('Model service binary size check failed');
    }
  }
  if ((await hasher(file, signal)) !== manifest.sha256)
    throw new Error('Model service binary integrity check failed');

  if (signing !== undefined) {
    const cacheKey = `${process.platform}:${file}:${manifest.sha256}`;
    if (!verifiedSignedDigests.has(cacheKey)) {
      if (options?.verifySignature) {
        await options.verifySignature(file, process.platform, signal);
        verifiedSignedDigests.add(cacheKey);
      } else if (hasher === hashMagpieBinary) {
        await defaultVerifyOsSignature(file, process.platform, signal);
        verifiedSignedDigests.add(cacheKey);
      }
    }
  }
  return file;
}
