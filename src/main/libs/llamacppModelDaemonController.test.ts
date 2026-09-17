import path from 'node:path';

import { expect, test } from 'vitest';

import {
  formatLlamaCppDaemonStartupFailure,
  resolveLlamaCppModelDaemonRequestTimeoutMs,
  resolveLlamaCppModelDaemonEntryPath,
} from './llamacppModelDaemonController';
import { LlamaCppModelDaemonCommand } from './llamacppModelDaemonProtocol';

test('resolves the daemon entry beside the Electron main bundle', () => {
  expect(resolveLlamaCppModelDaemonEntryPath('C:/app/dist-electron')).toBe(
    path.join('C:/app/dist-electron', 'llamacppModelDaemonEntry.js'),
  );
});

test('includes daemon stderr and exit information in startup failures', () => {
  expect(
    formatLlamaCppDaemonStartupFailure({
      message: 'Failed to connect to daemon.',
      output: 'Error: module could not be loaded',
      exitCode: 1,
    }),
  ).toContain('daemon exited with code 1\nError: module could not be loaded');
});

test('waits for the configured model startup budget when loading a model', () => {
  expect(
    resolveLlamaCppModelDaemonRequestTimeoutMs(LlamaCppModelDaemonCommand.EnsureModel, {
      timeout: '30',
    }),
  ).toBe(35_000);
});

test('keeps non-loading daemon requests on the short control timeout', () => {
  expect(
    resolveLlamaCppModelDaemonRequestTimeoutMs(LlamaCppModelDaemonCommand.Status, {
      timeout: '30',
    }),
  ).toBe(1_000);
});
