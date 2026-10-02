import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { writeSigningReceipt } from './write-receipt.mjs';

const baseEnv = {
  SOURCE_RUN_ID: '37007682809',
  SOURCE_SHA: 'a'.repeat(40),
  PACKAGE_VERSION: '1.0.2',
  GITHUB_RUN_ID: '37009810186',
};

function withReleaseDir(files: Record<string, string>, fn: (dir: string) => void) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'signing-receipt-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(dir, name), content);
    }
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('writes a receipt with hashes for every signed installer', () => {
  withReleaseDir({ 'Setup-1.0.2.exe': 'installer-bytes' }, dir => {
    const { receipt, receiptPath } = writeSigningReceipt(baseEnv, dir);
    expect(receiptPath).toBe(path.join(dir, 'signing-receipt.json'));
    expect(receipt).toEqual({
      version: 1,
      sourceRepository: 'rongxinzy/xiaoruan-ai-agent',
      sourceRunId: '37007682809',
      sourceSha: 'a'.repeat(40),
      packageVersion: '1.0.2',
      signingRepository: 'rongxinzy/RongxinAI',
      signingRunId: '37009810186',
      files: [
        {
          name: 'Setup-1.0.2.exe',
          sha256: createHash('sha256').update('installer-bytes').digest('hex'),
          size: 'installer-bytes'.length,
        },
      ],
    });
    const onDisk = JSON.parse(readFileSync(receiptPath, 'utf8'));
    expect(onDisk).toEqual(receipt);
  });
});

test('refuses to write a receipt when no installer exists', () => {
  withReleaseDir({ 'notes.txt': 'not an installer' }, dir => {
    expect(() => writeSigningReceipt(baseEnv, dir)).toThrow('No signed installer found');
  });
});

test('rejects invalid provenance inputs', () => {
  withReleaseDir({ 'Setup-1.0.2.exe': 'installer-bytes' }, dir => {
    expect(() => writeSigningReceipt({ ...baseEnv, SOURCE_RUN_ID: 'abc' }, dir)).toThrow(
      'SOURCE_RUN_ID',
    );
    expect(() => writeSigningReceipt({ ...baseEnv, SOURCE_SHA: 'short' }, dir)).toThrow(
      'SOURCE_SHA',
    );
    expect(() => writeSigningReceipt({ ...baseEnv, PACKAGE_VERSION: '' }, dir)).toThrow(
      'PACKAGE_VERSION',
    );
  });
});
