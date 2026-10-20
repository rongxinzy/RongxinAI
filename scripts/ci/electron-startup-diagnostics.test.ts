import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { expect, test } from 'vitest';
import { captureElectronStartup } from './electron-startup-diagnostics.mjs';

test('retains both native startup failure streams with a strict per-stream byte limit', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'electron-startup-'));
  try {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const retain = captureElectronStartup({ stdout, stderr }, 32);
    stdout.emit('data', Buffer.alloc(100_000, 'a'));
    stdout.emit('data', 'ready');
    stderr.emit('data', 'Cannot find native binding');
    await retain(directory);
    const output = await readFile(path.join(directory, 'electron-stdout.log'));
    expect(output.length).toBe(32);
    expect(output.toString()).toMatch(/ready$/);
    expect(await readFile(path.join(directory, 'electron-stderr.log'), 'utf8')).toBe(
      'Cannot find native binding',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('memory CI prepares and probes the Electron ABI before launching the real application', () => {
  const workflow = load(readFileSync('.github/workflows/memory-regression.yml', 'utf8')) as {
    jobs: { 'memory-leak': { steps: Array<{ run?: string }> } };
  };
  const steps = workflow.jobs['memory-leak'].steps;
  const preparation = steps.findIndex(step =>
    step.run?.includes('bun run rebuild:electron-native'),
  );
  const launch = steps.findIndex(step => step.run?.includes('bun run test:memory-leak'));
  expect(preparation).toBeGreaterThan(-1);
  expect(preparation).toBeLessThan(launch);
  expect(steps[preparation].run).toContain('node scripts/electron-native-abi.mjs');
});
