import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';

import { StrataFamilyId, StrataInstallPhase } from '../../../shared/strata/constants';
import type { StrataMarketplaceVariant } from '../../../shared/strata/types';
import { resolveStrataInstallFiles, StrataModelInstallation } from './strataModelInstallation';

const catalogId = 'strata-deepseek-v41-flash';
const bytes = Buffer.from('474755460300000000010203', 'hex');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const file = {
  repoId: 'owner/repo',
  revision: '1'.repeat(40),
  path: 'upstream/metadata.gguf',
  bytes: bytes.length,
  sha256,
  shared: true,
} as const;

test('a resumed transfer publishes the upstream stamp and shares the verified DeepSeek file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'strata-install-'));
  const variant: StrataMarketplaceVariant = {
    label: '2.00',
    launchId: 'IST-DAS-2.00bpw',
    files: [file],
  };
  const other = { ...variant, launchId: 'IST-DAS-2.25bpw' };
  const installer = new StrataModelInstallation(
    root,
    () => new Map([[catalogId, [variant, other]]]),
  );
  const target = path.join(root, 'models', 'deepseek-v4.1-flash-shared', 'metadata.gguf');
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () =>
      new Response(bytes.subarray(4), {
        status: 206,
        headers: { 'Content-Range': `bytes 4-${bytes.length - 1}/${bytes.length}` },
      }),
  );
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(`${target}.download`, bytes.subarray(0, 4));
    installer.start({ catalogId, launchId: variant.launchId });
    await vi.waitFor(async () =>
      expect((await installer.state()).job?.phase).toBe(StrataInstallPhase.Done),
    );
    expect(fetch).toHaveBeenCalledWith(
      `https://huggingface.co/${file.repoId}/resolve/${file.revision}/${file.path}`,
      expect.objectContaining({ headers: { Range: 'bytes=4-' } }),
    );
    expect(await fs.readFile(target)).toEqual(bytes);
    expect(await fs.readFile(`${target}.done`, 'utf8')).toBe(`sha256 ${sha256}`);
    expect((await installer.state()).installed).toEqual([
      { catalogId, launchId: variant.launchId },
      { catalogId, launchId: other.launchId },
    ]);
  } finally {
    fetch.mockRestore();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a checksum failure never publishes a model or an upstream completion stamp', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'strata-install-'));
  const variant = {
    label: 'test',
    launchId: 'UD-Q8_K_XL',
    files: [{ ...file, shared: undefined, sha256: '0'.repeat(64) }],
  };
  const installer = new StrataModelInstallation(root, () => new Map([[catalogId, [variant]]]));
  const target = resolveStrataInstallFiles(root, StrataFamilyId.DeepSeek41, variant)[0].target;
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(bytes));
  try {
    installer.start({ catalogId, launchId: variant.launchId });
    await vi.waitFor(async () =>
      expect((await installer.state()).job?.phase).toBe(StrataInstallPhase.Failed),
    );
    expect((await installer.state()).installed).toEqual([]);
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(`${target}.done`)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    fetch.mockRestore();
    await fs.rm(root, { recursive: true, force: true });
  }
});
