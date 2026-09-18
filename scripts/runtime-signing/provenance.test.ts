import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import {
  assertAncestor,
  executableHash,
  readBuildRun,
  readSigningRun,
  runId,
  RuntimeSources,
  signerThumbprint,
  SigningAuthority,
  validateManifest,
  validateRun,
} from './provenance.mjs';

const sha = 'a'.repeat(40);
const signer = 'B'.repeat(40);
const source = RuntimeSources.engram;
const build = {
  key: 'engram',
  sourceRepository: source.repo,
  sourceRunId: '123',
  sourceSha: sha,
  sourceTag: 'v1.20.0-zhiyuan.4',
};
const run = {
  id: 123,
  repository: { full_name: source.repo },
  head_repository: { full_name: source.repo },
  path: source.workflow,
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  head_sha: sha,
  head_branch: build.sourceTag,
};
const manifest = {
  schemaVersion: 1,
  ...build,
  signingRepository: SigningAuthority.repo,
  signingRunId: '456',
  signerThumbprint: signer,
  files: source.files.map(name => ({
    name,
    unsignedSha256: 'c'.repeat(64),
    signedSha256: 'd'.repeat(64),
  })),
};
const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

test('validates trusted completed runs and rejects every mismatched boundary', () => {
  expect(() => validateRun(run, source.repo, source.workflow, '123', 'push')).not.toThrow();
  for (const override of [
    { id: 124 },
    { repository: { full_name: 'attacker/repo' } },
    { head_repository: { full_name: 'attacker/repo' } },
    { path: 'other.yml' },
    { event: 'pull_request' },
    { status: 'in_progress' },
    { conclusion: 'failure' },
    { head_sha: 'bad' },
  ])
    expect(() =>
      validateRun({ ...run, ...override }, source.repo, source.workflow, '123', 'push'),
    ).toThrow();
});

test('rejects malformed IDs, missing signer configuration and non-main ancestry', () => {
  for (const id of ['', '0', '-1', '1\n', '1/../../', '1e3', '9'.repeat(21)])
    expect(() => runId(id)).toThrow();
  expect(runId('123')).toBe('123');
  expect(signerThumbprint('b '.repeat(40))).toBe(signer);
  for (const value of ['', 'b'.repeat(39), 'g'.repeat(40)])
    expect(() => signerThumbprint(value)).toThrow();
  for (const status of ['behind', 'diverged', 'unknown'])
    expect(() => assertAncestor({ status })).toThrow();
  for (const status of ['ahead', 'identical'])
    expect(() => assertAncestor({ status })).not.toThrow();
});

test('peels annotated tags and rejects moved tags or unrelated main', async () => {
  const api = async (_repo: string, endpoint: string) => {
    if (endpoint.startsWith('actions/')) return run;
    if (endpoint.startsWith('compare/')) return { status: 'ahead' };
    if (endpoint.startsWith('git/ref/')) return { object: { type: 'tag', sha: 'e'.repeat(40) } };
    return { object: { type: 'commit', sha } };
  };
  await expect(readBuildRun('engram', '123', api)).resolves.toEqual(build);
  for (const object of [
    { type: 'commit', sha: 'f'.repeat(40) },
    { type: 'tag', sha },
  ]) {
    await expect(
      readBuildRun('engram', '123', async (repo: string, endpoint: string) =>
        endpoint.startsWith('git/') ? { object } : api(repo, endpoint),
      ),
    ).rejects.toThrow();
  }
  await expect(
    readBuildRun('engram', '123', async (repo: string, endpoint: string) =>
      endpoint.startsWith('compare/') ? { status: 'diverged' } : api(repo, endpoint),
    ),
  ).rejects.toThrow();
  await expect(
    readBuildRun('engram', '123', async () => ({ ...run, head_branch: 'main' })),
  ).rejects.toThrow();
});

test('central signing must be a successful dispatch from the signing authority main', async () => {
  const signing = {
    ...run,
    id: 456,
    repository: { full_name: SigningAuthority.repo },
    head_repository: { full_name: SigningAuthority.repo },
    path: SigningAuthority.workflow,
    event: 'workflow_dispatch',
    head_branch: 'main',
  };
  await expect(
    readSigningRun('456', async (_repo: string, endpoint: string) =>
      endpoint.startsWith('compare/') ? { status: 'identical' } : signing,
    ),
  ).resolves.toEqual(signing);
  await expect(
    readSigningRun('456', async () => ({ ...signing, head_branch: 'feature' })),
  ).rejects.toThrow();
});

