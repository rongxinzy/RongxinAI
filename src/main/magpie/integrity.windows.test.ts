import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import {
  MAGPIE_COMMIT,
  MAGPIE_PATCH_SHA256,
  MAGPIE_PATCHED_SOURCE_SHA256,
  MAGPIE_VERSION,
  verifyMagpieBinary,
} from './integrity';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
vi.mock('../libs/fileHasher', () => ({ sha256FileStream: vi.fn(async () => 'a'.repeat(64)) }));

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

async function signedFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'magpie-signature-'));
  const dir = path.join(root, `${process.platform}-${process.arch}`);
  await fs.mkdir(dir);
  const binary = Buffer.alloc(528);
  binary.write('MZ');
  binary.writeUInt32LE(128, 60);
  binary.writeUInt32LE(0x4550, 128);
  binary.writeUInt16LE(1, 134);
  binary.writeUInt16LE(240, 148);
  binary.writeUInt16LE(0x20b, 152);
  binary.writeUInt32LE(16, 260);
  binary.writeUInt32LE(512, 296);
  binary.writeUInt32LE(16, 300);
  binary.writeUInt32LE(16, 512);
  binary.writeUInt16LE(0x200, 516);
  binary.writeUInt16LE(2, 518);
  await fs.writeFile(path.join(dir, 'magpie.exe'), binary);
  await fs.writeFile(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
      schemaVersion: 1,
      platform: process.platform,
      arch: process.arch,
      binary: 'magpie.exe',
      source: {
        commit: MAGPIE_COMMIT,
        patchSha256: MAGPIE_PATCH_SHA256,
        treeSha256: MAGPIE_PATCHED_SOURCE_SHA256,
      },
      version: MAGPIE_VERSION,
      sha256: 'a'.repeat(64),
      buildSha256: 'b'.repeat(64),
      signing: { platform: process.platform, format: 'authenticode' },
    }),
  );
  return root;
}

test.skipIf(process.platform !== 'win32')(
  'allows a cold signature check longer than five seconds',
  async () => {
    const root = await signedFixture();
    try {
      vi.useFakeTimers();
      vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
        const options = args[2] as { timeout: number; signal: AbortSignal };
        const callback = args[3] as (error: Error | null, stdout: string, stderr: string) => void;
        const timeout = setTimeout(() => callback(new Error('Timed out'), '', ''), options.timeout);
        setTimeout(() => {
          clearTimeout(timeout);
          callback(null, '', '');
        }, 8_000);
        return {} as ReturnType<typeof execFile>;
      });
      const verification = verifyMagpieBinary(root, new AbortController().signal);
      await vi.waitFor(() => expect(execFile).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(8_000);
      await expect(verification).resolves.toContain('magpie.exe');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform !== 'win32')(
  'preserves invalid signatures and process termination diagnostics',
  async () => {
    const root = await signedFixture();
    try {
      vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
        const callback = args[3] as (error: Error, stdout: string, stderr: string) => void;
        callback(
          Object.assign(new Error('Command failed'), { code: 1, killed: true, signal: 'SIGTERM' }),
          '',
          'InvalidAuthenticode:NotTrusted',
        );
        return {} as ReturnType<typeof execFile>;
      });
      await expect(verifyMagpieBinary(root, new AbortController().signal)).rejects.toThrow(
        /code=1, signal=SIGTERM, killed=true.*InvalidAuthenticode:NotTrusted/,
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
