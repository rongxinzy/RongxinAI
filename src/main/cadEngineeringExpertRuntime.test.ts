import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { expect, test } from 'vitest';

const skillRoot = path.resolve(
  'SKILLs/zhiyuan-expert-manager/presets/cad-engineering-expert/skills/text-to-cad',
);
const archivePath = path.join(skillRoot, 'vendor', 'text-to-cad-0.4.28.tar.gz');
const runtimePath = path.join(skillRoot, 'scripts', 'runtime.py');
const expectedWorkflows = [
  'cad',
  'cad-viewer',
  'step-parts',
  'dxf',
  'urdf',
  'srdf',
  'sdf',
  'sendcutsend',
  'dfam-check',
  'gcode',
  'bambu-labs',
  'implicit-cad',
] as const;

interface TarEntry {
  name: string;
  type: number;
}

const readNullTerminated = (block: Buffer, start: number, length: number): string => {
  const field = block.subarray(start, start + length);
  const terminator = field.indexOf(0);
  return field.subarray(0, terminator === -1 ? field.length : terminator).toString('utf8');
};

const parseOctal = (block: Buffer, start: number, length: number): number => {
  const value = readNullTerminated(block, start, length).trim();
  return value === '' ? 0 : Number.parseInt(value, 8);
};

const listTarEntries = (archive: Buffer): TarEntry[] => {
  const entries: TarEntry[] = [];
  let offset = 0;

  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      break;
    }

    const name = readNullTerminated(header, 0, 100);
    const prefix = readNullTerminated(header, 345, 155);
    const size = parseOctal(header, 124, 12);
    entries.push({
      name: prefix ? `${prefix}/${name}` : name,
      type: header[156],
    });
    offset += 512 + Math.ceil(size / 512) * 512;
  }

  return entries;
};

test('pins a safe and complete text-to-cad runtime archive', () => {
  const compressed = fs.readFileSync(archivePath);
  const runtimeSource = fs.readFileSync(runtimePath, 'utf8');
  const expectedDigest = runtimeSource.match(/ARCHIVE_SHA256 = "([0-9a-f]{64})"/)?.[1];
  const actualDigest = createHash('sha256').update(compressed).digest('hex');

  expect(expectedDigest).toBeDefined();
  expect(actualDigest).toBe(expectedDigest);

  const entries = listTarEntries(gunzipSync(compressed));
  const names = new Set(entries.map(entry => entry.name.replace(/^\.\//, '')));

  expect(entries.length).toBeGreaterThan(0);
  for (const entry of entries) {
    const normalizedName = entry.name.replace(/^\.\//, '');
    expect(path.posix.isAbsolute(normalizedName)).toBe(false);
    expect(normalizedName.split('/')).not.toContain('..');
    expect(normalizedName.split('/').some(part => part.startsWith('._'))).toBe(false);
    // Git archive emits one global PAX record for the source commit. Per-file
    // PAX records and every link/device entry remain forbidden here.
    expect([0, 48, 53, 103]).toContain(entry.type);
  }

  expect(names).toContain('LICENSE');
  expect(names).toContain('.codex-plugin/plugin.json');
  for (const workflow of expectedWorkflows) {
    expect(names).toContain(`skills/${workflow}/SKILL.md`);
  }
});
