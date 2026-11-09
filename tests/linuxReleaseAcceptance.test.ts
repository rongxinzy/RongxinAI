import { test, expect } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  expectedDebVersion,
  fingerprintArtifacts,
  installedExecutable,
  releaseArtifacts,
  releaseIdentity,
  verifyEvidence,
} from '../scripts/ci/linux-release-acceptance-lib.mjs';

const env = {
  APP_BUILD_VERSION: '1.2.3-rc.1',
  ZHIYUAN_SOURCE_COMMIT: 'a'.repeat(40),
  ZHIYUAN_UPDATE_VARIANT: 'cuda',
  GITHUB_RUN_ID: '123',
  GITHUB_RUN_ATTEMPT: '2',
};

test('Linux acceptance requires complete immutable run identity', () => {
  const identity = releaseIdentity(env);
  expect(identity.runAttempt).toBe('2');
  for (const key of Object.keys(env)) {
    assert.throws(() => releaseIdentity({ ...env, [key]: '' }));
  }
  assert.throws(() => releaseIdentity({ ...env, GITHUB_RUN_ATTEMPT: '0' }));
  expect(expectedDebVersion('1.2.3')).toBe('1.2.3');
  expect(expectedDebVersion('1.2.3-rc-1')).toBe('1.2.3~rc~1');
  expect(installedExecutable(['/opt/sanitized-product/app'], 'app')).toBe('/opt/sanitized-product/app');
  assert.throws(() => installedExecutable(['/usr/bin/app'], 'app'));
  assert.throws(() => installedExecutable(['/opt/one/app', '/opt/two/app'], 'app'));
});

test('Linux acceptance binds final bytes and rejects evidence from another attempt', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'linux-release-test-'));
  try {
    await fs.writeFile(path.join(directory, 'release.deb'), 'deb bytes');
    await fs.writeFile(path.join(directory, 'release.AppImage'), 'appimage bytes');
    const artifacts = await releaseArtifacts(directory);
    const fingerprints = await fingerprintArtifacts(artifacts);
    const identity = releaseIdentity(env);
    const evidence = {
      schemaVersion: 1,
      status: 'passed',
      identity,
      artifacts: Object.fromEntries(
        Object.entries(fingerprints).map(([format, artifact]) => [
          format,
          { ...artifact, renderer: 'passed' },
        ]),
      ),
    };
    verifyEvidence(evidence, identity, fingerprints);
    for (const key of Object.keys(identity)) {
      assert.throws(() => verifyEvidence(evidence, { ...identity, [key]: 'wrong' }, fingerprints));
    }
    assert.throws(() => verifyEvidence({ ...evidence, schemaVersion: 2 }, identity, fingerprints));
    assert.throws(() => verifyEvidence({ ...evidence, status: 'failed' }, identity, fingerprints));
    assert.throws(() => verifyEvidence({ ...evidence, artifacts: {} }, identity, fingerprints));
    const missingRenderer = structuredClone(evidence);
    missingRenderer.artifacts.deb.renderer = 'failed';
    assert.throws(() => verifyEvidence(missingRenderer, identity, fingerprints));
    await fs.appendFile(artifacts.appimage, ' changed');
    const changed = await fingerprintArtifacts(artifacts);
    assert.throws(() => verifyEvidence(evidence, identity, changed));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('Linux final artifact selection fails closed for missing, duplicate or symlink files', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'linux-selection-test-'));
  try {
    await assert.rejects(releaseArtifacts(directory));
    await fs.writeFile(path.join(directory, 'release.deb'), 'deb');
    await fs.symlink('release.deb', path.join(directory, 'release.AppImage'));
    await assert.rejects(releaseArtifacts(directory));
    await fs.unlink(path.join(directory, 'release.AppImage'));
    await fs.writeFile(path.join(directory, 'release.AppImage'), 'appimage');
    await fs.writeFile(path.join(directory, 'duplicate.deb'), 'deb');
    await assert.rejects(releaseArtifacts(directory));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
