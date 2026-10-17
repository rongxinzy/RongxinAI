import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { measure } = require('./measure-llamacpp-bundled.cjs');
const roots: string[] = [];
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test('reports every staged llama.cpp file and the total bytes without any limit', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'zhiyuan-llama-measure-'));
  roots.push(root);
  mkdirSync(path.join(root, 'bin'));
  writeFileSync(path.join(root, 'manifest.json'), '{}');
  writeFileSync(path.join(root, 'bin', 'llama-server.exe'), Buffer.alloc(10));
  const result = measure(root, 'win-x64-cuda', 'cpu-fallback/llama-server.exe');
  expect(result.files).toEqual([
    { path: 'bin/llama-server.exe', bytes: 10 },
    { path: 'manifest.json', bytes: 2 },
  ]);
  expect(result.bytes).toBe(12);
  expect(result.line).toBe(
    '[measure] llamacpp-bundled {"target":"win-x64-cuda","launched":"cpu-fallback/llama-server.exe","files":2,"bytes":12}',
  );
});