test('validates source and hashes without requiring a public signer configuration', () => {
  expect(() => validateManifest(manifest, build, '456')).not.toThrow();
  expect(() => validateManifest({ ...manifest, signerThumbprint: undefined }, build, '456')).not.toThrow();
  for (const override of [
    { schemaVersion: 2 },
    { key: 'sidecar' },
    { sourceRepository: 'attacker/repo' },
    { sourceRunId: '124' },
    { sourceSha: 'f'.repeat(40) },
    { sourceTag: 'v1.20.0-zhiyuan.5' },
    { signingRepository: 'attacker/repo' },
    { signingRunId: '457' },
    { files: [...manifest.files, manifest.files[0]] },
    { files: [manifest.files[0], manifest.files[0]] },
    { files: manifest.files.map(file => ({ ...file, signedSha256: 'bad' })) },
    { files: manifest.files.map(file => ({ ...file, unsignedSha256: 'bad' })) },
  ])
    expect(() => validateManifest({ ...manifest, ...override }, build, '456')).toThrow();
});

test('hashes bounded regular Windows executables and rejects absent, tiny or non-PE files', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'runtime-policy-'));
  temporaryDirectories.push(directory);
  writeFileSync(path.join(directory, 'valid.exe'), 'MZfixture');
  expect(executableHash(directory, 'valid.exe')).toMatch(/^[0-9a-f]{64}$/);
  expect(() => executableHash(directory, 'missing.exe')).toThrow();
  expect(() => executableHash(directory, '.')).toThrow();
  for (const bytes of ['', 'M', 'not an executable']) {
    writeFileSync(path.join(directory, 'bad.exe'), bytes);
    expect(() => executableHash(directory, 'bad.exe')).toThrow();
  }
});

test('workflow validates inputs before authenticating and signs only the manifest allowlist', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/runtime-central-signing.yml', import.meta.url),
    'utf8',
  );
  expect(workflow.indexOf('manifest.mjs before')).toBeLessThan(
    workflow.indexOf('setup-certum-signing'),
  );
  expect(workflow).toContain('environment: release');
  expect(workflow).toContain('foreach ($file in $manifest.files)');
  expect(workflow).not.toContain('contents: write');
  const signing = readFileSync(new URL('./sign-runtime.ps1', import.meta.url), 'utf8');
  expect(signing).toContain('& $signTool sign /v /fd sha256');
  expect(signing).toContain('SignTool failed with exit code');
  expect(signing).not.toMatch(/\$signTool verify|Get-AuthenticodeSignature|Assert-WindowsRuntimeSignature/);
});

test('manifest CLI rejects extra executables before signing and records both byte hashes', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'runtime-manifest-'));
  temporaryDirectories.push(directory);
  for (const name of source.files) writeFileSync(path.join(directory, name), 'MZunsigned');
  const script = fileURLToPath(new URL('./manifest.mjs', import.meta.url));
  const env = {
    ...process.env,
    RUNTIME_KEY: build.key,
    SOURCE_RUN_ID: build.sourceRunId,
    SOURCE_SHA: sha,
    SOURCE_TAG: build.sourceTag,
    GITHUB_RUN_ID: '456',
    CERTUM_CERT_THUMBPRINT: signer,
  };
  execFileSync(process.execPath, [script, 'before', directory], { env });
  const filename = path.join(directory, 'signed-runtime-manifest.json');
  const unsigned = JSON.parse(readFileSync(filename, 'utf8'));
  for (const name of source.files) writeFileSync(path.join(directory, name), 'MZsigned');
  execFileSync(process.execPath, [script, 'after', directory], { env });
  const signed = JSON.parse(readFileSync(filename, 'utf8'));
  expect(() => validateManifest(signed, build, '456')).not.toThrow();
  expect(signed.files[0].unsignedSha256).toBe(unsigned.files[0].unsignedSha256);
  expect(signed.files[0].signedSha256).not.toBe(signed.files[0].unsignedSha256);
  writeFileSync(path.join(directory, 'unexpected.exe'), 'MZuntrusted');
  expect(() =>
    execFileSync(process.execPath, [script, 'before', directory], { env, stdio: 'pipe' }),
  ).toThrow();
});
