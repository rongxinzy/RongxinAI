import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, test } from 'vitest';
import { createMemory, type MemoryHost } from '@sigrun/memory-markdown';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const host = (root: string): MemoryHost => ({
  settings: {
    declare: <S>() => ({ get: async () => ({ limits: { user: 1375, memory: 2200 } }) as S }),
  },
  stores: { user: () => ({ paths: { data: root } }) },
  identity: { actingUser: async () => 'owner' },
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'memory-atomic-'));
  roots.push(root);
  const memory = await createMemory(host(root));
  const files = await memory.files('owner');
  await files.apply('memory', [{ op: 'add', text: 'Kept prior body.' }]);
  return { root, files };
}

// Faults run in a separate real Node process. Only the exact canonical target
// is intercepted, leaving upstream version writes and its shared queue intact.
const childSource = `
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
const [root, mode, changeId] = process.argv.slice(1);
const write = fs.writeFile;
const rename = fs.rename;
fs.writeFile = async (file, bytes, options) => {
  if (mode.includes('write-failure') && /MEMORY\\.md\\.[a-z0-9-]+\\.tmp$/.test(String(file))) {
    await write(file, 'injected partial bytes', options);
    throw new Error('injected canonical write failure');
  }
  return write(file, bytes, options);
};
fs.rename = async (from, to) => {
  if (String(to) === path.join(root, 'MEMORY.md')) {
    if (mode === 'rename-failure') throw new Error('injected canonical rename failure');
    if (mode === 'crash') {
      process.stdout.write('BEFORE_RENAME\\n');
      await new Promise(() => { setInterval(() => {}, 1000); });
    }
  }
  return rename(from, to);
};
syncBuiltinESMExports();
const { createMemory } = await import('@sigrun/memory-markdown');
const memory = await createMemory({
  settings: { declare: () => ({ get: async () => ({ limits: { user: 1375, memory: 2200 } }) }) },
  stores: { user: () => ({ paths: { data: root } }) },
  identity: { actingUser: async () => 'owner' },
});
try {
  const files = await memory.files('owner');
  if (mode === 'undo-write-failure') await files.undo(changeId);
  else await files.apply('memory', [{ op: 'replace', match: 'Kept prior body.', text: 'New complete body.' }]);
  process.stdout.write('COMMITTED\\n');
} catch (error) {
  process.stdout.write(error.message + '\\n');
  process.exitCode = 12;
}
`;

async function child(root: string, mode: string, changeId?: string) {
  const processUnderTest = spawn(
    process.execPath,
    ['--input-type=module', '-e', childSource, root, mode, ...(changeId ? [changeId] : [])],
    { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  let killed = false;
  processUnderTest.stdout.on('data', chunk => {
    output += chunk;
    if (mode === 'crash' && output.includes('BEFORE_RENAME') && !killed) {
      killed = true;
      processUnderTest.kill('SIGKILL');
    }
  });
  processUnderTest.stderr.on('data', chunk => {
    output += chunk;
  });
  const timer = setTimeout(() => processUnderTest.kill('SIGKILL'), 5000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      processUnderTest.once('error', reject);
      processUnderTest.once('close', resolve);
    });
    return { code, output, killed };
  } finally {
    clearTimeout(timer);
  }
}

for (const mode of ['write-failure', 'rename-failure']) {
  test(`canonical ${mode} preserves old body and cleans its staging file`, async () => {
    const f = await fixture();
    const result = await child(f.root, mode);
    expect(result.code, result.output).toBe(12);
    expect(result.output).toContain('injected canonical');
    expect(await readFile(f.files.path('memory'), 'utf8')).toBe('Kept prior body.');
    expect((await readdir(f.root)).filter(name => name.endsWith('.tmp'))).toEqual([]);
    const reopened = await createMemory(host(f.root));
    expect((await (await reopened.files('owner')).read('memory')).entries).toEqual([
      'Kept prior body.',
    ]);
  });
}

test('SIGKILL after flushed staging write but before rename preserves the old canonical file', async () => {
  const f = await fixture();
  const result = await child(f.root, 'crash');
  expect(result.killed, result.output).toBe(true);
  expect(await readFile(f.files.path('memory'), 'utf8')).toBe('Kept prior body.');
  const reopened = await createMemory(host(f.root));
  expect((await (await reopened.files('owner')).read('memory')).entries).toEqual([
    'Kept prior body.',
  ]);
  // A forced kill cannot execute finally. This orphan is never canonical.
  expect((await readdir(f.root)).filter(name => name.endsWith('.tmp'))).toHaveLength(1);
});

test('successful replacement survives process exit and a fresh factory reopen', async () => {
  const f = await fixture();
  const result = await child(f.root, 'success');
  expect(result.code, result.output).toBe(0);
  const reopened = await createMemory(host(f.root));
  expect((await (await reopened.files('owner')).read('memory')).entries).toEqual([
    'New complete body.',
  ]);
  expect((await readdir(f.root)).filter(name => name.endsWith('.tmp'))).toEqual([]);
});

test('undo uses the same atomic canonical replacement and preserves the newer body on failure', async () => {
  const f = await fixture();
  const changed = await f.files.apply('memory', [
    { op: 'replace', match: 'Kept prior body.', text: 'New complete body.' },
  ]);
  const result = await child(f.root, 'undo-write-failure', changed.changeId);
  expect(result.code, result.output).toBe(12);
  expect(await readFile(f.files.path('memory'), 'utf8')).toBe('New complete body.');
  expect((await readdir(f.root)).filter(name => name.endsWith('.tmp'))).toEqual([]);
});
