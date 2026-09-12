import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

/**
 * Static-mode tests for the SoL-Pi jiti bundle gate. The gate is a CLI script
 * that exits non-zero on failure, so each case runs it as a child process
 * against a synthetic bundle and asserts the exit code. The packaged
 * cold-cache mode needs a real Electron + app.asar and stays a manual/CI
 * packaging step (see reports in the workflow directory).
 */

const gateScript = path.join(__dirname, 'solpi-bundle-jiti-gate.cjs');

const temporaryDirectories: string[] = [];

function createBundle(source: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-solpi-jiti-gate-test-'));
  temporaryDirectories.push(root);
  const bundlePath = path.join(root, 'main.js');
  fs.writeFileSync(bundlePath, source);
  return bundlePath;
}

function runGate(bundlePath: string): { status: number | null; stderr: string } {
  const result = spawnSync(process.execPath, [gateScript, '--static', bundlePath], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  return { status: result.status, stderr: result.stderr ?? '' };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('solpi-bundle-jiti-gate --static', () => {
  test('accepts a bundle with an externalized jiti require and no fingerprint', () => {
    const bundle = createBundle('const jiti = require("jiti"); module.exports = jiti;\n');
    const run = runGate(bundle);
    expect(run.status).toBe(0);
  });

  test('rejects the pre-fix double-quoted inlined babel helper path', () => {
    const bundle = createBundle(
      'const lazyTransform = createRequire(pathToFileURL(__filename).href)("../dist/babel.cjs"); require("jiti");\n',
    );
    expect(runGate(bundle).status).toBe(1);
  });

  test('rejects single-quoted and backtick-quoted helper paths', () => {
    const singleQuoted = createBundle(
      "const lazyTransform = createRequire(url)('../dist/babel.cjs'); require('jiti');\n",
    );
    expect(runGate(singleQuoted).status).toBe(1);

    const backticked = createBundle(
      'const lazyTransform = createRequire(url)(`../dist/babel.cjs`); require("jiti");\n',
    );
    const run = runGate(backticked);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('inlines jiti');
  });

  test('does not flag bundler region comments that survive externalization', () => {
    const bundle = createBundle(
      '//#region node_modules/jiti/dist/babel.cjs\nconst jiti = require("jiti");\n//#endregion\n',
    );
    expect(runGate(bundle).status).toBe(0);
  });

  test('rejects a fingerprint-free bundle that lost the externalized require', () => {
    const bundle = createBundle('module.exports = {};\n');
    const run = runGate(bundle);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('externalized require');
  });

  test('fails on a missing bundle path instead of passing silently', () => {
    const run = runGate(path.join(os.tmpdir(), 'zhiyuan-solpi-jiti-gate-missing.js'));
    expect(run.status).toBe(1);
  });
});
