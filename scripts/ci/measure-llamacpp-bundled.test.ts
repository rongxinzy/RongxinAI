import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const {
  CPU_TARGET_BUDGETS,
  resolveTargetLimit,
  assertWithinLimit,
  measure,
} = require('./measure-llamacpp-bundled.cjs');
const MiB = 1024 * 1024;
const roots: string[] = [];
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test('reports every staged llama.cpp file and the total bytes; cuda has no limit', () => {
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
    '[measure] llamacpp-bundled {"target":"win-x64-cuda","launched":"cpu-fallback/llama-server.exe","files":2,"bytes":12,"limit":null}',
  );
});

// cpu limits = measured staged bytes (build run 39032801288) + ceil(3%) MiB.
test('cpu targets enforce measured + explicit margin; cuda stays uncapped', () => {
  expect(CPU_TARGET_BUDGETS).toEqual({
    'win32-x64-cpu': { measuredBytes: 152_004_077, marginBytes: 5 * MiB },
    'linux-x64-cpu': { measuredBytes: 138_108_759, marginBytes: 4 * MiB },
    'darwin-arm64-cpu': { measuredBytes: 25_936_788, marginBytes: 1 * MiB },
    'darwin-x64-cpu': { measuredBytes: 25_171_262, marginBytes: 1 * MiB },
  });
  for (const { measuredBytes, marginBytes } of Object.values(
    CPU_TARGET_BUDGETS as Record<string, { measuredBytes: number; marginBytes: number }>,
  )) {
    expect(marginBytes).toBe(Math.ceil((measuredBytes * 0.03) / MiB) * MiB);
  }
  expect(resolveTargetLimit('win32-x64-cpu')).toBe(157_246_957);
  expect(assertWithinLimit('win32-x64-cpu', 152_004_077)).toBe(157_246_957);
  expect(() => assertWithinLimit('win32-x64-cpu', 157_246_958)).toThrow(/over its 157246957/);
  expect(() => assertWithinLimit('linux-x64-cpu', 142_303_064)).toThrow(/linux-x64-cpu/);
  expect(resolveTargetLimit('win32-x64-cuda')).toBeNull();
  expect(resolveTargetLimit('linux-x64-cuda')).toBeNull();
  expect(assertWithinLimit('linux-x64-cuda', 4096 * MiB)).toBeNull();
});
