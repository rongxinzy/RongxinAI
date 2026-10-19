import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  chmodSync,
  statSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { checkpoint } from './build-checkpoint.mjs';

const temporary: string[] = [];
const identity = {
  commit: 'a'.repeat(40),
  version: '1.2.3',
  runId: '123',
  target: 'win32-x64-lite',
};
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'checkpoint-'));
  temporary.push(root);
  mkdirSync(path.join(root, 'release'));
  writeFileSync(path.join(root, 'release/app'), 'final signed bytes');
  chmodSync(path.join(root, 'release/app'), 0o755);
  return { root, archive: path.join(root, 'checkpoint') };
}
afterEach(() =>
  temporary.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })),
);

test('acceptance restores exact bytes without rebuilding and preserves executable mode', async () => {
  const { root, archive } = fixture();
  await checkpoint('create', archive, identity, ['release'], root);
  rmSync(path.join(root, 'release'), { recursive: true });
  await checkpoint('restore', archive, identity, [], root);
  expect(readFileSync(path.join(root, 'release/app'), 'utf8')).toBe('final signed bytes');
  if (process.platform !== 'win32')
    expect(statSync(path.join(root, 'release/app')).mode & 0o111).toBe(0o111);
});

test.each(['commit', 'version', 'runId', 'target'])(
  'rejects mismatched %s before extraction',
  async key => {
    const { root, archive } = fixture();
    await checkpoint('create', archive, identity, ['release'], root);
    await expect(
      checkpoint('restore', archive, { ...identity, [key]: 'different' }, [], root),
    ).rejects.toThrow('mismatch');
  },
);

test('rejects corrupted payload and missing input', async () => {
  const { root, archive } = fixture();
  await expect(checkpoint('create', archive, identity, ['missing'], root)).rejects.toThrow(
    'missing',
  );
  await checkpoint('create', archive, identity, ['release'], root);
  writeFileSync(path.join(archive, 'payload.tar'), 'corrupted');
  await expect(checkpoint('restore', archive, identity, [], root)).rejects.toThrow('SHA-256');
});
